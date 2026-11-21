import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSyntheticDatabase, syntheticEmail, syntheticOtpTargetProof, validStagingProof } from "../security/synthetic-staging.js";
import { decryptOtpPayload } from "../security/otp-payload.js";
import { emailSubjectHash, normalizedEmailIdentity } from "./email-limits.js";
import { syntheticOtpPublicationSchema } from "./synthetic-otp-publication.service.js";
import { parseNotification } from "./qstash-publisher.service.js";
import { OtpDeliveryQueue } from "./otp-delivery.service.js";
import { sendReportEmail } from "./brevo.service.js";
import { type ReceiveStep, ReceiveStepError, logReceiveDiagnostic } from "../security/synthetic-receive-diagnostic.js";

const reject = (step: ReceiveStep) => { throw new ReceiveStepError(step, "SYNTHETIC_OTP_TARGET_UNAVAILABLE"); };

// Run the existing queue and budget transactions as SAVEPOINTs in the enclosing
// synthetic-only transaction. Logical/SQL failures retain their rollback semantics;
// no nested connection or global singleton can escape the held identity locks.
function transactionalDatabase(tx: Prisma.TransactionClient): PrismaClient {
  let sequence = 0;
  return new Proxy(tx, { get(target, property) {
    if (property === "$transaction") return async (work: (inner: Prisma.TransactionClient) => Promise<unknown>) => {
      const savepoint = `synthetic_receive_${++sequence}`; // Internal integer, never request input.
      await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(tx);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    };
    const value = (target as any)[property];
    return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as PrismaClient;
}

export async function receiveSyntheticOtp(db: PrismaClient, input: unknown, options?: { correlationId?: string }) {
  let currentStep: ReceiveStep = "RECEIVE_TARGET_VALIDATION";
  try {
    currentStep = "RECEIVE_TARGET_VALIDATION";
    const target = syntheticOtpPublicationSchema.parse(input);
    currentStep = "RECEIVE_DB_ASSERTION";
    await assertSyntheticDatabase(db);
    const identity = emailSubjectHash("IDENTITY", normalizedEmailIdentity(target.email));
    return await db.$transaction(async tx => {
      currentStep = "RECEIVE_TRANSACTION_INIT";
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='2000ms'`);
      await assertSyntheticDatabase(tx);
      // Match EmailBudget's provider-first lock order; do not invert OTP verification locks.
      currentStep = "RECEIVE_PROVIDER_LOCK";
      await tx.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider) VALUES ('BREVO') ON CONFLICT DO NOTHING`);
      await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);
      currentStep = "RECEIVE_TARGET_FETCH_AND_LOCK";
      const rows = await tx.$queryRawUnsafe<{ encryptedPayload: string; payload: unknown; generation: number; dueAt: Date }[]>(
        `SELECT j."encryptedPayload",n.payload,p.generation,p."dueAt"
        FROM "ParticipantEmailDeliveryJob" j
        JOIN "EmailOtpChallenge" c ON c.id=j."challengeId"
        JOIN "ParticipantEmailGate" g ON g."challengeId"=c.id AND g."identityHash"=c."identityHash"
        JOIN "JobPublicationIntent" p ON p."jobId"=j.id AND p.kind='OTP_INITIAL' AND p.phase='DELIVER'
        JOIN "SyntheticNotification" n ON n.id=p.id
        JOIN "JobPublicationReady" r ON r.kind=p.kind AND r."jobId"=p."jobId" AND r.phase=p.phase
          AND r.generation=p.generation AND r."dueAt"=p."dueAt"
        WHERE j.id=$1::uuid AND c.id=$2::uuid AND p.id=$3::uuid AND c."identityHash"=$4
          AND c.purpose='INITIAL' AND c."consumedAt" IS NULL AND c.attempts<LEAST(5,c."maxAttempts")
          AND c."codeHash"=j."codeHash" AND c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
          AND j.status='PENDING' AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL
          AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
          AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
          AND p.state='PUBLISHED' AND r."dueAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
          AND n."receivedAt" IS NULL AND n.disposition IS NULL
          AND NOT EXISTS(SELECT 1 FROM "EmailBudgetReservation" b WHERE b."logicalKey"=j.id::text AND b.status IN ('ACCEPTED','UNCERTAIN'))
        FOR UPDATE OF g,c,j,p,n`, target.jobId, target.challengeId, target.notificationId, identity);
      if (rows.length !== 1) return reject("RECEIVE_TARGET_FETCH_AND_LOCK");
      const row = rows[0];
      currentStep = "RECEIVE_TARGET_PROOF_VERIFY";
      const captured = z.object({ otpTargetProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).passthrough().parse(row.payload);
      const { otpTargetProof, ...envelope } = captured;
      if (!validStagingProof(otpTargetProof, syntheticOtpTargetProof(target))) return reject("RECEIVE_TARGET_PROOF_VERIFY");
      currentStep = "RECEIVE_ENVELOPE_PARSE";
      const n = parseNotification(envelope);
      if (n.notificationId !== target.notificationId || n.jobId !== target.jobId || n.kind !== "OTP_INITIAL" ||
          n.phase !== "DELIVER" || n.generation !== row.generation || n.dueAt !== row.dueAt.toISOString()) return reject("RECEIVE_ENVELOPE_PARSE");
      currentStep = "RECEIVE_PAYLOAD_DECRYPT";
      const message = z.object({ recipient: z.string(), recipientName: z.string() }).passthrough()
        .parse(decryptOtpPayload(row.encryptedPayload, target.jobId));
      if (!syntheticEmail(message.recipient) || normalizedEmailIdentity(message.recipient) !== normalizedEmailIdentity(target.email) ||
          message.recipientName !== target.fullName) return reject("RECEIVE_PAYLOAD_DECRYPT");

      currentStep = "RECEIVE_QUEUE_PROCESS";
      const local = transactionalDatabase(tx);
      await new OtpDeliveryQueue(local, async input => {
        await assertSyntheticDatabase(local);
        return sendReportEmail(input, local);
      }).processJob("OTP_INITIAL", target.jobId);
      currentStep = "RECEIVE_VERIFY_OUTCOME";
      const [result] = await tx.$queryRawUnsafe<{ status: string; valid: boolean; captured: boolean; accepted: boolean }[]>(
        `SELECT j.status,c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AS valid,
          EXISTS(SELECT 1 FROM "SyntheticMail" m WHERE m.id=j.id AND m.purpose='OTP') AS captured,
          EXISTS(SELECT 1 FROM "EmailBudgetReservation" b WHERE b."logicalKey"=j.id::text AND b.status='ACCEPTED') AS accepted
        FROM "ParticipantEmailDeliveryJob" j JOIN "EmailOtpChallenge" c ON c.id=j."challengeId" WHERE j.id=$1::uuid`, target.jobId);
      if (!result?.valid) return reject("RECEIVE_VERIFY_OUTCOME");
      const disposition = result.status === "ACCEPTED" && result.captured && result.accepted ? "COMPLETE"
        : result.status === "REJECTED" ? "REJECTED" : result.status === "UNCERTAIN" ? "UNCERTAIN" : "DEFERRED";
      currentStep = "RECEIVE_UPDATE_NOTIFICATION";
      const changed = await tx.$executeRawUnsafe(`UPDATE "SyntheticNotification" SET "receivedAt"=(clock_timestamp() AT TIME ZONE 'UTC'),disposition=$2
        WHERE id=$1::uuid AND "receivedAt" IS NULL`, target.notificationId, disposition);
      if (changed !== 1) return reject("RECEIVE_UPDATE_NOTIFICATION");
      return { simulated: true as const, disposition, jobId: target.jobId, challengeId: target.challengeId, notificationId: target.notificationId };
    // The existing queue/budget flow takes 59 sequential SQL exchanges on the
    // successful native fixture. At 100 ms per exchange it exceeds 5 seconds
    // without any contention. Bound the whole synthetic-only operation while
    // retaining per-statement timeouts, acquisition limits and expiry checks.
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 15000 });
  } catch (error) {
    const failedStep = error instanceof ReceiveStepError ? error.step : currentStep;
    logReceiveDiagnostic(failedStep, error, options?.correlationId);
    if (error && typeof error === "object") {
      (error as any).__receiveDiagnosticLogged = true;
    }
    throw error;
  }
}
