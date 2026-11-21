import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSyntheticDatabase, SyntheticStagingError, syntheticEmail, syntheticOtpTargetProof } from "../security/synthetic-staging.js";
import { decryptOtpPayload } from "../security/otp-payload.js";
import { emailSubjectHash, normalizedEmailIdentity } from "./email-limits.js";
import { SyntheticQstashPublisher } from "./synthetic-providers.service.js";

// One exact initial OTP activation. No batch, limit, arbitrary kind or recipient override.
export const syntheticOtpPublicationSchema = z.object({
  jobId: z.string().uuid(), challengeId: z.string().uuid(), notificationId: z.string().uuid(),
  fullName: z.literal("SYNTH-Participant"),
  email: z.string().refine(syntheticEmail),
}).strict();

const reject = () => { throw new SyntheticStagingError("SYNTHETIC_OTP_TARGET_UNAVAILABLE"); };

export async function publishSyntheticOtp(db: PrismaClient, input: unknown) {
  const target = syntheticOtpPublicationSchema.parse(input);
  // Mandatory even when called outside the HTTP router. Disabled mode fails closed.
  await assertSyntheticDatabase(db);
  const identity = emailSubjectHash("IDENTITY", normalizedEmailIdentity(target.email));
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='2000ms'`);
    await assertSyntheticDatabase(tx);
    const rows = await tx.$queryRawUnsafe<{
      encryptedPayload: string; generation: number; dueAt: Date;
    }[]>(`SELECT j."encryptedPayload",p.generation,p."dueAt"
      FROM "ParticipantEmailDeliveryJob" j
      JOIN "EmailOtpChallenge" c ON c.id=j."challengeId"
      JOIN "ParticipantEmailGate" g ON g."challengeId"=c.id AND g."identityHash"=c."identityHash"
      JOIN "JobPublicationIntent" p ON p."jobId"=j.id AND p.kind='OTP_INITIAL' AND p.phase='DELIVER'
      JOIN "JobPublicationReady" r ON r.kind=p.kind AND r."jobId"=p."jobId" AND r.phase=p.phase
        AND r.generation=p.generation AND r."dueAt"=p."dueAt"
      WHERE j.id=$1::uuid AND c.id=$2::uuid AND p.id=$3::uuid AND c."identityHash"=$4
        AND c.purpose='INITIAL' AND c."consumedAt" IS NULL AND c.attempts<LEAST(5,c."maxAttempts")
        AND c."codeHash"=j."codeHash" AND c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
        AND j.status='PENDING' AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL
        AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
        AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
        AND p.state='PENDING' AND p."nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
        AND (p."leaseUntil" IS NULL OR p."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
        AND r."dueAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
        AND (SELECT COALESCE(sum(b.attempts),0) FROM "JobPublicationIntent" b
          WHERE b.kind=p.kind AND b."jobId"=p."jobId" AND b.phase=p.phase)<24
        AND NOT EXISTS(SELECT 1 FROM "EmailBudgetReservation" b
          WHERE b."logicalKey"=j.id::text AND b.status IN ('ACCEPTED','UNCERTAIN'))
        AND NOT EXISTS(SELECT 1 FROM "SyntheticNotification" n WHERE n.id=p.id)
      FOR UPDATE OF g,c,j,p`, target.jobId, target.challengeId, target.notificationId, identity);
    if (rows.length !== 1) return reject();
    const row = rows[0];
    // Identity is authenticated by the existing encrypted payload; never return/log it or the OTP.
    const payload = z.object({ recipient: z.string(), recipientName: z.string() }).passthrough()
      .parse(decryptOtpPayload(row.encryptedPayload, target.jobId));
    if (normalizedEmailIdentity(payload.recipient) !== normalizedEmailIdentity(target.email) ||
        !syntheticEmail(payload.recipient) || payload.recipientName !== target.fullName) return reject();
    // Recheck the DB clock after acquiring locks and decrypting. Only this exact intent changes.
    const changed = await tx.$executeRawUnsafe(`UPDATE "JobPublicationIntent" p SET state='PUBLISHED',
      attempts=attempts+1,"publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC'),
      "leaseUntil"=NULL,"attemptToken"=NULL,"lastErrorCode"=NULL
      WHERE p.id=$1::uuid AND p.state='PENDING' AND EXISTS(
        SELECT 1 FROM "ParticipantEmailDeliveryJob" j JOIN "EmailOtpChallenge" c ON c.id=j."challengeId"
        WHERE j.id=$2::uuid AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
          AND c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))`, target.notificationId, target.jobId);
    if (changed !== 1) return reject();
    const notification = { version: 1 as const, notificationId: target.notificationId, kind: "OTP_INITIAL" as const,
      jobId: target.jobId, phase: "DELIVER" as const, generation: row.generation, dueAt: row.dueAt.toISOString() };
    // Transaction-local simulated transport only: capture + intent update commit or roll back together.
    await new SyntheticQstashPublisher(tx).publish(notification, new AbortController().signal);
    const bound = await tx.$executeRawUnsafe(`UPDATE "SyntheticNotification" SET payload=payload || jsonb_build_object('otpTargetProof',$2::text)
      WHERE id=$1::uuid AND "receivedAt" IS NULL`, target.notificationId, syntheticOtpTargetProof(target));
    if (bound !== 1) return reject();
    return { simulated: true as const, published: 1 as const, jobId: target.jobId,
      challengeId: target.challengeId, notificationId: target.notificationId };
  }, { maxWait: 2000, timeout: 5000 });
}
