import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { canonicalNetwork, digest, proofKey, verifyProof } from "../../../shared/network-proof.mjs";

export function proxyRequired() {
  const runtime = process.env.NODE_ENV ?? "development";
  const local = runtime === "test" || (runtime === "development" && process.env.SKILLQUEST_PROXY_MODE === "local");
  return !local || process.env.SKILLQUEST_PROXY_MODE === "required" || !!process.env.SKILLQUEST_PROXY_HMAC_KEY;
}
export function assertProxyConfiguration() {
  if (proxyRequired()) proofKey(process.env.SKILLQUEST_PROXY_HMAC_KEY);
}
export const proxyNetwork: RequestHandler = async (req, res, next) => {
  if (!proxyRequired()) {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
      res.status(403).json({ code: "PROXY_PROOF_INVALID", error: "Mode local réservé à la boucle locale." }); return;
    }
    res.locals.participantNetwork = req.socket.remoteAddress;
    return next(); // Local legacy API only; impossible in production.
  }
  let key: string;
  try { assertProxyConfiguration(); key = process.env.SKILLQUEST_PROXY_HMAC_KEY!; }
  catch { res.status(503).json({ code: "PROXY_UNAVAILABLE", error: "Service temporairement indisponible." }); return; }
  const token = req.headers["x-skillquest-proxy-proof"];
  if (typeof token !== "string") { res.status(403).json({ code: "PROXY_PROOF_INVALID", error: "Accès au proxy requis." }); return; }
  let p;
  try {
    // Reject forged signatures without touching PostgreSQL. Freshness is then
    // checked against the shared DB clock, never a client-supplied clock.
    p = verifyProof(token, key, "skillquest-api", req.method, req.originalUrl,
      res.locals.proxyBodyHash ?? digest(""), req.headers.authorization ?? "", null);
    if (p.network !== null && !canonicalNetwork(p.network)) throw Error();
  } catch { res.status(403).json({ code: "PROXY_PROOF_INVALID", error: "Preuve interne invalide." }); return; }
  try {
    // One DB clock reference and one atomic freshness/replay decision. A proof
    // cannot expire while waiting for a second connection between two queries.
    const used = await prisma.$executeRawUnsafe(`WITH clock AS (SELECT clock_timestamp() AS now)
      INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt")
      SELECT $1::uuid,(clock.now AT TIME ZONE 'UTC')+interval '65 seconds' FROM clock
      WHERE $2::float8 BETWEEN extract(epoch FROM clock.now)*1000-60000 AND extract(epoch FROM clock.now)*1000+5000
      ON CONFLICT DO NOTHING`, p.nonce, p.ts);
    if (used !== 1) { res.status(403).json({ code: "PROXY_PROOF_INVALID", error: "Preuve interne périmée ou déjà utilisée." }); return; }
    res.locals.participantNetwork = p.network === null ? null : `proof-v1:${p.network}`;
    next();
  } catch (error) { next(error); }
};
