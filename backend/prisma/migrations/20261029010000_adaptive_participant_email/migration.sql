-- Existing participants retain their saved name and progress; email is requested only for new tests.
ALTER TABLE "AdaptiveInterview" ADD COLUMN "email" VARCHAR(254);
CREATE INDEX "AdaptiveInterview_email_idx" ON "AdaptiveInterview"("email");
