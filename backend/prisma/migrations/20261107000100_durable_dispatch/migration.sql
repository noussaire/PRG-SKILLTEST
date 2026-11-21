-- Additive, LOCAL qualification only. Never applied automatically at startup.
CREATE TABLE "JobDispatchState" (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor BETWEEN 0 AND 2),
  "attemptToken" UUID,
  "leaseUntil" TIMESTAMP(3),
  "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  CHECK (("attemptToken" IS NULL)=("leaseUntil" IS NULL))
);
INSERT INTO "JobDispatchState" (singleton) VALUES (1);
CREATE TABLE "JobDispatchUsage" (day DATE PRIMARY KEY, attempts INTEGER NOT NULL CHECK (attempts>=0));

CREATE VIEW "JobLifetime" AS
SELECT 'OTP_INITIAL'::text AS kind, id AS "jobId", "expiresAt" FROM "ParticipantEmailDeliveryJob"
UNION ALL SELECT 'OTP_RETAKE',id,"expiresAt" FROM "OtpDeliveryJob"
UNION ALL SELECT 'REPORT',j.id,LEAST(i."expiresAt",j."createdAt"+interval '24 hours')
FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId";

-- Bound every activation AND cumulative republications across new notification
-- UUIDs. Cancelled/exhausted evidence is retained, not silently recycled.
CREATE OR REPLACE VIEW "JobPublicationReady" AS
SELECT c.* FROM "JobPublicationCandidate" c JOIN "JobLifetime" l ON l.kind=c.kind AND l."jobId"=c."jobId"
WHERE l."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
  AND (c.kind<>'OTP_INITIAL' OR EXISTS (
    SELECT 1 FROM "ParticipantEmailDeliveryJob" j JOIN "ParticipantEmailGate" g ON g."challengeId"=j."challengeId" WHERE j.id=c."jobId"))
  AND (c.kind<>'REPORT' OR c.generation<CASE WHEN c.phase='SUMMARY' THEN 3 ELSE 6 END)
  AND COALESCE((SELECT sum(p.attempts) FROM "JobPublicationIntent" p WHERE p.kind=c.kind AND p."jobId"=c."jobId" AND p.phase=c.phase),0)<=24;
