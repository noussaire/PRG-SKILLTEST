import { prisma } from "../db/prisma.js";
import { createHash } from "node:crypto";
import { reportEmailConfigured, ReportEmailError, sendReportEmail } from "./brevo.service.js";
import { buildReportEmail } from "./report-email-template.js";
import { reportPdfRenderer } from "./report-pdf.service.js";
import { assertJobId } from "./job-request.js";
import { REPORT_EMAIL_LEASE_MS } from "./report-limits.js";

// Brevo documents a finite idempotency TTL. Stop uncertain deliveries after ten
// minutes (below both its older 15-minute and current 30-minute documented TTL).
const SAFE_RETRY_WINDOW_MS = 10 * 60000;
let running = false;
let nextRunAt = 0;

export async function processReportEmails(jobId?: string) {
  if (jobId !== undefined) assertJobId(jobId);
  if (!reportEmailConfigured() || (!jobId && (running || Date.now() < nextRunAt))) return;
  if (!jobId) { running = true; nextRunAt = Date.now() + 1000; }
  try {
    const now = new Date(Date.now());
    const cooldown = await prisma.adaptiveReportJob.findFirst({
      where: { emailStatus: "RETRY", emailLastErrorCode: { in: ["BREVO_QUOTA", "BREVO_RATE_LIMIT"] }, emailNextAttemptAt: { gt: now } },
      orderBy: { emailNextAttemptAt: "desc" },
    });
    if (cooldown) { if (!jobId) nextRunAt = cooldown.emailNextAttemptAt.getTime(); return; }
    const job = await prisma.adaptiveReportJob.findFirst({
      where: {
        ...(jobId ? { id: jobId } : {}),
        AND: [{ OR: [{ status: "COMPLETE", summary: { not: null } }, { status: "UNAVAILABLE" }] }],
        interview: { reportEmailRequested: true, email: { not: null }, expiresAt: { gt: now } },
        OR: [
          { emailStatus: { in: ["PENDING", "RETRY"] }, emailNextAttemptAt: { lte: now } },
          { emailStatus: "PROCESSING", emailLeaseUntil: { lte: now } },
        ],
      },
      orderBy: [{ emailNextAttemptAt: "asc" }, { id: "asc" }], include: { interview: true },
    });
    if (!job) { if (!jobId) nextRunAt = Date.now() + 5000; return; }
    const identity = { id: job.id, status: job.status, summary: job.summary, emailStatus: job.emailStatus, emailLeaseUntil: job.emailLeaseUntil, emailAttempts: job.emailAttempts };
    const [receipt] = await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM "EmailBudgetReservation" WHERE "logicalKey"=$1`, job.id);
    if (receipt?.status === "ACCEPTED") {
      await prisma.adaptiveReportJob.updateMany({ where: identity, data: { emailStatus: "SENT", emailLeaseUntil: null, emailLastErrorCode: null } });
      return;
    }
    if (job.emailAttempts >= 6 || now.getTime() - job.createdAt.getTime() >= 86400000) {
      await prisma.adaptiveReportJob.updateMany({ where: identity, data: { emailStatus: receipt?.status === "UNCERTAIN" || job.emailAttemptWindowAt ? "UNKNOWN" : "FAILED", emailLeaseUntil: null, emailLastErrorCode: "REPORT_EMAIL_LIMIT" } });
      return;
    }
    if (job.emailAttemptWindowAt && now.getTime() - job.emailAttemptWindowAt.getTime() >= SAFE_RETRY_WINDOW_MS) {
      // An earlier request may have reached Brevo. Never issue a new request
      // after its deduplication window just because the process was restarted.
      await prisma.adaptiveReportJob.updateMany({ where: identity, data: { emailStatus: "UNKNOWN", emailLeaseUntil: null, emailLastErrorCode: "BREVO_ACCEPTANCE_UNKNOWN" } });
      return;
    }
    const leaseUntil = new Date(now.getTime() + REPORT_EMAIL_LEASE_MS);
    const locked = await prisma.adaptiveReportJob.updateMany({
      where: identity,
      data: { emailStatus: "PROCESSING", emailLeaseUntil: leaseUntil, emailAttempts: { increment: 1 } },
    });
    if (locked.count !== 1) return;
    const lock = { id: job.id, emailStatus: "PROCESSING", emailLeaseUntil: leaseUntil, emailAttempts: job.emailAttempts + 1 };
    let providerAttempted = false;
    try {
      const message = buildReportEmail(job.interview, job);
      const pdf = await reportPdfRenderer.render(job.interview, job);
      message.attachments = [{ name: "SkillQuest-rapport.pdf", content: pdf.toString("base64") }];
      // Rendering is local preparation. Start the provider's deduplication
      // window only now, and recheck that administration has not deleted it.
      const active = await prisma.adaptiveReportJob.updateMany({ where: lock, data: { emailAttemptWindowAt: job.emailAttemptWindowAt ?? new Date(Date.now()) } });
      if (active.count !== 1) return;
      providerAttempted = true;
      const reportSourceHash = createHash("sha256").update(JSON.stringify([job.interview.state, job.summary])).digest("hex");
      const accepted = await sendReportEmail({ ...message, recipient: job.interview.email!, recipientName: job.interview.displayName, idempotencyKey: job.id, purpose: "REPORT", reportSourceHash,
        beforeClaim: async (tx, at) => {
          const active = await tx.$queryRawUnsafe<unknown[]>(`SELECT j.id FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId"
            WHERE j.id=$1::uuid AND j."emailStatus"='PROCESSING' AND j."emailAttempts"=$2 AND j."emailLeaseUntil"=$3 AND j."emailLeaseUntil">$4
              AND j.status=$6 AND j.summary IS NOT DISTINCT FROM $7::text
              AND j.status IN ('COMPLETE','UNAVAILABLE') AND i.state=$8::jsonb
              AND i."expiresAt">$4 AND i."reportEmailRequested" AND i.email=$5 FOR UPDATE OF j, i`,
            job.id, job.emailAttempts + 1, leaseUntil, at, job.interview.email, job.status, job.summary, JSON.stringify(job.interview.state));
          if (!active.length) throw new ReportEmailError("REPORT_OBSOLETE");
        } });
      await prisma.adaptiveReportJob.updateMany({ where: lock, data: {
        emailStatus: "SENT", emailAcceptedAt: new Date(Date.now()), emailMessageId: accepted.messageId,
        emailLeaseUntil: null, emailLastErrorCode: null,
      } });
    } catch (error) {
      const issue = error instanceof ReportEmailError ? error : new ReportEmailError("BREVO_RESPONSE_UNKNOWN", true, 30, true);
      const uncertain = providerAttempted && issue.uncertain || job.emailAttemptWindowAt !== null;
      // Bound preparation contention and crashes too; the fencing counter must
      // never be decremented/reused by an old invocation.
      const retry = issue.retryable && job.emailAttempts + 1 < 6;
      const delay = uncertain ? Math.min(issue.retryAfterSeconds, 60) : issue.retryAfterSeconds;
      const nextAttempt = new Date(Date.now() + delay * 1000);
      await prisma.adaptiveReportJob.updateMany({ where: lock, data: {
        emailStatus: retry ? "RETRY" : uncertain ? "UNKNOWN" : "FAILED",
        emailNextAttemptAt: nextAttempt, emailLeaseUntil: null,
        emailAttemptWindowAt: uncertain ? job.emailAttemptWindowAt ?? now : null,
        emailLastErrorCode: issue.code,
      } });
      if (["BREVO_QUOTA", "BREVO_RATE_LIMIT"].includes(issue.code) && retry && !jobId) {
        nextRunAt = nextAttempt.getTime();
        await prisma.adaptiveReportJob.updateMany({
          where: { emailStatus: { in: ["PENDING", "RETRY"] }, emailNextAttemptAt: { lt: nextAttempt } },
          data: { emailNextAttemptAt: nextAttempt },
        });
      }
    }
  } finally { if (!jobId) running = false; }
}

export function startReportEmailQueue() {
  const tick = () => { void processReportEmails().catch(() => console.error("Report email queue temporarily unavailable")); };
  tick();
  const timer = setInterval(tick, 1000); timer.unref();
  return () => clearInterval(timer);
}
