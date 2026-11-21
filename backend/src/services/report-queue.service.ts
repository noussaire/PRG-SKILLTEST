import { prisma } from "../db/prisma.js";
import { AIServiceError, type InterviewState } from "./adaptive.service.js";
import { reserveReportRequest } from "./ai-usage.service.js";
import { generateReportSummary, reportSummaryConfigured } from "./report-summary.service.js";
import { stagingConfiguration } from "../security/synthetic-staging.js";
import { assertJobId } from "./job-request.js";
import type { Prisma } from "@prisma/client";
import { reportEmailConfigured } from "./brevo.service.js";

export async function enqueueReport(interviewId: string) {
  return prisma.$transaction(tx => enqueueReportInTransaction(tx, interviewId));
}

export async function enqueueReportInTransaction(tx: Prisma.TransactionClient, interviewId: string) {
  const summaryAvailable = reportSummaryConfigured();
  const row = await tx.adaptiveInterview.findUniqueOrThrow({ where: { id: interviewId }, select: { reportEmailRequested: true, email: true, state: true, revision: true } });
  const state = row.state as unknown as InterviewState;
  if (state.currentQuestion || state.answers.length !== 31 || !state.summary) return null;
  if (!summaryAvailable && !(row.reportEmailRequested && row.email && reportEmailConfigured())) return null;
  // Lock the participant revision until the job exists. A delayed old request
  // must never enqueue an obsolete report after a retake has started.
  const locked = await tx.adaptiveInterview.updateMany({ where: { id: interviewId, revision: row.revision, expiresAt: { gt: new Date() } }, data: { revision: { increment: 0 } } });
  if (locked.count !== 1) return null;
  return tx.adaptiveReportJob.upsert({
    where: { interviewId },
    create: { interviewId, status: summaryAvailable ? "PENDING" : "UNAVAILABLE",
      ...(!summaryAvailable ? { lastErrorCode: "AI_NOT_CONFIGURED" } : {}),
      emailStatus: row.reportEmailRequested && row.email ? "PENDING" : "NOT_REQUESTED" }, update: {},
  });
}

let running = false;
let nextRunAt = 0;

export async function processReportQueue(jobId?: string) {
  if (jobId !== undefined) assertJobId(jobId);
  if (!jobId && (running || Date.now() < nextRunAt)) return;
  if (!jobId) { running = true; nextRunAt = Date.now() + 6000; }
  try {
    const now = new Date();
    const cooldown = await prisma.adaptiveReportJob.findFirst({ where: { lastErrorCode: { in: ["AI_QUOTA_REACHED", "AI_DAILY_LIMIT"] }, nextAttemptAt: { gt: now } }, orderBy: { nextAttemptAt: "desc" } });
    if (cooldown) { if (!jobId) nextRunAt = cooldown.nextAttemptAt.getTime(); return; }
    const job = await prisma.adaptiveReportJob.findFirst({
      where: { ...(jobId ? { id: jobId, interview: { expiresAt: { gt: now } } } : {}), OR: [{ status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } }, { status: "PROCESSING", leaseUntil: { lte: now } }] },
      orderBy: { createdAt: "asc" }, include: { interview: true },
    });
    if (!job) { if (!jobId) nextRunAt = Date.now() + 15000; return; }
    // Crashed invocations also consume attempts. Never reclaim a fourth time.
    if (job.attempts >= 3 || now.getTime() - job.createdAt.getTime() >= 86400000) {
      await prisma.adaptiveReportJob.updateMany({ where: { id: job.id, status: job.status, leaseUntil: job.leaseUntil, attempts: job.attempts },
        data: { status: "UNAVAILABLE", leaseUntil: null, lastErrorCode: "AI_ATTEMPTS_EXHAUSTED" } });
      return;
    }
    const leaseUntil = new Date(Date.now() + 60000);
    const locked = await prisma.adaptiveReportJob.updateMany({ where: { id: job.id, status: job.status, leaseUntil: job.leaseUntil, attempts: job.attempts }, data: { status: "PROCESSING", leaseUntil, attempts: { increment: 1 } } });
    if (locked.count !== 1) return;
    try {
      if (job.interview.expiresAt <= now) throw new AIServiceError("EXPIRED", 410, "Accès expiré.");
      if (!stagingConfiguration()) await reserveReportRequest();
      const summary = await generateReportSummary(job.interview.state as unknown as InterviewState);
      await prisma.adaptiveReportJob.updateMany({ where: { id: job.id, leaseUntil, status: "PROCESSING", attempts: job.attempts + 1 }, data: { status: "COMPLETE", summary, leaseUntil: null, lastErrorCode: null } });
    } catch (error) {
      const code = error instanceof AIServiceError ? error.code : "AI_UNAVAILABLE";
      const quota = code === "AI_QUOTA_REACHED" || code === "AI_DAILY_LIMIT";
      const retryable = quota || code === "AI_UNAVAILABLE" || code === "AI_INVALID_RESPONSE";
      const delay = error instanceof AIServiceError && error.retryAfterSeconds ? error.retryAfterSeconds : 60;
      const nextAttemptAt = new Date(Date.now() + delay * 1000);
      await prisma.adaptiveReportJob.updateMany({ where: { id: job.id, leaseUntil, status: "PROCESSING", attempts: job.attempts + 1 }, data: { status: retryable && job.attempts < 2 ? "RETRY" : "UNAVAILABLE", nextAttemptAt, leaseUntil: null, lastErrorCode: code } });
      if (quota && !jobId) {
        nextRunAt = nextAttemptAt.getTime();
        await prisma.adaptiveReportJob.updateMany({ where: { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lt: nextAttemptAt } }, data: { nextAttemptAt } });
      }
    }
  } finally { if (!jobId) running = false; }
}

export function startReportQueue() {
  const tick = () => { void processReportQueue().catch(() => console.error("Report queue temporarily unavailable")); };
  tick();
  const timer = setInterval(tick, 1000); timer.unref();
  return () => clearInterval(timer);
}
