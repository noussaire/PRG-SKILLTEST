import { Receiver } from "@upstash/qstash";
import { realProviderAllowed } from "./provider-mode.js";

export const QSTASH_CALLBACK_PATH = "/api/internal/jobs/qstash";
export class QstashConfigurationError extends Error { constructor() { super("QSTASH_DISABLED_OR_INVALID"); } }
export class QstashSignatureError extends Error { constructor() { super("QSTASH_SIGNATURE_INVALID"); } }

export function callbackUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== QSTASH_CALLBACK_PATH || url.href !== value) throw Error();
    return url.href;
  } catch { throw new QstashConfigurationError(); }
}

export function qstashConfiguration() {
  // Real transport/production activation requires a separately authorized step.
  const simulated = process.env.SKILLQUEST_QSTASH_MODE === "simulated" && process.env.VERCEL !== "1" && ["test", "development"].includes(process.env.NODE_ENV ?? "development");
  const real = process.env.SKILLQUEST_QSTASH_MODE === "real" && realProviderAllowed("QSTASH");
  if (!simulated && !real) throw new QstashConfigurationError();
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY, next = process.env.QSTASH_NEXT_SIGNING_KEY;
  const valid = (s: unknown): s is string => typeof s === "string" && s.length >= 32 && s.length <= 2048 && s.trim() === s && !/[\r\n]/.test(s);
  if (!valid(current) || !valid(next) || current === next || [process.env.SKILLQUEST_PROXY_HMAC_KEY, process.env.SKILLQUEST_EDGE_HMAC_KEY, process.env.JOIN_CODE_PEPPER].some(k => k && (k === current || k === next))) throw new QstashConfigurationError();
  return { current, next, url: callbackUrl(process.env.QSTASH_CALLBACK_URL ?? "") };
}

// Official SDK verifies the signature, issuer, nbf/exp, exact body hash and URL.
// The application additionally requires the documented temporal claims and HS256.
export async function authenticateQstash(signature: unknown, raw: Buffer, config: ReturnType<typeof qstashConfiguration>) {
  try {
    if (typeof signature !== "string" || signature.length > 8192) throw Error();
    const parts = signature.split(".");
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p) || Buffer.from(p,"base64url").toString("base64url") !== p)) throw Error();
    const header = JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
    if (header.alg !== "HS256" || header.crit !== undefined || header.b64 !== undefined || header.jku !== undefined || header.jwk !== undefined) throw Error();
    const body = raw.toString("utf8"); if (!Buffer.from(body,"utf8").equals(raw)) throw Error();
    await new Receiver({ currentSigningKey: config.current, nextSigningKey: config.next, devMode: false }).verify({ signature, body, url: config.url, clockTolerance: 0 });
    const claims = JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8")), now = Math.floor(Date.now()/1000);
    if (![claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger) || claims.exp <= now || claims.nbf > now || claims.iat > now + 5 ||
        claims.exp <= claims.iat || claims.exp - claims.iat > 300 || claims.nbf > claims.exp || typeof claims.jti !== "string" || !claims.jti || claims.jti.length > 256) throw Error();
  } catch { throw new QstashSignatureError(); }
}
