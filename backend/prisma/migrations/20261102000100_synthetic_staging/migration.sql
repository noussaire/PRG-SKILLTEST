-- Dormant by default: no installation marker, credential, user or seed is created.
CREATE TABLE "SyntheticStagingInstallation" (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  "stagingId" UUID NOT NULL UNIQUE,
  "projectId" TEXT,
  "databaseName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE "SyntheticMail" (
  id UUID PRIMARY KEY, purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('OTP','REPORT')),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext)<=131072),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE INDEX "SyntheticMail_expiry_idx" ON "SyntheticMail"("expiresAt",id);
CREATE TABLE "SyntheticNotification" (
  id UUID PRIMARY KEY, payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2048),
  "receivedAt" TIMESTAMP(3), disposition VARCHAR(16),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE INDEX "SyntheticNotification_created_idx" ON "SyntheticNotification"("createdAt",id);
CREATE TABLE "SyntheticInvocation" (
  id UUID PRIMARY KEY, actor CHAR(64) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE INDEX "SyntheticInvocation_expiry_idx" ON "SyntheticInvocation"("expiresAt",id);
CREATE INDEX "SyntheticInvocation_actor_idx" ON "SyntheticInvocation"(actor,"createdAt");
CREATE TABLE "SyntheticProviderFault" (
  provider VARCHAR(8) NOT NULL CHECK (provider IN ('EMAIL','QUEUE')), id UUID NOT NULL,
  outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('REJECTED','RATE_LIMIT','ACCEPTED_RESPONSE_LOST')),
  remaining INTEGER NOT NULL CHECK (remaining BETWEEN 0 AND 10), PRIMARY KEY(provider,id)
);

-- Defensive constraints on writes while a sandbox marker exists. They cannot
-- convert existing production data: the runtime independently audits it first.
CREATE FUNCTION synthetic_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "SyntheticStagingInstallation") THEN RETURN NEW; END IF;
  doc := to_jsonb(NEW);
  IF (doc->>'email' IS NOT NULL AND doc->>'email' !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR
     (doc->>'emailIdentity' IS NOT NULL AND doc->>'emailIdentity' !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR
     (doc->>'displayName' IS NOT NULL AND doc->>'displayName' NOT LIKE 'SYNTH-%') THEN
    RAISE EXCEPTION 'SYNTHETIC_IDENTITY_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_user_guard BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION synthetic_identity_guard();
CREATE TRIGGER synthetic_interview_guard BEFORE INSERT OR UPDATE ON "AdaptiveInterview" FOR EACH ROW EXECUTE FUNCTION synthetic_identity_guard();
CREATE TRIGGER synthetic_participant_guard BEFORE INSERT OR UPDATE ON "Participant" FOR EACH ROW EXECUTE FUNCTION synthetic_identity_guard();
