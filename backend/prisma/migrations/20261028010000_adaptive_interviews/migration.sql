CREATE TABLE "AdaptiveInterview" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "state" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "busyUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdaptiveInterview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdaptiveInterview_tokenHash_key" ON "AdaptiveInterview"("tokenHash");
CREATE INDEX "AdaptiveInterview_expiresAt_idx" ON "AdaptiveInterview"("expiresAt");

CREATE TABLE "AdaptiveDailyUsage" (
    "day" VARCHAR(10) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AdaptiveDailyUsage_pkey" PRIMARY KEY ("day")
);
