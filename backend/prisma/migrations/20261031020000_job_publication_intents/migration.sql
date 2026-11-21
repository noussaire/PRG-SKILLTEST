-- Additive, SQL-managed outbox of notifications. No message content or secrets.
CREATE TABLE "JobPublicationIntent" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('OTP_INITIAL','OTP_RETAKE','REPORT')),
  "jobId" UUID NOT NULL,
  phase VARCHAR(10) NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  "dueAt" TIMESTAMP(3) NOT NULL,
  state VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PUBLISHING','PUBLISHED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "attemptToken" UUID,
  "lastErrorCode" VARCHAR(40),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  CHECK ((kind IN ('OTP_INITIAL','OTP_RETAKE') AND phase='DELIVER') OR (kind='REPORT' AND phase IN ('SUMMARY','EMAIL'))),
  CHECK ((state='PUBLISHING' AND "leaseUntil" IS NOT NULL AND "attemptToken" IS NOT NULL)
    OR (state<>'PUBLISHING' AND "leaseUntil" IS NULL AND "attemptToken" IS NULL)),
  UNIQUE(kind,"jobId",phase,generation,"dueAt")
);
CREATE INDEX "JobPublicationIntent_due_idx" ON "JobPublicationIntent"(state,"nextAttemptAt",id);
CREATE INDEX "JobPublicationIntent_job_idx" ON "JobPublicationIntent"(kind,"jobId");

-- Candidates allow initial OTP insertion before its gate is updated in the SAME
-- transaction. Publication readiness additionally requires the current gate.
CREATE VIEW "JobPublicationCandidate" AS
WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now)
SELECT 'OTP_INITIAL'::text AS kind,j.id AS "jobId",'DELIVER'::text AS phase,j.attempts AS generation,
  j."nextAttemptAt" AS "dueAt"
FROM "ParticipantEmailDeliveryJob" j JOIN "EmailOtpChallenge" c ON c.id=j."challengeId" CROSS JOIN clock
WHERE j.status IN ('PENDING','UNCERTAIN') AND j."nextAttemptAt" IS NOT NULL
  AND j."expiresAt">clock.now AND c."expiresAt">clock.now AND c."consumedAt" IS NULL
  AND c."codeHash"=j."codeHash" AND c.attempts<LEAST(5,c."maxAttempts") AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL
  AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
  AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r.status='UNCERTAIN')
UNION ALL
SELECT 'OTP_RETAKE',j.id,'DELIVER',j.attempts,j."nextAttemptAt"
FROM "OtpDeliveryJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE j.status IN ('PENDING','UNCERTAIN') AND j."nextAttemptAt" IS NOT NULL AND j."expiresAt">clock.now
  AND i."retakeCodeHash"=j."codeHash" AND i."retakeCodeExpiresAt">clock.now AND i."retakeCodeAttempts"<5
  AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
  AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r.status='UNCERTAIN')
UNION ALL
SELECT 'REPORT',j.id,'SUMMARY',j.attempts,
  CASE WHEN j.status='PROCESSING' THEN j."leaseUntil" ELSE j."nextAttemptAt" END
FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE i."expiresAt">clock.now AND
  ((j.status IN ('PENDING','RETRY') AND j."nextAttemptAt" IS NOT NULL)
   OR (j.status='PROCESSING' AND j."leaseUntil"<=clock.now))
UNION ALL
SELECT 'REPORT',j.id,'EMAIL',j."emailAttempts",
  CASE WHEN j."emailStatus"='PROCESSING' THEN j."emailLeaseUntil" ELSE j."emailNextAttemptAt" END
FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE i."expiresAt">clock.now AND i."reportEmailRequested" AND i.email IS NOT NULL
  AND j.status='COMPLETE' AND j.summary IS NOT NULL
  AND ((j."emailStatus" IN ('PENDING','RETRY')) OR (j."emailStatus"='PROCESSING' AND j."emailLeaseUntil"<=clock.now))
  AND (j."emailAttemptWindowAt" IS NULL OR j."emailAttemptWindowAt">clock.now-interval '10 minutes');

CREATE VIEW "JobPublicationReady" AS
SELECT c.* FROM "JobPublicationCandidate" c
WHERE c.kind<>'OTP_INITIAL' OR EXISTS (
  SELECT 1 FROM "ParticipantEmailDeliveryJob" j JOIN "ParticipantEmailGate" g ON g."challengeId"=j."challengeId" WHERE j.id=c."jobId"
);

CREATE FUNCTION refresh_job_publication_intents() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job_kind text; job_id uuid;
BEGIN
  job_kind := CASE TG_TABLE_NAME WHEN 'ParticipantEmailDeliveryJob' THEN 'OTP_INITIAL' WHEN 'OtpDeliveryJob' THEN 'OTP_RETAKE' ELSE 'REPORT' END;
  IF TG_OP='DELETE' THEN job_id:=OLD.id; ELSE job_id:=NEW.id; END IF;
  UPDATE "JobPublicationIntent" p SET state='CANCELLED',"attemptToken"=NULL,"leaseUntil"=NULL,"lastErrorCode"='JOB_NOT_EXECUTABLE'
    WHERE p.kind=job_kind AND p."jobId"=job_id AND p.state IN ('PENDING','PUBLISHING')
      AND NOT EXISTS (SELECT 1 FROM "JobPublicationCandidate" c WHERE c.kind=p.kind AND c."jobId"=p."jobId" AND c.phase=p.phase AND c.generation=p.generation AND c."dueAt"=p."dueAt");
  IF TG_OP<>'DELETE' THEN
    INSERT INTO "JobPublicationIntent" (kind,"jobId",phase,generation,"dueAt","nextAttemptAt")
      SELECT kind,"jobId",phase,generation,"dueAt","dueAt" FROM "JobPublicationCandidate" WHERE kind=job_kind AND "jobId"=job_id
      ON CONFLICT (kind,"jobId",phase,generation,"dueAt") DO UPDATE SET "dueAt"=EXCLUDED."dueAt",
        "nextAttemptAt"=GREATEST("JobPublicationIntent"."nextAttemptAt",EXCLUDED."dueAt")
      WHERE "JobPublicationIntent".state='PENDING';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER participant_otp_publication AFTER INSERT OR UPDATE OR DELETE ON "ParticipantEmailDeliveryJob"
  FOR EACH ROW EXECUTE FUNCTION refresh_job_publication_intents();
CREATE TRIGGER retake_otp_publication AFTER INSERT OR UPDATE OR DELETE ON "OtpDeliveryJob"
  FOR EACH ROW EXECUTE FUNCTION refresh_job_publication_intents();
CREATE TRIGGER report_publication AFTER INSERT OR UPDATE OR DELETE ON "AdaptiveReportJob"
  FOR EACH ROW EXECUTE FUNCTION refresh_job_publication_intents();
