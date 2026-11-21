import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { jobRequestSchema, type JobRequest } from "./job-request.js";
import type { MaintenanceControl } from "./maintenance-control.js";
import { logOtpEvent, safeOtpCode, withOtpContext } from "./otp-diagnostic.service.js";

export type JobNotification = JobRequest & { version: 1; notificationId: string; generation: number; dueAt: string };
export interface JobPublisher { publish(notification: JobNotification, signal: AbortSignal): Promise<void> }
type Intent = JobRequest & { id: string; generation: number; dueAt: Date; attempts: number; attemptToken: string };
const bounded = (value: number) => { if (!Number.isInteger(value) || value < 1 || value > 100) throw Error("JOB_BATCH_INVALID"); return value; };

// No provider implementation, default publisher, endpoint or timer is installed.
export class JobPublications {
  constructor(private db: PrismaClient, private control?: MaintenanceControl, private dailyPublicationLimit?: number) {
    if (dailyPublicationLimit !== undefined && (!Number.isSafeInteger(dailyPublicationLimit) || dailyPublicationLimit < 0 || dailyPublicationLimit > 1000)) throw Error("DISPATCH_LIMIT_INVALID");
  }
  private tx<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    if (this.control) return this.control.transaction(this.db, work);
    return this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
      return work(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
  }

  // Each invocation is bounded. A scheduler/transport is intentionally absent.
  async reconcile(limit = 25, phases: readonly ("reports" | "intents" | "cancelled" | "rearmed")[] = ["reports", "intents", "cancelled", "rearmed"]) {
    bounded(limit);
    const { enqueueReportInTransaction } = await import("./report-queue.service.js");
    const reports = phases.includes("reports") ? await this.tx(async tx => {
      const missing = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT i.id FROM "AdaptiveInterview" i
        WHERE i."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND i.state->>'engine' IS NOT NULL
        AND i.state->'currentQuestion'='null'::jsonb AND jsonb_typeof(i.state->'answers')='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(i.state->'answers')='array' THEN i.state->'answers' ELSE '[]'::jsonb END)=31 AND i.state->>'summary' IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "AdaptiveReportJob" j WHERE j."interviewId"=i.id)
        ORDER BY i.id LIMIT $1 FOR UPDATE OF i SKIP LOCKED`, limit);
      let created = 0;
      for (const row of missing) if (await enqueueReportInTransaction(tx, row.id)) created++;
      return created;
    }) : 0;
    const intents = phases.includes("intents") ? await this.tx(tx => tx.$executeRawUnsafe(`INSERT INTO "JobPublicationIntent" (kind,"jobId",phase,generation,"dueAt","nextAttemptAt")
      SELECT c.kind,c."jobId",c.phase,c.generation,c."dueAt",c."dueAt" FROM "JobPublicationReady" c
      WHERE NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p.kind=c.kind AND p."jobId"=c."jobId" AND p.phase=c.phase AND p.generation=c.generation AND p."dueAt"=c."dueAt")
      ORDER BY c."dueAt",c.kind,c."jobId",c.phase LIMIT $1 ON CONFLICT DO NOTHING`, limit)) : 0;
    const cancelled = phases.includes("cancelled") ? await this.tx(tx => tx.$executeRawUnsafe(`WITH stale AS (
      SELECT p.id FROM "JobPublicationIntent" p WHERE p.state IN ('PENDING','PUBLISHING')
      AND (p."leaseUntil" IS NULL OR p."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
      AND NOT EXISTS (SELECT 1 FROM "JobPublicationReady" c WHERE c.kind=p.kind AND c."jobId"=p."jobId" AND c.phase=p.phase AND c.generation=p.generation AND c."dueAt"=p."dueAt")
      ORDER BY p."createdAt",p.id LIMIT $1 FOR UPDATE OF p SKIP LOCKED)
      UPDATE "JobPublicationIntent" p SET state='CANCELLED',"attemptToken"=NULL,"leaseUntil"=NULL,"lastErrorCode"='JOB_NOT_EXECUTABLE'
      FROM stale s WHERE p.id=s.id`, limit)) : 0;
    // Confirmed publication is not proof of receipt. If the same activation
    // remains idle for two minutes, advance only its wake time. SQL triggers
    // create a NEW notification UUID; the Brevo job UUID remains unchanged.
    const rearmed = phases.includes("rearmed") ? await this.tx(async tx => {
      let total = 0;
      const targets = [
        ["OTP_INITIAL", "ParticipantEmailDeliveryJob", "DELIVER", "nextAttemptAt", "status"],
        ["OTP_RETAKE", "OtpDeliveryJob", "DELIVER", "nextAttemptAt", "status"],
        ["REPORT", "AdaptiveReportJob", "SUMMARY", "nextAttemptAt", "status"],
        ["REPORT", "AdaptiveReportJob", "EMAIL", "emailNextAttemptAt", "emailStatus"],
      ];
      for (const [kind, table, phase, due, status] of targets) {
        if (total >= limit) break;
        total += await tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now), stalled AS (
          SELECT j.id FROM "${table}" j JOIN "JobPublicationIntent" p ON p."jobId"=j.id AND p.kind=$1 AND p.phase=$2
          JOIN "JobPublicationReady" c ON c.kind=p.kind AND c."jobId"=p."jobId" AND c.phase=p.phase AND c.generation=p.generation AND c."dueAt"=p."dueAt" CROSS JOIN clock
          WHERE p.state='PUBLISHED' AND p."publishedAt"<=clock.now-interval '120 seconds' AND c."dueAt"<=clock.now AND j."${due}"=c."dueAt" AND j."${status}" IN ('PENDING','RETRY')
          AND (SELECT COALESCE(sum(b.attempts),0) FROM "JobPublicationIntent" b WHERE b.kind=p.kind AND b."jobId"=p."jobId" AND b.phase=p.phase)<24
          ORDER BY p."publishedAt",j.id LIMIT $3 FOR UPDATE OF j SKIP LOCKED)
          UPDATE "${table}" j SET "${due}"=GREATEST(clock.now,j."${due}"+interval '1 millisecond') FROM stalled,clock WHERE j.id=stalled.id`, kind, phase, limit-total);
      }
      return total;
    }) : 0;
    return { reports, intents, cancelled, rearmed };
  }

  async retire(limit = 25) {
    bounded(limit);
    const retiredOtp: { id: string; status: string }[] = [];
    const result = await this.tx(async tx => {
      // Never discard evidence or interrupt a live provider reservation/worker.
      const summaries = await tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now), old AS (
        SELECT j.id FROM "AdaptiveReportJob" j JOIN "JobLifetime" l ON l.kind='REPORT' AND l."jobId"=j.id CROSS JOIN clock
        WHERE j.status IN ('PENDING','RETRY','PROCESSING') AND (j.attempts>=3 OR l."expiresAt"<=clock.now)
          AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
        ORDER BY j."createdAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
        UPDATE "AdaptiveReportJob" j SET status='UNAVAILABLE',"leaseUntil"=NULL,"lastErrorCode"='AI_ATTEMPTS_EXHAUSTED' FROM old o WHERE j.id=o.id`, limit);
      const reports = await tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now), old AS (
        SELECT j.id,r.status AS receipt FROM "AdaptiveReportJob" j JOIN "JobLifetime" l ON l.kind='REPORT' AND l."jobId"=j.id
        LEFT JOIN "EmailBudgetReservation" r ON r."logicalKey"=j.id::text CROSS JOIN clock
        WHERE (l."expiresAt"<=clock.now OR j."emailAttempts">=6)
          AND j."emailStatus" IN ('PENDING','RETRY','PROCESSING','UNKNOWN')
          AND (j."emailLeaseUntil" IS NULL OR j."emailLeaseUntil"<=clock.now)
          AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
          AND (r."leaseUntil" IS NULL OR r."leaseUntil"<=clock.now)
        ORDER BY j."createdAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
        UPDATE "AdaptiveReportJob" j SET "emailStatus"=CASE WHEN o.receipt='ACCEPTED' THEN 'SENT'
          WHEN o.receipt='UNCERTAIN' OR j."emailAttemptWindowAt" IS NOT NULL THEN 'UNKNOWN' ELSE 'FAILED' END,
          "emailLeaseUntil"=NULL,"emailLastErrorCode"=CASE WHEN o.receipt='ACCEPTED' THEN NULL ELSE 'REPORT_EMAIL_LIMIT' END
        FROM old o WHERE j.id=o.id`, limit);
      // Expired ciphertext is erased even while all transports are disabled.
      let otp = 0;
      for (const table of ["ParticipantEmailDeliveryJob", "OtpDeliveryJob"]) {
        const retired = await tx.$queryRawUnsafe<{ id: string; status: string }[]>(`WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now), old AS (
          SELECT j.id,r.status AS receipt FROM "${table}" j LEFT JOIN "EmailBudgetReservation" r ON r."logicalKey"=j.id::text CROSS JOIN clock
          WHERE (j."expiresAt"<=clock.now OR j.attempts>=6) AND (j."encryptedPayload" IS NOT NULL OR j."nextAttemptAt" IS NOT NULL)
            AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now) AND (r."leaseUntil" IS NULL OR r."leaseUntil"<=clock.now)
          ORDER BY j."expiresAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
          UPDATE "${table}" j SET status=CASE WHEN o.receipt='ACCEPTED' THEN 'ACCEPTED' WHEN o.receipt='UNCERTAIN' THEN 'UNCERTAIN'
            WHEN j.status='PENDING' THEN 'REJECTED' ELSE j.status END,
            "encryptedPayload"=NULL,"nextAttemptAt"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL,
            "lastErrorCode"=CASE WHEN o.receipt='ACCEPTED' THEN NULL ELSE 'OTP_EXPIRED_OR_EXHAUSTED' END FROM old o WHERE j.id=o.id
          RETURNING j.id,j.status`, limit);
        retiredOtp.push(...retired);
        otp += retired.length;
      }
      return { reports, otp, summaries };
    });
    for (const row of retiredOtp) logOtpEvent("OTP_DELIVERY_STATUS", row.status === "ACCEPTED" ? "ok" : row.status === "UNCERTAIN" ? "uncertain" : "failed",
      { traceId: row.id, deliveryState: row.status, code: row.status === "ACCEPTED" ? "RECONCILED_ACCEPTANCE" : "OTP_EXPIRED_OR_EXHAUSTED" });
    return result;
  }

  private claim() {
    return this.tx(async tx => {
      // Persist the weighted cursor, so one-item dispatches after cold starts
      // still give a waiting report every third opportunity. Empty classes lend
      // their slot. Lock before selecting to serialize quota/fairness decisions.
      const [fair] = await tx.$queryRawUnsafe<{ cursor: number }[]>(`SELECT cursor FROM "JobDispatchState" WHERE singleton=1 FOR UPDATE`);
      if (!fair) throw Error("DISPATCH_MIGRATION_REQUIRED");
      const token = randomUUID();
      const intent = (await tx.$queryRawUnsafe<Intent[]>(`WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now), candidate AS (
        SELECT p.id FROM "JobPublicationIntent" p JOIN "JobPublicationReady" c ON c.kind=p.kind AND c."jobId"=p."jobId" AND c.phase=p.phase AND c.generation=p.generation AND c."dueAt"=p."dueAt" CROSS JOIN clock
        WHERE ((p.state='PENDING' AND p."nextAttemptAt"<=clock.now) OR (p.state='PUBLISHING' AND p."leaseUntil"<=clock.now))
        AND c."dueAt"<=clock.now
        AND (SELECT COALESCE(sum(b.attempts),0) FROM "JobPublicationIntent" b WHERE b.kind=p.kind AND b."jobId"=p."jobId" AND b.phase=p.phase)<24
        ORDER BY CASE WHEN (p.kind='REPORT')=$2 THEN 0 ELSE 1 END,p."nextAttemptAt",p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED)
        UPDATE "JobPublicationIntent" p SET state='PUBLISHING',attempts=p.attempts+1,"attemptToken"=$1::uuid,"leaseUntil"=clock.now+interval '30 seconds'
        FROM candidate c,clock WHERE p.id=c.id RETURNING p.*`, token, fair.cursor === 2))[0];
      if (intent) {
        if (this.dailyPublicationLimit !== undefined) {
          // Reserve initial delivery + all three configured QStash retries.
          // Scheduler calls/other apps must be excluded from this allocation.
          const charged = await tx.$queryRawUnsafe<unknown[]>(`INSERT INTO "JobDispatchUsage" (day,attempts) SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date,4 WHERE $1::int>=4
            ON CONFLICT (day) DO UPDATE SET attempts="JobDispatchUsage".attempts+4 WHERE "JobDispatchUsage".attempts+4<=$1 RETURNING day`, this.dailyPublicationLimit);
          if (!charged.length) throw Error("DISPATCH_DAILY_LIMIT"); // roll back claim
        }
        await tx.$executeRawUnsafe(`UPDATE "JobDispatchState" SET cursor=(cursor+1)%3 WHERE singleton=1`);
      }
      return intent;
    });
  }

  async publishBatch(publisher: JobPublisher, limit = 25) {
    bounded(limit);
    let published = 0, deferred = 0, stale = 0;
    for (let n = 0; n < limit; n++) {
      this.control?.check();
      const intent = await this.claim();
      if (!intent) { logOtpEvent("NO_JOB_READY", "waiting", { code: "NO_ELIGIBLE_JOB" }); break; }
      logOtpEvent("JOB_SELECTED", "ok", { traceId: intent.jobId, notificationId: intent.id, attempt: intent.attempts });
      await withOtpContext({ traceId: intent.jobId }, async () => {
      const request = jobRequestSchema.parse({ kind: intent.kind, jobId: intent.jobId, phase: intent.phase });
      const notification: JobNotification = { ...request, version: 1, notificationId: intent.id, generation: intent.generation, dueAt: intent.dueAt.toISOString() };
      const abort = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => abort.abort();
      this.control?.signal?.addEventListener("abort", cancel, { once: true });
      if (this.control?.signal?.aborted) abort.abort();
      let accepted = false;
      try {
        await Promise.race([publisher.publish(notification, abort.signal), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { abort.abort(); reject(Error("PUBLICATION_TIMEOUT")); }, Math.max(1, Math.min(5000, this.control ? this.control.remaining() - 1000 : 5000)));
        })]);
        accepted = true;
      } catch (error) {
        // The provider may have accepted it: retry the SAME notification UUID.
        logOtpEvent("QSTASH_PUBLISH_FAILED", "uncertain", { code: safeOtpCode(error), notificationId: intent.id });
      }
      finally { if (timeout) clearTimeout(timeout); this.control?.signal?.removeEventListener("abort", cancel); }
      const changed = await this.tx(tx => tx.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET state=$3,"attemptToken"=NULL,"leaseUntil"=NULL,
        "publishedAt"=CASE WHEN $3='PUBLISHED' THEN (clock_timestamp() AT TIME ZONE 'UTC') ELSE "publishedAt" END,
        "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')+($4::int*interval '1 second'),"lastErrorCode"=$5
        WHERE id=$1::uuid AND "attemptToken"=$2::uuid AND state='PUBLISHING'`, intent.id, intent.attemptToken,
        accepted ? "PUBLISHED" : "PENDING", Math.min(300, 2 ** Math.min(intent.attempts, 8)), accepted ? null : "PUBLICATION_RESULT_UNKNOWN")).catch(error => {
          logOtpEvent("QSTASH_PUBLISH_FAILED", "uncertain", { code: safeOtpCode(error), notificationId: intent.id });
          throw error;
        });
      if (!changed) stale++; else if (accepted) published++; else deferred++;
      if (!changed) logOtpEvent("QSTASH_PUBLISH_FAILED", "uncertain", { code: "LEASE_LOST", notificationId: intent.id });
      });
    }
    return { published, deferred, stale };
  }
}
