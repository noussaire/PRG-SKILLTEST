-- Additive, dormant foundation only. No reads or writes to existing student tables.
CREATE TABLE "EmailOtpChallenge" (
 "id" UUID PRIMARY KEY, "identityHash" CHAR(64) NOT NULL, "purpose" VARCHAR(20) NOT NULL,
 "codeHash" CHAR(64) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
 "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("purpose" IN ('INITIAL','RETAKE')), CHECK ("maxAttempts" > 0 AND "attempts" BETWEEN 0 AND "maxAttempts"),
 CHECK ("expiresAt" > "createdAt"), CHECK ("identityHash" ~ '^[0-9a-f]{64}$' AND "codeHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "EmailOtpChallenge_identityHash_purpose_expiresAt_idx" ON "EmailOtpChallenge"("identityHash","purpose","expiresAt");
CREATE TABLE "EmailAbuseCounter" (
 "scope" VARCHAR(20) NOT NULL, "subjectHash" CHAR(64) NOT NULL, "metric" VARCHAR(20) NOT NULL,
 "windowStart" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "count" INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY ("scope","subjectHash","metric","windowStart"), CHECK ("count" >= 0),
 CHECK ("expiresAt" > "windowStart"), CHECK ("subjectHash" ~ '^[0-9a-f]{64}$'),
 CHECK ("scope" IN ('IDENTITY','NETWORK','GLOBAL')), CHECK ("metric" IN ('OTP_SEND','OTP_FAILURE','EMAIL_UNITS'))
);
CREATE INDEX "EmailAbuseCounter_expiresAt_idx" ON "EmailAbuseCounter"("expiresAt");
CREATE TABLE "EmailBudgetReservation" (
 "id" UUID PRIMARY KEY, "logicalKey" VARCHAR(160) NOT NULL, "provider" VARCHAR(20) NOT NULL DEFAULT 'BREVO',
 "purpose" VARCHAR(20) NOT NULL, "budgetWindowStart" TIMESTAMP(3) NOT NULL, "units" INTEGER NOT NULL DEFAULT 1,
 "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED', "idempotencyKey" UUID NOT NULL, "requestHash" CHAR(64) NOT NULL,
 "providerAttemptedAt" TIMESTAMP(3), "retrySafeUntil" TIMESTAMP(3), "leaseUntil" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("units" > 0), CHECK ("purpose" IN ('OTP','REPORT')),
 CHECK ("status" IN ('RESERVED','ACCEPTED','REJECTED','UNCERTAIN','RELEASED')),
 CHECK ("requestHash" ~ '^[0-9a-f]{64}$'), CHECK ("expiresAt" > "createdAt"),
 CHECK ("retrySafeUntil" IS NULL OR ("providerAttemptedAt" IS NOT NULL AND "retrySafeUntil" > "providerAttemptedAt")),
 CHECK ("status" <> 'RELEASED' OR "providerAttemptedAt" IS NULL)
);
CREATE UNIQUE INDEX "EmailBudgetReservation_logicalKey_key" ON "EmailBudgetReservation"("logicalKey");
CREATE UNIQUE INDEX "EmailBudgetReservation_idempotencyKey_key" ON "EmailBudgetReservation"("idempotencyKey");
CREATE INDEX "EmailBudgetReservation_provider_budgetWindowStart_status_idx" ON "EmailBudgetReservation"("provider","budgetWindowStart","status");
CREATE INDEX "EmailBudgetReservation_expiresAt_idx" ON "EmailBudgetReservation"("expiresAt");
CREATE TABLE "EmailProviderState" (
 "provider" VARCHAR(20) PRIMARY KEY, "blockedUntil" TIMESTAMP(3), "reasonCode" VARCHAR(80),
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
