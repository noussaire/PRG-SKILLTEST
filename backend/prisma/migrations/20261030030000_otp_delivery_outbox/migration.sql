-- Additive outbox only. No backfill or changes to existing participant data.
CREATE TABLE "OtpDeliveryJob" (
  "id" UUID PRIMARY KEY,
  "interviewId" UUID NOT NULL REFERENCES "AdaptiveInterview"("id") ON DELETE CASCADE,
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
CREATE INDEX "OtpDeliveryJob_status_nextAttemptAt_idx" ON "OtpDeliveryJob"("status","nextAttemptAt");
CREATE INDEX "OtpDeliveryJob_expiresAt_idx" ON "OtpDeliveryJob"("expiresAt");
CREATE INDEX "OtpDeliveryJob_interviewId_codeHash_createdAt_idx" ON "OtpDeliveryJob"("interviewId","codeHash","createdAt");
