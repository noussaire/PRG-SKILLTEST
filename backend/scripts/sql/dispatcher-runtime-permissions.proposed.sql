-- PROPOSAL ONLY. Not a Prisma migration or startup script. NOT EXECUTED.
-- Target: the confirmed database of the existing Production backend.
-- Execute only after explicit authorization, as an existing authorized grantor.
-- Assumptions: public schema, deployed definitions match the reviewed migrations,
-- ordinary owner-rights views (security_invoker is not true), no additional RLS
-- policy/trigger dependencies. Verify with the companion read-only script first.
-- Active statements below cover the REAL publisher path only. See the inactive
-- appendix for synthetic-v1; Production deployment does not itself imply mode.
-- public USAGE is already confirmed: no redundant schema grant.

BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '1500ms';

-- Admission, fencing, weighted cursor, conditional lease release.
GRANT SELECT ON TABLE public."JobDispatchState" TO skillquest_runtime;
GRANT UPDATE (cursor, "attemptToken", "leaseUntil", "nextAllowedAt")
  ON TABLE public."JobDispatchState" TO skillquest_runtime;

-- Publication quota: no deletion or resetting of day keys is needed.
GRANT SELECT ON TABLE public."JobDispatchUsage" TO skillquest_runtime;
GRANT INSERT (day, attempts), UPDATE (attempts)
  ON TABLE public."JobDispatchUsage" TO skillquest_runtime;

-- RETURNING p.* requires SELECT on every current intent column.
-- dueAt UPDATE is also used by refresh_job_publication_intents()'s upsert.
-- retentionObservedAt is assigned to NEW by a BEFORE trigger, not a separate SQL
-- UPDATE: it does not need an additional caller UPDATE grant.
GRANT SELECT ON TABLE public."JobPublicationIntent" TO skillquest_runtime;
GRANT INSERT (kind, "jobId", phase, generation, "dueAt", "nextAttemptAt"),
  UPDATE (state, attempts, "attemptToken", "leaseUntil", "lastErrorCode",
          "publishedAt", "nextAttemptAt", "dueAt")
  ON TABLE public."JobPublicationIntent" TO skillquest_runtime;

-- Candidate is read inside the invoker-rights publication trigger as well.
GRANT SELECT ON TABLE public."JobPublicationCandidate",
  public."JobPublicationReady", public."JobLifetime" TO skillquest_runtime;

-- Retire expired/exhausted OTP jobs and rearm publication wake times.
-- No INSERT, DELETE or codeHash UPDATE on either OTP job table.
GRANT SELECT (id, status, attempts, "expiresAt", "encryptedPayload",
              "nextAttemptAt", "leaseUntil", "createdAt"),
  UPDATE (status, "encryptedPayload", "nextAttemptAt", "leaseUntil",
          "attemptToken", "lastErrorCode")
  ON TABLE public."ParticipantEmailDeliveryJob", public."OtpDeliveryJob"
  TO skillquest_runtime;

GRANT SELECT ("logicalKey", status, "leaseUntil")
  ON TABLE public."EmailBudgetReservation" TO skillquest_runtime;

-- Missing-report reconciliation: SELECT FOR UPDATE needs UPDATE permission;
-- enqueueReportInTransaction also updates revision and Prisma's @updatedAt.
GRANT SELECT (id, "expiresAt", state, email, "reportEmailRequested", revision),
  UPDATE (revision, "updatedAt")
  ON TABLE public."AdaptiveInterview" TO skillquest_runtime;

-- Upsert returns the full report row; INSERT includes explicit inputs plus
-- Prisma-generated UUID, timestamps and current model default fields.
GRANT SELECT ON TABLE public."AdaptiveReportJob" TO skillquest_runtime;
GRANT INSERT (id, "interviewId", status, "lastErrorCode", "emailStatus",
              attempts, "nextAttemptAt", "emailAttempts", "emailNextAttemptAt",
              "createdAt", "updatedAt"),
  UPDATE (status, "leaseUntil", "lastErrorCode", "emailStatus",
          "emailLeaseUntil", "emailLastErrorCode", "nextAttemptAt",
          "emailNextAttemptAt", "updatedAt")
  ON TABLE public."AdaptiveReportJob" TO skillquest_runtime;

-- synthetic_interview_guard reads existence of the marker even when empty.
-- It must NOT be granted INSERT or UPDATE to that installation marker.
GRANT SELECT (singleton)
  ON TABLE public."SyntheticStagingInstallation" TO skillquest_runtime;

-- No business DML, owner changes, role membership, global/default privileges,
-- CREATE, DELETE, TRUNCATE, trigger creation or sequence grants.
COMMIT;

-- INACTIVE APPENDIX: only if SKILLQUEST_STAGING_MODE=synthetic-v1 is confirmed
-- for THIS deployment/database. Not needed for the real publisher path.
-- assertSyntheticDatabase reads marker identity and synthetic-only identities;
-- SyntheticQstashPublisher consumes fault fixtures and inserts notifications.
-- No permission to create a marker, faults, OTPs or synthetic emails is needed.
-- BEGIN;
-- GRANT SELECT ("stagingId", "projectId", "databaseName")
--   ON TABLE public."SyntheticStagingInstallation" TO skillquest_runtime;
-- GRANT SELECT (email) ON TABLE public."User" TO skillquest_runtime;
-- GRANT SELECT ("displayName", "emailIdentity")
--   ON TABLE public."AdaptiveInterview" TO skillquest_runtime;
-- GRANT SELECT ("displayName") ON TABLE public."Participant" TO skillquest_runtime;
-- GRANT SELECT (provider, id, remaining, outcome), UPDATE (remaining)
--   ON TABLE public."SyntheticProviderFault" TO skillquest_runtime;
-- GRANT INSERT (id, payload)
--   ON TABLE public."SyntheticNotification" TO skillquest_runtime;
-- COMMIT;
