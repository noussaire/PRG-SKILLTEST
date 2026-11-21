CREATE TABLE "AdaptiveReportJob" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "summary" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdaptiveReportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdaptiveReportJob_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "AdaptiveInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdaptiveReportJob_interviewId_key" ON "AdaptiveReportJob"("interviewId");
CREATE INDEX "AdaptiveReportJob_status_nextAttemptAt_idx" ON "AdaptiveReportJob"("status", "nextAttemptAt");
