import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { emailLimits, emailSubjectHash, EmailLimitError, normalizedEmailIdentity } from "./email-limits.js";
import type { MaintenanceControl } from "./maintenance-control.js";

type Tx = Prisma.TransactionClient;
type Reservation = {
  id: string; requestHash: string; purpose: string; status: string;
  budgetWindowStart: Date; retrySafeUntil: Date | null; leaseUntil: Date | null;
};
export type EmailClaim = { id: string; token: string; duplicate: boolean; previouslyUncertain?: boolean };
export const EMAIL_RETENTION_BATCH_SIZE = 100;
type SendInput = { key: string; requestHash: string; recipient: string; purpose: "OTP" | "REPORT"; networkOrigin?: string };

// A shared provider row is locked before any counter/reservation/transition.
// This intentionally serializes the small daily allowance, across all processes.
export class EmailBudget {
  constructor(private db: PrismaClient, private clock?: () => Date) {}

  // Production uses the shared database clock. Tests may inject a synthetic clock.
  async transactionNow(tx: Tx): Promise<Date> {
    if (this.clock) return this.clock();
    return (await tx.$queryRawUnsafe<{ now: Date }[]>(`SELECT clock_timestamp() AS now`))[0].now;
  }

  private async locked<T>(work: (tx: Tx, now: Date) => Promise<T>, control?: MaintenanceControl): Promise<T> {
    if (control) return control.transaction(this.db, async tx => {
      await tx.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider) VALUES ('BREVO') ON CONFLICT DO NOTHING`);
      await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);
      return work(tx, await this.transactionNow(tx));
    });
    return this.db.$transaction(async tx => {
      // Prisma uses timestamp-without-time-zone columns. Normalize raw bound
      // instants independently of the host/database session timezone.
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
      await tx.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider) VALUES ('BREVO') ON CONFLICT DO NOTHING`);
      await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);
      return work(tx, await this.transactionNow(tx));
    }, { isolationLevel: "ReadCommitted", timeout: 5000, maxWait: 2000 });
  }

  private day(now: Date) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
  private subjects(recipient: string, networkOrigin?: string) {
    return [
      ["IDENTITY", emailSubjectHash("IDENTITY", normalizedEmailIdentity(recipient))],
      ["NETWORK", emailSubjectHash("NETWORK", networkOrigin?.startsWith("proof-v1:")
        ? `${networkOrigin}|${normalizedEmailIdentity(recipient)}` : networkOrigin || "unknown-origin")],
      ["GLOBAL", emailSubjectHash("GLOBAL", "all")],
    ] as const;
  }

  private async counter(tx: Tx, scope: string, subject: string, metric: string, day: Date, limit: number, increment: boolean) {
    const end = new Date(day.getTime() + 86400000);
    if (increment) {
      if (limit === 0) throw new EmailLimitError("EMAIL_LOCAL_LIMIT", 86400);
      const rows = await tx.$queryRawUnsafe<unknown[]>(`
        INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count)
        VALUES ($1,$2,$3,$4,$5,1)
        ON CONFLICT (scope,"subjectHash",metric,"windowStart") DO UPDATE
        SET count="EmailAbuseCounter".count+1 WHERE "EmailAbuseCounter".count<$6 RETURNING count`, scope, subject, metric, day, end, limit);
      if (!rows.length) throw new EmailLimitError("EMAIL_LOCAL_LIMIT", 86400);
    } else {
      const rows = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT count FROM "EmailAbuseCounter" WHERE scope=$1 AND "subjectHash"=$2 AND metric=$3 AND "windowStart"=$4`, scope, subject, metric, day);
      if ((rows[0]?.count ?? 0) >= limit) throw new EmailLimitError("EMAIL_LOCAL_LIMIT", 86400);
    }
  }

  async claim(input: SendInput, beforeClaim?: (tx: Tx, now: Date) => Promise<void>): Promise<EmailClaim> {
    return this.locked(async (tx, now) => {
      // Worker ownership and eligibility must be checked inside the SAME
      // transaction as reservation, not only before local preparation.
      if (beforeClaim) await beforeClaim(tx, now);
      const limits = emailLimits(), day = this.day(now);
      const old = (await tx.$queryRawUnsafe<Reservation[]>(`SELECT * FROM "EmailBudgetReservation" WHERE "logicalKey"=$1`, input.key))[0];
      if (old && (old.requestHash !== input.requestHash || old.purpose !== input.purpose)) throw new EmailLimitError("EMAIL_REQUEST_CHANGED");
      if (old?.status === "ACCEPTED") return { id: old.id, token: "", duplicate: true };
      if (limits.dailyBudget === 0) throw new EmailLimitError("EMAIL_LOCAL_LIMIT", 86400);
      const provider = (await tx.$queryRawUnsafe<{ blockedUntil: Date | null; reasonCode: string | null }[]>(`SELECT "blockedUntil","reasonCode" FROM "EmailProviderState" WHERE provider='BREVO'`))[0];
      if (provider.blockedUntil && provider.blockedUntil > now) throw new EmailLimitError(provider.reasonCode || "BREVO_RATE_LIMIT", Math.ceil((provider.blockedUntil.getTime() - now.getTime()) / 1000));
      if (old?.leaseUntil && old.leaseUntil > now) throw new EmailLimitError("EMAIL_SEND_BUSY", 120, true);
      if (old?.status === "UNCERTAIN" && (!old.retrySafeUntil || old.retrySafeUntil <= now)) throw new EmailLimitError("BREVO_ACCEPTANCE_UNKNOWN", 86400, true);
      // Never re-charge an uncertain logical send across budget-day rollover.
      // Stop rather than trust provider deduplication across accounting windows.
      if (old?.status === "UNCERTAIN" && old.budgetWindowStart.getTime() !== day.getTime()) throw new EmailLimitError("BREVO_ACCEPTANCE_UNKNOWN", 86400, true);
      // Conservatively charge known refusals too. No local refund after provider contact.
      if (!old || old.budgetWindowStart.getTime() !== day.getTime()) {
        await this.counter(tx, "GLOBAL", emailSubjectHash("GLOBAL", "all"), "EMAIL_UNITS", day, limits.dailyBudget, true);
      }
      if (!old && input.purpose === "OTP") {
        const subjects = this.subjects(input.recipient, input.networkOrigin);
        const sendLimits = [limits.identitySends, limits.networkSends, limits.globalSends];
        const failureLimits = [limits.identityFailures, limits.networkFailures, limits.globalFailures];
        for (let i = 0; i < subjects.length; i++) {
          const [scope, hash] = subjects[i];
          await this.counter(tx, scope, hash, "OTP_FAILURE", day, failureLimits[i], false);
          await this.counter(tx, scope, hash, "OTP_SEND", day, sendLimits[i], true);
        }
        const throttle = await tx.$queryRawUnsafe<unknown[]>(`INSERT INTO "EmailOtpThrottle" ("identityHash","nextSendAt") VALUES ($1,$2)
          ON CONFLICT ("identityHash") DO UPDATE SET "nextSendAt"=EXCLUDED."nextSendAt"
          WHERE "EmailOtpThrottle"."nextSendAt"<=$3 RETURNING "identityHash"`, subjects[0][1], new Date(now.getTime() + 60000), now);
        if (!throttle.length) throw new EmailLimitError("EMAIL_OTP_COOLDOWN", 60);
      }
      const token = randomUUID(), id = old?.id ?? randomUUID();
      // Persist UNCERTAIN before touching the provider: crashes retain the budget.
      const safeUntil = old?.status === "UNCERTAIN" ? old.retrySafeUntil! : new Date(now.getTime() + 10 * 60000);
      if (!old) {
        await tx.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation"
          (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash","providerAttemptedAt","retrySafeUntil","leaseUntil","expiresAt",status,"attemptToken")
          VALUES ($1::uuid,$2::text,$3,$4,$2::uuid,$5,$6,$7,$8,$9,'UNCERTAIN',$10::uuid)`, id, input.key, input.purpose, day, input.requestHash, now, safeUntil, new Date(now.getTime() + 120000), new Date(now.getTime() + 30 * 86400000), token);
      } else {
        await tx.$executeRawUnsafe(`UPDATE "EmailBudgetReservation" SET status='UNCERTAIN',"budgetWindowStart"=$2,
          "providerAttemptedAt"=$3,"retrySafeUntil"=$4,"leaseUntil"=$5,"attemptToken"=$6::uuid WHERE id=$1::uuid`, id, day, now, safeUntil, new Date(now.getTime() + 120000), token);
      }
      return { id, token, duplicate: false, previouslyUncertain: old?.status === "UNCERTAIN" };
    });
  }

  async finish(claim: EmailClaim, outcome: { accepted?: boolean; uncertain?: boolean; code?: string; retryAfterSeconds?: number }) {
    await this.locked(async (tx, now) => {
      const changed = await tx.$executeRawUnsafe(`UPDATE "EmailBudgetReservation" SET status=$3,"leaseUntil"=NULL,"attemptToken"=NULL
        WHERE id=$1::uuid AND "attemptToken"=$2::uuid`, claim.id, claim.token, outcome.accepted ? "ACCEPTED" : outcome.uncertain || claim.previouslyUncertain ? "UNCERTAIN" : "REJECTED");
      if (changed !== 1) throw new EmailLimitError("EMAIL_STALE_ATTEMPT", 120, true);
      if (outcome.code === "BREVO_QUOTA" || outcome.code === "BREVO_RATE_LIMIT") {
        const seconds = Math.max(1, Math.min(86400, outcome.retryAfterSeconds ?? 60));
        await tx.$executeRawUnsafe(`UPDATE "EmailProviderState" SET "blockedUntil"=GREATEST(COALESCE("blockedUntil",$1),$1),
          "reasonCode"=CASE WHEN "blockedUntil">$1 THEN "reasonCode" ELSE $2 END, revision=revision+1,"updatedAt"=$3 WHERE provider='BREVO'`, new Date(now.getTime() + seconds * 1000), outcome.code, now);
      }
    });
  }

  // Challenge validation and participant creation share this transaction with
  // cumulative failures. Returning an invalid result commits the failed attempt;
  // throwing aborts every mutation, including any participant/token creation.
  async withOtpAttempt<T>(email: string, networkOrigin: string | undefined, work: (tx: Tx, now: Date, recordFailure: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.locked(async (tx, now) => {
      const limits = emailLimits(), day = this.day(now), subjects = this.subjects(email, networkOrigin);
      const caps = [limits.identityFailures, limits.networkFailures, limits.globalFailures];
      for (let i = 0; i < subjects.length; i++) await this.counter(tx, subjects[i][0], subjects[i][1], "OTP_FAILURE", day, caps[i], false);
      return work(tx, now, async () => {
        for (let i = 0; i < subjects.length; i++) await this.counter(tx, subjects[i][0], subjects[i][1], "OTP_FAILURE", day, caps[i], true);
      });
    });
  }

  // Same shared lock and transaction as per-code attempt accounting. Resending
  // never touches OTP_FAILURE counters, even when it replaces the code hash.
  async retakeAttempt(input: { id: string; hash: string; correct: boolean; email: string; networkOrigin?: string }) {
    return this.locked(async (tx, now) => {
      const l = emailLimits(), day = this.day(now), subjects = this.subjects(input.email, input.networkOrigin);
      const caps = [l.identityFailures, l.networkFailures, l.globalFailures];
      for (let i = 0; i < subjects.length; i++) await this.counter(tx, subjects[i][0], subjects[i][1], "OTP_FAILURE", day, caps[i], false);
      const rows = await tx.$queryRawUnsafe<unknown[]>(`UPDATE "AdaptiveInterview" SET "retakeCodeAttempts"="retakeCodeAttempts"+1
        WHERE id=$1::uuid AND "retakeCodeHash"=$2 AND "retakeCodeAttempts"<5 AND "retakeCodeExpiresAt">$3 RETURNING id`, input.id, input.hash, now);
      if (!rows.length) return false;
      if (!input.correct) for (let i = 0; i < subjects.length; i++) await this.counter(tx, subjects[i][0], subjects[i][1], "OTP_FAILURE", day, caps[i], true);
      return true;
    });
  }

  /**
   * Bounded maintenance cleanup for expired abuse counters and throttles.
   * Safety invariant: never deletes counters that are actively enforcing quotas.
   * Safety window: enforces a minimum 48-hour retention past window expiration.
   */
  async purgeExpiredCounters(olderThanCutoff?: Date): Promise<{ deletedCounters: number; deletedThrottles: number }> {
    return this.locked((tx, now) => this.purgeCounters(tx, now, olderThanCutoff));
  }

  private async purgeCounters(tx: Tx, now: Date, olderThanCutoff?: Date, limit = EMAIL_RETENTION_BATCH_SIZE) {
      // Minimum safety: never delete anything with window expiration within the last 48 hours.
      const maxAllowedCutoff = new Date(now.getTime() - 48 * 3600000);
      const effectiveCutoff = olderThanCutoff && olderThanCutoff < maxAllowedCutoff ? olderThanCutoff : maxAllowedCutoff;

      const deletedCounters = await tx.$executeRawUnsafe(
        `WITH expired AS (SELECT scope,"subjectHash",metric,"windowStart" FROM "EmailAbuseCounter"
          WHERE "expiresAt"<$1 ORDER BY "expiresAt",scope,"subjectHash",metric,"windowStart" LIMIT $2 FOR UPDATE SKIP LOCKED)
         DELETE FROM "EmailAbuseCounter" c USING expired e WHERE c.scope=e.scope AND c."subjectHash"=e."subjectHash"
          AND c.metric=e.metric AND c."windowStart"=e."windowStart"`,
        effectiveCutoff, limit
      );

      // Throttles only last 60 seconds; prune entries older than 1 hour.
      const throttleCutoff = new Date(now.getTime() - 3600000);
      const deletedThrottles = await tx.$executeRawUnsafe(
        `WITH expired AS (SELECT "identityHash" FROM "EmailOtpThrottle" WHERE "nextSendAt"<$1
          ORDER BY "nextSendAt","identityHash" LIMIT $2 FOR UPDATE SKIP LOCKED)
         DELETE FROM "EmailOtpThrottle" t USING expired e WHERE t."identityHash"=e."identityHash"`,
        throttleCutoff, limit
      );

      return { deletedCounters, deletedThrottles };
  }

  // One bounded transaction, serialized with budget claims/validation. Expiry
  // does NOT authorize deleting idempotency receipts or unresolved deliveries.
  async purgeExpiredData(limit = EMAIL_RETENTION_BATCH_SIZE, control?: MaintenanceControl) {
    if (!Number.isInteger(limit) || limit < 1 || limit > EMAIL_RETENTION_BATCH_SIZE) throw Error("RETENTION_BATCH_INVALID");
    return this.locked(async (tx, now) => {
      const counts = await this.purgeCounters(tx, now, undefined, limit);
      const cutoff = new Date(now.getTime() - 48 * 3600000);
      let clearedPayloads = 0, deletedJobs = 0;
      for (const table of ["OtpDeliveryJob", "ParticipantEmailDeliveryJob"] as const) {
        clearedPayloads += await tx.$executeRawUnsafe(`WITH expired AS (
          SELECT j.id FROM "${table}" j WHERE j."expiresAt"<=$1 AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=$1)
            AND (j."encryptedPayload" IS NOT NULL OR j."nextAttemptAt" IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r."leaseUntil">$1)
            AND NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p."jobId"=j.id AND p.state='PUBLISHING' AND p."leaseUntil">$1)
          ORDER BY j."expiresAt",j.id LIMIT $2 FOR UPDATE OF j SKIP LOCKED)
          UPDATE "${table}" j SET "encryptedPayload"=NULL,"nextAttemptAt"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL,
            status=CASE WHEN status='PENDING' THEN 'REJECTED' ELSE status END,
            "lastErrorCode"=COALESCE("lastErrorCode",'OTP_EXPIRED') FROM expired e WHERE j.id=e.id`, now, limit);
        deletedJobs += await tx.$executeRawUnsafe(`WITH expired AS (
          SELECT j.id FROM "${table}" j WHERE j."expiresAt"<$1 AND j.status IN ('ACCEPTED','REJECTED')
            AND j."encryptedPayload" IS NULL AND j."nextAttemptAt" IS NULL AND j."leaseUntil" IS NULL AND j."attemptToken" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p."jobId"=j.id AND p.state='PUBLISHING' AND p."leaseUntil">$2)
            AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text
              AND (r.status NOT IN ('ACCEPTED','REJECTED','RELEASED') OR r."leaseUntil">$2))
          ORDER BY j."expiresAt",j.id LIMIT $3 FOR UPDATE OF j SKIP LOCKED)
          DELETE FROM "${table}" j USING expired e WHERE j.id=e.id`, cutoff, now, limit);
      }
      // Delete gates before challenges; never cascade-delete an outbox row.
      // Issuance uses a locking upsert, so a concurrent request cannot lose its
      // gate between INSERT ... ON CONFLICT and a separate SELECT FOR UPDATE.
      const deletedGates = await tx.$executeRawUnsafe(`WITH expired AS (
        SELECT g."identityHash" FROM "ParticipantEmailGate" g WHERE g."nextIssueAt"<$1
          AND (g."challengeId" IS NULL OR EXISTS (SELECT 1 FROM "EmailOtpChallenge" c WHERE c.id=g."challengeId"
            AND c."expiresAt"<$1 AND NOT EXISTS (SELECT 1 FROM "ParticipantEmailDeliveryJob" j WHERE j."challengeId"=c.id)))
        ORDER BY g."nextIssueAt",g."identityHash" LIMIT $2 FOR UPDATE OF g SKIP LOCKED)
        DELETE FROM "ParticipantEmailGate" g USING expired e WHERE g."identityHash"=e."identityHash"`, cutoff, limit);
      const deletedChallenges = await tx.$executeRawUnsafe(`WITH expired AS (
        SELECT c.id FROM "EmailOtpChallenge" c WHERE c."expiresAt"<$1
          AND NOT EXISTS (SELECT 1 FROM "ParticipantEmailGate" g WHERE g."challengeId"=c.id)
          AND NOT EXISTS (SELECT 1 FROM "ParticipantEmailDeliveryJob" j WHERE j."challengeId"=c.id)
        ORDER BY c."expiresAt",c.id LIMIT $2 FOR UPDATE OF c SKIP LOCKED)
        DELETE FROM "EmailOtpChallenge" c USING expired e WHERE c.id=e.id`, cutoff, limit);
      // Reservations (including terminal receipts), provider state, participants,
      // legacy retake hashes, reports and admin sessions are intentionally kept.
      return { ...counts, clearedPayloads, deletedJobs, deletedGates, deletedChallenges };
    }, control);
  }
}
