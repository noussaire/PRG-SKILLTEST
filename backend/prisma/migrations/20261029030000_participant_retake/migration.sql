ALTER TABLE "AdaptiveInterview"
  ADD COLUMN "emailIdentity" VARCHAR(254),
  ADD COLUMN "lastTestStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "retakeCodeHash" CHAR(64),
  ADD COLUMN "retakeCodeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "retakeCodeSentAt" TIMESTAMP(3),
  ADD COLUMN "retakeCodeAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousResult" JSONB;

UPDATE "AdaptiveInterview" SET "lastTestStartedAt" = "createdAt";
-- Keep historical rows intact. For pre-existing duplicates, the latest test is
-- the identity owner used by future starts; migration never deletes results.
WITH normalized AS (
 SELECT "id", "createdAt", CASE
 WHEN split_part(lower(trim("email")), '@', 2) IN ('gmail.com', 'googlemail.com')
 THEN replace(split_part(split_part(lower(trim("email")), '@', 1), '+', 1), '.', '') || '@gmail.com'
 ELSE lower(trim("email")) END AS identity
 FROM "AdaptiveInterview" WHERE "email" IS NOT NULL
), ranked AS (
 SELECT *, row_number() OVER (PARTITION BY identity ORDER BY "createdAt" DESC, "id" DESC) AS rank FROM normalized
)
UPDATE "AdaptiveInterview" AS interview SET "emailIdentity" = ranked.identity
FROM ranked WHERE interview."id" = ranked."id" AND ranked.rank = 1;
CREATE UNIQUE INDEX "AdaptiveInterview_emailIdentity_key" ON "AdaptiveInterview"("emailIdentity");
