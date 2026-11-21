-- READ ONLY. Run before any authorized grant, and again afterwards.
-- Outputs only object/column names, expected privileges and catalog flags.
-- Does not read connection strings, credentials, OTP contents or business rows.
-- A false before correction identifies a missing privilege. Afterwards all
-- privilege_ok rows should be true. This also recognizes inherited/table grants.
WITH required(object_name, privilege, columns) AS (VALUES
  ('JobDispatchState', 'SELECT', NULL::text[]),
  ('JobDispatchState', 'UPDATE', ARRAY['cursor','attemptToken','leaseUntil','nextAllowedAt']),
  ('JobDispatchUsage', 'SELECT', NULL::text[]),
  ('JobDispatchUsage', 'INSERT', ARRAY['day','attempts']),
  ('JobDispatchUsage', 'UPDATE', ARRAY['attempts']),
  ('JobPublicationIntent', 'SELECT', NULL::text[]),
  ('JobPublicationIntent', 'INSERT', ARRAY['kind','jobId','phase','generation','dueAt','nextAttemptAt']),
  ('JobPublicationIntent', 'UPDATE', ARRAY['state','attempts','attemptToken','leaseUntil','lastErrorCode','publishedAt','nextAttemptAt','dueAt']),
  ('JobPublicationCandidate', 'SELECT', NULL::text[]),
  ('JobPublicationReady', 'SELECT', NULL::text[]),
  ('JobLifetime', 'SELECT', NULL::text[]),
  ('ParticipantEmailDeliveryJob', 'SELECT', ARRAY['id','status','attempts','expiresAt','encryptedPayload','nextAttemptAt','leaseUntil','createdAt']),
  ('ParticipantEmailDeliveryJob', 'UPDATE', ARRAY['status','encryptedPayload','nextAttemptAt','leaseUntil','attemptToken','lastErrorCode']),
  ('OtpDeliveryJob', 'SELECT', ARRAY['id','status','attempts','expiresAt','encryptedPayload','nextAttemptAt','leaseUntil','createdAt']),
  ('OtpDeliveryJob', 'UPDATE', ARRAY['status','encryptedPayload','nextAttemptAt','leaseUntil','attemptToken','lastErrorCode']),
  ('EmailBudgetReservation', 'SELECT', ARRAY['logicalKey','status','leaseUntil']),
  ('AdaptiveInterview', 'SELECT', ARRAY['id','expiresAt','state','email','reportEmailRequested','revision']),
  ('AdaptiveInterview', 'UPDATE', ARRAY['revision','updatedAt']),
  ('AdaptiveReportJob', 'SELECT', NULL::text[]),
  ('AdaptiveReportJob', 'INSERT', ARRAY['id','interviewId','status','lastErrorCode','emailStatus','attempts','nextAttemptAt','emailAttempts','emailNextAttemptAt','createdAt','updatedAt']),
  ('AdaptiveReportJob', 'UPDATE', ARRAY['status','leaseUntil','lastErrorCode','emailStatus','emailLeaseUntil','emailLastErrorCode','nextAttemptAt','emailNextAttemptAt','updatedAt']),
  ('SyntheticStagingInstallation', 'SELECT', ARRAY['singleton'])
), resolved AS (
  SELECT r.*, to_regclass(format('public.%I', object_name)) AS object_oid
  FROM required r
)
SELECT object_name, privilege, columns AS required_columns,
  object_oid IS NOT NULL AS object_exists,
  CASE WHEN object_oid IS NULL THEN false
    WHEN columns IS NULL THEN has_table_privilege('skillquest_runtime', object_oid, privilege)
    ELSE (SELECT bool_and(CASE WHEN a.attnum IS NULL THEN false
            ELSE has_column_privilege('skillquest_runtime', object_oid, a.attnum, privilege) END)
      FROM unnest(columns) AS needed(column_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=object_oid
        AND a.attname=needed.column_name AND a.attnum>0 AND NOT a.attisdropped)
  END AS privilege_ok
FROM resolved
ORDER BY object_name, privilege;

-- Schema drift check. Stop if a view is security_invoker=true, if RLS applies,
-- or if trigger definitions differ from those reviewed in the repository.
-- Owner-rights views require their OWNER to retain underlying SELECT rights;
-- do not give runtime extra underlying access just to mask an owner problem.
SELECT c.relname AS object_name, c.relkind,
  c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
  c.reloptions,
  CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid, true) END AS view_definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN (
  'JobDispatchState','JobDispatchUsage','JobPublicationIntent',
  'JobPublicationCandidate','JobPublicationReady','JobLifetime',
  'ParticipantEmailDeliveryJob','OtpDeliveryJob','EmailBudgetReservation',
  'AdaptiveInterview','AdaptiveReportJob','SyntheticStagingInstallation'
)
ORDER BY c.relname;

SELECT c.relname AS table_name, t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  p.prosecdef AS security_definer, pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND c.relname IN ('JobDispatchState','JobDispatchUsage','JobPublicationIntent',
    'AdaptiveInterview','AdaptiveReportJob','ParticipantEmailDeliveryJob','OtpDeliveryJob')
ORDER BY c.relname, t.tgname;

-- USAGE is already confirmed; no schema grant is proposed.
SELECT has_schema_privilege('skillquest_runtime', 'public', 'USAGE') AS schema_usage_ok;

-- Optional path inventory ONLY, not additional requirements for the real path.
-- Inspect only if synthetic-v1 is the confirmed configured mode.
WITH required(object_name, privilege, columns) AS (VALUES
  ('SyntheticStagingInstallation','SELECT',ARRAY['singleton','stagingId','projectId','databaseName']),
  ('User','SELECT',ARRAY['email']),
  ('AdaptiveInterview','SELECT',ARRAY['displayName','emailIdentity']),
  ('Participant','SELECT',ARRAY['displayName']),
  ('SyntheticProviderFault','SELECT',ARRAY['provider','id','remaining','outcome']),
  ('SyntheticProviderFault','UPDATE',ARRAY['remaining']),
  ('SyntheticNotification','INSERT',ARRAY['id','payload'])
)
SELECT object_name, privilege, columns AS synthetic_only_columns,
  (SELECT bool_and(CASE WHEN a.attnum IS NULL THEN false
      ELSE has_column_privilege('skillquest_runtime', a.attrelid, a.attnum, r.privilege) END)
    FROM unnest(r.columns) AS needed(column_name)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid=to_regclass(format('public.%I',r.object_name))
      AND a.attname=needed.column_name AND a.attnum>0 AND NOT a.attisdropped
  ) AS privilege_ok
FROM required r
ORDER BY object_name, privilege;
