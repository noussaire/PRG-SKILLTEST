-- Existing participants and completed reports are not enrolled in email delivery.
ALTER TABLE "AdaptiveInterview" ADD COLUMN "reportEmailRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdaptiveReportJob"
  ADD COLUMN "emailStatus" VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "emailLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "emailAttemptWindowAt" TIMESTAMP(3),
  ADD COLUMN "emailAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "emailMessageId" VARCHAR(512),
  ADD COLUMN "emailLastErrorCode" VARCHAR(80);
CREATE INDEX "AdaptiveReportJob_emailStatus_emailNextAttemptAt_idx"
  ON "AdaptiveReportJob"("emailStatus", "emailNextAttemptAt");
