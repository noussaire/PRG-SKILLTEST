-- Additive orchestration metadata. No secret, recipient, OTP or report content.
CREATE TABLE "MaintenanceRun" (
  id UUID PRIMARY KEY,
  task VARCHAR(12) NOT NULL CHECK (task IN ('reconcile','cleanup','sessions')),
  "attemptToken" UUID NOT NULL UNIQUE,
  state VARCHAR(12) NOT NULL CHECK (state IN ('RUNNING','COMPLETED','PARTIAL','FAILED','INTERRUPTED')),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "finishedAt" TIMESTAMP(3),
  "stopCode" VARCHAR(24),
  CHECK ((state='RUNNING' AND "finishedAt" IS NULL) OR (state<>'RUNNING' AND "finishedAt" IS NOT NULL))
);
CREATE INDEX "MaintenanceRun_task_started_idx" ON "MaintenanceRun"(task,"startedAt");
CREATE TABLE "MaintenanceTask" (
  task VARCHAR(12) PRIMARY KEY CHECK (task IN ('reconcile','cleanup','sessions')),
  "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE "MaintenanceLease" (
  name VARCHAR(16) PRIMARY KEY CHECK (name='maintenance'),
  "runId" UUID REFERENCES "MaintenanceRun"(id) ON DELETE RESTRICT,
  "attemptToken" UUID,
  "leaseUntil" TIMESTAMP(3),
  CHECK (("runId" IS NULL AND "attemptToken" IS NULL AND "leaseUntil" IS NULL)
    OR ("runId" IS NOT NULL AND "attemptToken" IS NOT NULL AND "leaseUntil" IS NOT NULL))
);
