-- Optional manual read-only audit. Never executed by the diagnostic tests.
-- No OTP, hash, token, proof value or encrypted payload is selected.
BEGIN READ ONLY;
SELECT
  j.id AS job_id, j.status AS job_status, j.attempts AS job_attempts,
  j."nextAttemptAt", j."lastErrorCode", j."expiresAt" AS job_expires_at,
  j."encryptedPayload" IS NOT NULL AS payload_present,
  j."challengeId"='a999f349-c0a8-4a1d-93b3-b44ab2eb44e6'::uuid AS expected_challenge,
  c."expiresAt" AS challenge_expires_at, c."consumedAt" IS NOT NULL AS challenge_consumed,
  c.attempts AS challenge_attempts,
  p.state AS publication_state, p."publishedAt",
  n.id IS NOT NULL AS notification_exists, n."receivedAt", n.disposition,
  COALESCE(n.payload->>'otpTargetProof' ~ '^[A-Za-z0-9_-]{43}$',false) AS proof_format_valid,
  COALESCE(n.payload->>'notificationId'=p.id::text AND n.payload->>'jobId'=j.id::text
    AND n.payload->>'kind'='OTP_INITIAL' AND n.payload->>'phase'='DELIVER'
    AND n.payload->>'version'='1',false) AS notification_target_matches
FROM "ParticipantEmailDeliveryJob" j
LEFT JOIN "EmailOtpChallenge" c ON c.id=j."challengeId"
LEFT JOIN "JobPublicationIntent" p ON p.id='ab378a59-c877-40db-b6db-b0c108788c34'::uuid
  AND p."jobId"=j.id AND p.kind='OTP_INITIAL' AND p.phase='DELIVER'
LEFT JOIN "SyntheticNotification" n ON n.id=p.id
WHERE j.id='b8b99440-1ce1-4abb-8de9-7d8ad45c203a'::uuid;
ROLLBACK;
