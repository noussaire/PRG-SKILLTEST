-- Additive only. Historical participants are not backfilled as verified.
ALTER TABLE "AdaptiveInterview" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "ParticipantEmailGate" (
  "identityHash" CHAR(64) PRIMARY KEY CHECK ("identityHash" ~ '^[0-9a-f]{64}$'),
  "challengeId" UUID REFERENCES "EmailOtpChallenge"("id") ON DELETE SET NULL,
  "nextIssueAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ParticipantEmailDeliveryJob" (
  "id" UUID PRIMARY KEY,
  "challengeId" UUID NOT NULL UNIQUE REFERENCES "EmailOtpChallenge"("id") ON DELETE CASCADE,
  "codeHash" CHAR(64) NOT NULL CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
  "encryptedPayload" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','ACCEPTED','REJECTED','UNCERTAIN')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 6),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "attemptToken" UUID,
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("leaseUntil" IS NULL) = ("attemptToken" IS NULL)),
  CHECK ("status" NOT IN ('ACCEPTED','REJECTED') OR ("encryptedPayload" IS NULL AND "nextAttemptAt" IS NULL))
);
CREATE INDEX "ParticipantEmailDeliveryJob_status_nextAttemptAt_idx" ON "ParticipantEmailDeliveryJob"("status","nextAttemptAt");
CREATE INDEX "ParticipantEmailDeliveryJob_expiresAt_idx" ON "ParticipantEmailDeliveryJob"("expiresAt");
