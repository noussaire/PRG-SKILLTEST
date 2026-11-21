import { prisma } from "../db/prisma.js";

export async function purgeProxyNonces() {
  return prisma.$executeRawUnsafe(`WITH expired AS (SELECT nonce FROM "ProxyRequestNonce"
    WHERE "expiresAt"<(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY "expiresAt",nonce LIMIT 1000 FOR UPDATE SKIP LOCKED)
    DELETE FROM "ProxyRequestNonce" n USING expired e WHERE n.nonce=e.nonce`);
}
export function startProxyNonceRetention() {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { await purgeProxyNonces(); } catch { console.error("Proxy nonce cleanup temporarily unavailable"); }
    finally { running = false; }
  };
  void tick(); const timer = setInterval(() => { void tick(); }, 60000); timer.unref();
  return () => clearInterval(timer);
}
