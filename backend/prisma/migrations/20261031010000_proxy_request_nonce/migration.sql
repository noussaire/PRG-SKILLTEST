-- Additive replay protection only; historical data and migrations unchanged.
CREATE TABLE "ProxyRequestNonce" (
  "nonce" UUID PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProxyRequestNonce_expiresAt_idx" ON "ProxyRequestNonce"("expiresAt");
