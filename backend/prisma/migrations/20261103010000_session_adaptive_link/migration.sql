-- AlterTable: Add optional sessionId to AdaptiveInterview
ALTER TABLE "AdaptiveInterview" ADD COLUMN IF NOT EXISTS "sessionId" UUID REFERENCES "AssessmentSession"("id") ON DELETE SET NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdaptiveInterview_sessionId_idx" ON "AdaptiveInterview"("sessionId");

-- Ensure permissions for skillquest_runtime role if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skillquest_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "AdaptiveInterview" TO skillquest_runtime;
  END IF;
END $$;

