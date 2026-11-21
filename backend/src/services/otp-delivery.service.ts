import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { encryptOtpPayload, decryptOtpPayload, OtpPayloadError } from "../security/otp-payload.js";
import { brevoConfigured, sendReportEmail, ReportEmailError } from "./brevo.service.js";
import { assertJobId } from "./job-request.js";
import { linkOtpTrace, logOtpEvent, safeOtpCode, withOtpContext } from "./otp-diagnostic.service.js";

const payloadSchema = z.object({ recipient: z.string().email().max(254), recipientName: z.string().max(100), subject: z.string().max(200), htmlContent: z.string().max(20000), networkOrigin: z.string().max(100).optional() });
type Payload = z.infer<typeof payloadSchema>;
type Status = "PENDING" | "ACCEPTED" | "REJECTED" | "UNCERTAIN";
type DeliveryTable = "OtpDeliveryJob" | "ParticipantEmailDeliveryJob";
type Job = { id: string; interviewId?: string; challengeId?: string; codeHash: string; encryptedPayload: string | null; status: Status; attempts: number; expiresAt: Date; attemptToken: string | null };

export class OtpDeliveryQueue {
  constructor(private db: PrismaClient, private send: typeof sendReportEmail = sendReportEmail, private clock?: () => Date) {}

  private async tx<T>(fn: (tx: Prisma.TransactionClient, now: Date) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
      const now = this.clock ? this.clock() : (await tx.$queryRawUnsafe<{ now: Date }[]>(`SELECT clock_timestamp() AS now`))[0].now;
      return fn(tx, now);
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
  }

  async enqueue(input: { interviewId: string; lastTestStartedAt: Date; codeHash: string; payload: Payload }) {
    let traceId: string | undefined;
    const result = await this.tx(async (tx, now) => {
      const row = (await tx.$queryRawUnsafe<{ retakeCodeHash: string | null; retakeCodeExpiresAt: Date | null; retakeCodeSentAt: Date | null; retakeCodeAttempts: number; lastTestStartedAt: Date }[]>(
        `SELECT "retakeCodeHash","retakeCodeExpiresAt","retakeCodeSentAt","retakeCodeAttempts","lastTestStartedAt" FROM "AdaptiveInterview" WHERE id=$1::uuid FOR UPDATE`, input.interviewId))[0];
      if (!row || row.lastTestStartedAt.getTime() !== input.lastTestStartedAt.getTime()) return null;
      const previous = row.retakeCodeHash ? (await tx.$queryRawUnsafe<Job[]>(`SELECT * FROM "OtpDeliveryJob" WHERE "interviewId"=$1::uuid AND "codeHash"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1`, input.interviewId, row.retakeCodeHash))[0] : undefined;
      traceId = previous?.id;
      if (row.retakeCodeHash && row.retakeCodeAttempts < 5 && row.retakeCodeExpiresAt && row.retakeCodeExpiresAt > now && (!previous || ["PENDING", "UNCERTAIN"].includes(previous.status))) {
        // Preserve potentially delivered legacy codes too; no migration/backfill.
        return { status: previous?.status ?? "UNCERTAIN" as Status, reused: true };
      }
      if (row.retakeCodeSentAt && now.getTime() - row.retakeCodeSentAt.getTime() < 60000) return { status: previous?.status ?? "PENDING" as Status, reused: true };
      const id = randomUUID(), expiresAt = new Date(now.getTime() + 600000);
      traceId = id;
      const encrypted = encryptOtpPayload(payloadSchema.parse(input.payload), id);
      await tx.$executeRawUnsafe(`UPDATE "AdaptiveInterview" SET "retakeCodeHash"=$2,"retakeCodeExpiresAt"=$3,"retakeCodeSentAt"=$4,"retakeCodeAttempts"=0 WHERE id=$1::uuid`, input.interviewId, input.codeHash, expiresAt, now);
      await tx.$executeRawUnsafe(`INSERT INTO "OtpDeliveryJob" (id,"interviewId","codeHash","encryptedPayload","expiresAt","nextAttemptAt","createdAt") VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$6)`, id, input.interviewId, input.codeHash, encrypted, expiresAt, now);
      return { status: "PENDING" as Status, reused: false };
    }).catch(error => {
      logOtpEvent("OTP_JOB_FAILED", "failed", { code: safeOtpCode(error) });
      throw error;
    });
    if (traceId) linkOtpTrace(traceId);
    if (result) logOtpEvent(result.reused ? "OTP_JOB_REUSED" : "OTP_JOB_CREATED", "ok", { traceId });
    else logOtpEvent("OTP_JOB_FAILED", "skipped", { code: "NO_CURRENT_JOB" });
    return result;
  }

  private async finish(table: DeliveryTable, job: Job, status: Status, next: Date | null, error: string | null = null) {
    try {
    const changed = await this.db.$executeRawUnsafe(`UPDATE "${table}" SET status=$3,"nextAttemptAt"=$4,"lastErrorCode"=$5,"leaseUntil"=NULL,"attemptToken"=NULL,
      "encryptedPayload"=CASE WHEN $3 IN ('ACCEPTED','REJECTED') THEN NULL ELSE "encryptedPayload" END
      WHERE id=$1::uuid AND "attemptToken"=$2::uuid`, job.id, job.attemptToken, status, next, error);
    logOtpEvent(changed ? "OTP_DELIVERY_STATUS" : "OTP_STATUS_PERSIST_FAILED", changed ? (status === "ACCEPTED" ? "ok" : status === "UNCERTAIN" ? "uncertain" : "failed") : "skipped",
      { traceId: job.id, deliveryState: changed ? status : undefined, code: changed ? error ?? "STATE_PERSISTED" : "LEASE_LOST" });
    } catch (error) {
      logOtpEvent("OTP_STATUS_PERSIST_FAILED", "failed", { traceId: job.id, code: safeOtpCode(error) });
      throw error;
    }
  }

  async runOnce() {
    await this.processOne("OtpDeliveryJob");
    await this.processOne("ParticipantEmailDeliveryJob");
  }

  async processJob(kind: "OTP_INITIAL" | "OTP_RETAKE", jobId: string) {
    assertJobId(jobId);
    if (kind !== "OTP_INITIAL" && kind !== "OTP_RETAKE") throw Error("JOB_KIND_INVALID");
    await this.processOne(kind === "OTP_INITIAL" ? "ParticipantEmailDeliveryJob" : "OtpDeliveryJob", jobId);
  }

  private async processOne(table: DeliveryTable, jobId?: string) {
    return withOtpContext({ traceId: jobId }, async () => {
    const committedLogs: (() => void)[] = [];
    const job = await this.tx(async (tx, now) => {
      const reconciled = await tx.$executeRawUnsafe(`UPDATE "${table}" AS job SET status='ACCEPTED',"nextAttemptAt"=NULL,"encryptedPayload"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL
        WHERE job.status='UNCERTAIN' AND (job."leaseUntil" IS NULL OR job."leaseUntil"<=$1)
        AND ($2::uuid IS NULL OR (job.id=$2::uuid AND job."expiresAt">$1))
        AND EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=job.id::text AND r.status='ACCEPTED')`, now, jobId ?? null);
      if (reconciled && jobId) committedLogs.push(() => logOtpEvent("OTP_DELIVERY_STATUS", "ok", { deliveryState: "ACCEPTED", code: "RECONCILED_ACCEPTANCE" }));
      // Remove expired sensitive payloads, without clearing a still-valid OTP.
      if (!jobId) await tx.$executeRawUnsafe(`UPDATE "${table}" SET "encryptedPayload"=NULL,"nextAttemptAt"=NULL,
        status=CASE WHEN status='PENDING' THEN 'REJECTED' ELSE status END,"lastErrorCode"=COALESCE("lastErrorCode",'OTP_EXPIRED'),"leaseUntil"=NULL,"attemptToken"=NULL
        WHERE "expiresAt"<=$1 AND ("leaseUntil" IS NULL OR "leaseUntil"<=$1) AND ("encryptedPayload" IS NOT NULL OR "nextAttemptAt" IS NOT NULL)`, now);
      // Cleanup/reconciliation must continue even if provider configuration is
      // temporarily removed. Leave unexpired work queued while sending is off.
      if (this.send === sendReportEmail && !brevoConfigured()) {
        committedLogs.push(() => logOtpEvent("BREVO_SEND_SKIPPED", "disabled", { code: "BREVO_NOT_CONFIGURED" }));
        return null;
      }
      const row = (await tx.$queryRawUnsafe<Job[]>(`SELECT * FROM "${table}" WHERE status IN ('PENDING','UNCERTAIN') AND "nextAttemptAt"<=$1
        AND ($2::uuid IS NULL OR (id=$2::uuid AND "expiresAt">$1))
        AND ("leaseUntil" IS NULL OR "leaseUntil"<=$1) ORDER BY "nextAttemptAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`, now, jobId ?? null))[0];
      if (!row) {
        committedLogs.push(() => logOtpEvent("NO_JOB_READY", "waiting", { code: "NO_ELIGIBLE_JOB" }));
        return null;
      }
      const reservation = (await tx.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM "EmailBudgetReservation" WHERE "logicalKey"=$1`, row.id))[0];
      if (reservation?.status === "ACCEPTED" || reservation?.status === "UNCERTAIN") {
        const status = reservation.status as Status;
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET status=$2,"nextAttemptAt"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL,
          "encryptedPayload"=CASE WHEN $2='ACCEPTED' THEN NULL ELSE "encryptedPayload" END WHERE id=$1::uuid`, row.id, status);
        committedLogs.push(() => {
          logOtpEvent("BREVO_SEND_SKIPPED", "skipped", { traceId: row.id, code: status === "ACCEPTED" ? "ALREADY_ACCEPTED" : "EMAIL_PROVIDER_UNCERTAIN" });
          logOtpEvent("OTP_DELIVERY_STATUS", status === "ACCEPTED" ? "ok" : "uncertain", { traceId: row.id, deliveryState: status, code: "STATE_PERSISTED" });
        });
        return null; // A crash may have followed provider acceptance: never resend.
      }
      const current = table === "OtpDeliveryJob"
        ? (await tx.$queryRawUnsafe<unknown[]>(`SELECT id FROM "AdaptiveInterview" WHERE id=$1::uuid AND "retakeCodeHash"=$2 AND "retakeCodeExpiresAt">$3 AND "retakeCodeAttempts"<5`, row.interviewId, row.codeHash, now)).length
        : (await tx.$queryRawUnsafe<unknown[]>(`SELECT c.id FROM "EmailOtpChallenge" c JOIN "ParticipantEmailGate" g ON g."challengeId"=c.id WHERE c.id=$1::uuid AND c."codeHash"=$2 AND c."consumedAt" IS NULL AND c."expiresAt">$3 AND c.attempts<LEAST(5,c."maxAttempts")`, row.challengeId, row.codeHash, now)).length;
      if (!current || !row.encryptedPayload || row.attempts >= 6) {
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET status='REJECTED',"nextAttemptAt"=NULL,"encryptedPayload"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL,"lastErrorCode"='OTP_OBSOLETE' WHERE id=$1::uuid`, row.id);
        committedLogs.push(() => logOtpEvent("OTP_DELIVERY_STATUS", "failed", { traceId: row.id, deliveryState: "REJECTED", code: "OTP_OBSOLETE" }));
        return null;
      }
      const token = randomUUID(), lease = new Date(now.getTime() + 120000);
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET status='UNCERTAIN',attempts=attempts+1,"attemptToken"=$2::uuid,"leaseUntil"=$3,"nextAttemptAt"=$3 WHERE id=$1::uuid`, row.id, token, lease);
      return { ...row, attempts: row.attempts + 1, attemptToken: token };
    }).catch(error => {
      logOtpEvent("WORKER_FAILED", "failed", { code: safeOtpCode(error) });
      throw error;
    });
    for (const log of committedLogs) log();
    if (!job) return;
    return withOtpContext({ traceId: job.id }, async () => {
    logOtpEvent("JOB_SELECTED", "ok", { attempt: job.attempts });
    let payload: Payload;
    try { payload = payloadSchema.parse(decryptOtpPayload(job.encryptedPayload!, job.id)); }
    catch (error) {
      logOtpEvent("BREVO_SEND_SKIPPED", "skipped", { code: safeOtpCode(error) });
      if (error instanceof OtpPayloadError) {
        // A stale worker/keyring must not destroy a still-valid message. No
        // provider call occurred: keep the immutable payload/UUID and do not
        // spend a transport attempt while local preparation is blocked.
        const changed = await this.tx(async (tx, now) => {
          return tx.$executeRawUnsafe(`UPDATE "${table}" SET status=$3,attempts=GREATEST(0,attempts-1),
            "nextAttemptAt"=$4,"lastErrorCode"=$5,"leaseUntil"=NULL,"attemptToken"=NULL
            WHERE id=$1::uuid AND "attemptToken"=$2::uuid`, job.id, job.attemptToken, job.status,
            new Date(now.getTime() + 60000), error.code);
        }).catch(error => {
          logOtpEvent("OTP_STATUS_PERSIST_FAILED", "failed", { code: safeOtpCode(error) });
          throw error;
        });
        logOtpEvent(changed ? "OTP_DELIVERY_STATUS" : "OTP_STATUS_PERSIST_FAILED", changed ? "waiting" : "skipped",
          { deliveryState: changed ? job.status : undefined, code: changed ? safeOtpCode(error) : "LEASE_LOST" });
      } else await this.finish(table, job, "REJECTED", null, "OTP_PAYLOAD_INVALID");
      return;
    }
    try {
      await this.send({ ...payload, idempotencyKey: job.id, purpose: "OTP", beforeClaim: async (tx, now) => {
        const rows = table === "ParticipantEmailDeliveryJob"
          ? await tx.$queryRawUnsafe<unknown[]>(`SELECT j.id FROM "ParticipantEmailDeliveryJob" j
              JOIN "EmailOtpChallenge" c ON c.id=j."challengeId" JOIN "ParticipantEmailGate" g ON g."challengeId"=c.id
              WHERE j.id=$1::uuid AND j."attemptToken"=$2::uuid AND j.status='UNCERTAIN' AND j."leaseUntil">$3 AND j."expiresAt">$3
              AND c."codeHash"=j."codeHash" AND c."consumedAt" IS NULL AND c."expiresAt">$3 AND c.attempts<LEAST(5,c."maxAttempts") FOR UPDATE OF j`, job.id, job.attemptToken, now)
          : await tx.$queryRawUnsafe<unknown[]>(`SELECT j.id FROM "OtpDeliveryJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId"
              WHERE j.id=$1::uuid AND j."attemptToken"=$2::uuid AND j.status='UNCERTAIN' AND j."leaseUntil">$3 AND j."expiresAt">$3
              AND i."retakeCodeHash"=j."codeHash" AND i."retakeCodeExpiresAt">$3 AND i."retakeCodeAttempts"<5 FOR UPDATE OF j`, job.id, job.attemptToken, now);
        if (!rows.length) throw new ReportEmailError("OTP_OBSOLETE");
      } });
      await this.finish(table, job, "ACCEPTED", null);
    } catch (error) {
      // Unknown exceptions include a failure to persist the provider result.
      const issue = error instanceof ReportEmailError ? error : new ReportEmailError("OTP_RESPONSE_UNKNOWN", false, 60, true);
      const reservation = (await this.db.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM "EmailBudgetReservation" WHERE "logicalKey"=$1`, job.id))[0];
      if (reservation?.status === "ACCEPTED") { await this.finish(table, job, "ACCEPTED", null); return; }
      if (issue.uncertain || reservation?.status === "UNCERTAIN") { await this.finish(table, job, "UNCERTAIN", null, issue.code); return; }
      // Known refusals may retry the same immutable payload/key before expiry.
      const finalState: { value: Status } = { value: "REJECTED" };
      const changed = await this.tx(async (_tx, now) => {
        const next = new Date(now.getTime() + Math.max(1, issue.retryAfterSeconds) * 1000);
        const retry = issue.retryable && job.attempts < 6 && next < job.expiresAt;
        finalState.value = retry ? "PENDING" : "REJECTED";
        // Use the same transaction connection to avoid pool deadlock.
        return _tx.$executeRawUnsafe(`UPDATE "${table}" SET status=$3,"nextAttemptAt"=$4,"lastErrorCode"=$5,"leaseUntil"=NULL,"attemptToken"=NULL,
          "encryptedPayload"=CASE WHEN $3='REJECTED' THEN NULL ELSE "encryptedPayload" END WHERE id=$1::uuid AND "attemptToken"=$2::uuid`, job.id, job.attemptToken, retry ? "PENDING" : "REJECTED", retry ? next : null, issue.code);
      }).catch(error => {
        logOtpEvent("OTP_STATUS_PERSIST_FAILED", "failed", { code: safeOtpCode(error) });
        throw error;
      });
      logOtpEvent(changed ? "OTP_DELIVERY_STATUS" : "OTP_STATUS_PERSIST_FAILED", changed ? (finalState.value === "PENDING" ? "waiting" : "failed") : "skipped",
        { deliveryState: changed ? finalState.value : undefined, code: changed ? safeOtpCode(issue) : "LEASE_LOST" });
    }
    });
    });
  }
}

export async function processOtpDeliveries() {
  const { prisma } = await import("../db/prisma.js");
  await new OtpDeliveryQueue(prisma).runOnce();
}

export function startOtpDeliveryQueue() {
  let running = false, stopped = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await processOtpDeliveries(); } catch { console.error("OTP delivery queue temporarily unavailable"); }
    finally { running = false; }
  };
  void tick(); const timer = setInterval(() => { void tick(); }, 1000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
