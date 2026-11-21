-- Terminal fallback reports use the existing dormant email publication path.
-- No transport, credential or scheduler is enabled by this migration.
CREATE OR REPLACE VIEW "JobPublicationCandidate" AS
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
  AND ((j.status='COMPLETE' AND j.summary IS NOT NULL) OR j.status='UNAVAILABLE')
  AND ((j."emailStatus" IN ('PENDING','RETRY')) OR (j."emailStatus"='PROCESSING' AND j."emailLeaseUntil"<=clock.now))
  AND (j."emailAttemptWindowAt" IS NULL OR j."emailAttemptWindowAt">clock.now-interval '10 minutes');
