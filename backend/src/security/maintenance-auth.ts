import { timingSafeEqual } from "node:crypto";

export class MaintenanceConfigurationError extends Error { constructor() { super("MAINTENANCE_DISABLED"); } }
export function maintenanceSecret(): string {
  if (process.env.SKILLQUEST_MAINTENANCE_ENABLED !== "1") throw new MaintenanceConfigurationError();
  const secret = process.env.SKILLQUEST_MAINTENANCE_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new MaintenanceConfigurationError();
  const material = Buffer.from(secret, "base64url");
  if (material.length !== 32 || material.toString("base64url") !== secret) throw new MaintenanceConfigurationError();
  const other = [process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS,
    process.env.SKILLQUEST_PROXY_HMAC_KEY, process.env.SKILLQUEST_EDGE_HMAC_KEY,
    process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY, process.env.QSTASH_TOKEN,
    process.env.BREVO_API_KEY, process.env.GROQ_API_KEY];
  try {
    if (process.env.OTP_ENCRYPTION_KEYS !== undefined) {
      const ring:unknown = JSON.parse(process.env.OTP_ENCRYPTION_KEYS);
      if (!ring || typeof ring !== "object" || Array.isArray(ring)) throw Error();
      for (const value of Object.values(ring)) { if(typeof value !== "string")throw Error(); other.push(value); }
    }
    for (const value of other) {
      if (!value) continue;
      // Detect both literal reuse and equal material under base64/base64url/hex.
      if (value === secret || Buffer.from(value).equals(material) ||
          Buffer.from(value,"base64").equals(material) || (/^[a-fA-F0-9]{64}$/.test(value) && Buffer.from(value,"hex").equals(material))) throw Error();
    }
  } catch { throw new MaintenanceConfigurationError(); }
  return secret;
}

export function authenticateMaintenance(header:unknown, secret:string) {
  const expected=Buffer.from(`Bearer ${secret}`);
  if(typeof header!=="string"||header.length!==expected.length)return false;
  const candidate=Buffer.from(header);
  return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
}
