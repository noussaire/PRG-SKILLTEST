import { timingSafeEqual } from "node:crypto";

export const DISPATCH_PATH = "/api/internal/jobs/dispatch";
export function dispatchSecret() {
  if (process.env.SKILLQUEST_DISPATCH_ENABLED !== "1") throw Error("DISPATCH_DISABLED");
  const secret = process.env.SKILLQUEST_DISPATCH_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, "base64url").length !== 32 || Buffer.from(secret, "base64url").toString("base64url") !== secret) throw Error("DISPATCH_DISABLED");
  const keys = [process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS, process.env.SKILLQUEST_MAINTENANCE_SECRET,
    process.env.SKILLQUEST_STAGING_SECRET, process.env.SKILLQUEST_PROXY_HMAC_KEY, process.env.SKILLQUEST_EDGE_HMAC_KEY,
    process.env.BREVO_API_KEY, process.env.GROQ_API_KEY, process.env.QSTASH_TOKEN, process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY];
  const ring: unknown = JSON.parse(process.env.OTP_ENCRYPTION_KEYS ?? "{}");
  if (!ring || typeof ring !== "object" || Array.isArray(ring)) throw Error("DISPATCH_DISABLED");
  for (const value of [...keys, ...Object.values(ring)]) {
    if (value === undefined) continue;
    if (typeof value !== "string") throw Error("DISPATCH_DISABLED");
    const material = Buffer.from(secret, "base64url");
    if (value === secret || Buffer.from(value).equals(material) || Buffer.from(value, "base64").equals(material) || (/^[a-f0-9]{64}$/i.test(value) && Buffer.from(value, "hex").equals(material))) throw Error("DISPATCH_DISABLED");
  }
  return secret;
}
export function dispatchAuthenticated(value: unknown, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  return typeof value === "string" && Buffer.byteLength(value) === expected.length && timingSafeEqual(Buffer.from(value), expected);
}
