-- Additive only: no existing participant rows or historical migrations changed.
ALTER TABLE "EmailBudgetReservation" ADD COLUMN "attemptToken" UUID;
CREATE TABLE "EmailOtpThrottle" (
  "identityHash" CHAR(64) PRIMARY KEY CHECK ("identityHash" ~ '^[0-9a-f]{64}$'),
  "nextSendAt" TIMESTAMP(3) NOT NULL
);
