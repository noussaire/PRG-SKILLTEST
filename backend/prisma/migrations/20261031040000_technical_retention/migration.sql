-- Additive eligibility observation; no age inferred from historical creation.
ALTER TABLE "JobPublicationIntent" ADD COLUMN "retentionObservedAt" TIMESTAMP(3);
CREATE INDEX "JobPublicationIntent_retention_unobserved_idx" ON "JobPublicationIntent"("createdAt",id)
  WHERE state='CANCELLED' AND attempts=0 AND "publishedAt" IS NULL AND "leaseUntil" IS NULL
    AND "attemptToken" IS NULL AND "retentionObservedAt" IS NULL;
CREATE INDEX "JobPublicationIntent_retention_due_idx" ON "JobPublicationIntent"("retentionObservedAt",id)
  WHERE state='CANCELLED' AND attempts=0 AND "publishedAt" IS NULL AND "leaseUntil" IS NULL
    AND "attemptToken" IS NULL AND "retentionObservedAt" IS NOT NULL;
CREATE FUNCTION invalidate_intent_retention_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'retentionObservedAt') IS DISTINCT FROM (to_jsonb(OLD)-'retentionObservedAt') THEN
    NEW."retentionObservedAt" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invalidate_intent_retention_observation BEFORE UPDATE ON "JobPublicationIntent"
  FOR EACH ROW EXECUTE FUNCTION invalidate_intent_retention_observation();

-- UUID anti-replay evidence is permanent. Only detailed terminal metadata ages.
CREATE TABLE "MaintenanceReplayReceipt" (
  id UUID PRIMARY KEY,
  "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE FUNCTION preserve_maintenance_replay_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'MAINTENANCE_REPLAY_RECEIPT_IMMUTABLE'; END $$;
CREATE TRIGGER preserve_maintenance_replay_receipt BEFORE UPDATE OR DELETE ON "MaintenanceReplayReceipt"
  FOR EACH ROW EXECUTE FUNCTION preserve_maintenance_replay_receipt();
-- Protect older 4B binaries that only inspect MaintenanceRun before INSERT.
-- They may return a technical rejection, but can never execute an old UUID.
CREATE FUNCTION reject_retired_maintenance_uuid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MaintenanceReplayReceipt" WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'MAINTENANCE_UUID_ALREADY_ADMITTED' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reject_retired_maintenance_uuid BEFORE INSERT ON "MaintenanceRun"
  FOR EACH ROW EXECUTE FUNCTION reject_retired_maintenance_uuid();
CREATE INDEX "MaintenanceRun_retention_idx" ON "MaintenanceRun"("finishedAt",id)
  WHERE state IN ('COMPLETED','PARTIAL','FAILED','INTERRUPTED');
