import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export class SyntheticStagingError extends Error {
  constructor(public readonly code = "SYNTHETIC_STAGING_UNAVAILABLE") { super(code); }
}
const uuid = z.string().uuid();
export const syntheticEmail = (value: string) => /^[a-z0-9][a-z0-9._+-]{0,63}@example\.test$/i.test(value);
export const syntheticName = (value: string) => value.startsWith("SYNTH-") && value.length <= 100;

// No implicit selection from NODE_ENV, Vercel headers or a browser parameter.
export function stagingConfiguration() {
  const mode = process.env.SKILLQUEST_STAGING_MODE;
  if (mode === undefined || mode === "off") return null;
  const secret = process.env.SKILLQUEST_STAGING_SECRET ?? "";
  const id = process.env.SKILLQUEST_STAGING_ID ?? "";
  const material = Buffer.from(secret, "base64url");
  if (mode !== "synthetic-v1" || process.env.SKILLQUEST_DEPLOYMENT_PURPOSE !== "synthetic-staging" ||
      process.env.SKILLQUEST_STAGING_ACK !== "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS" ||
      !uuid.safeParse(id).success || material.length !== 32 || material.toString("base64url") !== secret) throw new SyntheticStagingError();
  const providerSecrets = ["BREVO_API_KEY", "GROQ_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"];
  if (providerSecrets.some(key => !!process.env[key])) throw new SyntheticStagingError();
  const other = [process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS, process.env.SKILLQUEST_PROXY_HMAC_KEY,
    process.env.SKILLQUEST_EDGE_HMAC_KEY, process.env.SKILLQUEST_MAINTENANCE_SECRET];
  try {
    const ring = JSON.parse(process.env.OTP_ENCRYPTION_KEYS ?? "{}");
    if (!ring || typeof ring !== "object" || Array.isArray(ring)) throw Error();
    other.push(...Object.values(ring) as string[]);
    for (const value of other) {
      if (value === undefined) continue;
      if (typeof value !== "string" || value === secret || Buffer.from(value).equals(material) || Buffer.from(value, "base64").equals(material) ||
          (/^[a-f0-9]{64}$/i.test(value) && Buffer.from(value, "hex").equals(material))) throw Error();
    }
  } catch { throw new SyntheticStagingError(); }
  let project: string | null = null;
  if (process.env.VERCEL === "1") {
    project = process.env.VERCEL_PROJECT_ID ?? "";
    if (!/^prj_[a-zA-Z0-9]+$/.test(project) || project !== process.env.SKILLQUEST_STAGING_VERCEL_PROJECT_ID ||
        !["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) throw new SyntheticStagingError();
  } else if (!['development', 'test', 'production'].includes(process.env.NODE_ENV ?? 'development')) {
    throw new SyntheticStagingError();
  } else if (process.env.SKILLQUEST_STAGING_VERCEL_PROJECT_ID) {
    const specified = process.env.SKILLQUEST_STAGING_VERCEL_PROJECT_ID;
    if (!/^prj_[a-zA-Z0-9]+$/.test(specified)) throw new SyntheticStagingError();
    project = specified;
  }
  return { id, project, material };
}

export async function assertSyntheticDatabase(db: Pick<PrismaClient, "$queryRawUnsafe">) {
  const config = stagingConfiguration();
  if (!config) throw new SyntheticStagingError();
  const [{ name }] = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT current_database() AS name`);
  if (name.toLowerCase() === "skillquest-db" || name.toLowerCase().includes("skillquest-db") ||
      (process.env.DATABASE_URL && /skillquest-db/i.test(process.env.DATABASE_URL))) {
    throw new SyntheticStagingError("FORBIDDEN_LEGACY_DATABASE");
  }
  const rows = await db.$queryRawUnsafe<{ valid: boolean }[]>(`SELECT EXISTS(
    SELECT 1 FROM "SyntheticStagingInstallation" WHERE singleton=1 AND "stagingId"=$1::uuid
      AND "projectId" IS NOT DISTINCT FROM $2::text AND "databaseName"=current_database()) AS valid`, config.id, config.project);
  if (!rows[0]?.valid) throw new SyntheticStagingError();
  // A marker alone must never turn an existing real database into a sandbox.
  const [audit] = await db.$queryRawUnsafe<{ unsafe: boolean }[]>(`SELECT
    EXISTS(SELECT 1 FROM "User" WHERE email !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR
    EXISTS(SELECT 1 FROM "AdaptiveInterview" WHERE "displayName" NOT LIKE 'SYNTH-%' OR
      (email IS NOT NULL AND email !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR
      ("emailIdentity" IS NOT NULL AND "emailIdentity" !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$')) OR
    EXISTS(SELECT 1 FROM "Participant" WHERE "displayName" NOT LIKE 'SYNTH-%') AS unsafe`);
  if (audit.unsafe) throw new SyntheticStagingError();
  return config;
}

function key(usage: string) {
  const config = stagingConfiguration(); if (!config) throw new SyntheticStagingError();
  return Buffer.from(hkdfSync("sha256", config.material, `skillquest:synthetic:${config.id}:v1`, usage, 32));
}
export function sealSyntheticMail(id: string, value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key("mail-encryption"), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
}
export function openSyntheticMail(id: string, value: string): unknown {
  try {
    const [iv, tag, ciphertext, extra] = value.split("."); if (extra !== undefined) throw Error();
    const cipher = createDecipheriv("aes-256-gcm", key("mail-encryption"), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext, "base64url")), cipher.final()]).toString("utf8"));
  } catch { throw new SyntheticStagingError("SYNTHETIC_MAIL_INVALID"); }
}
export function stagingProof(method: string, url: string, body: Buffer, authorization: string, id: string, timestamp: string) {
  const data = JSON.stringify(["synthetic-operations-v1", method, url, id, timestamp,
    createHash("sha256").update(body).digest("hex"), createHash("sha256").update(authorization).digest("hex")]);
  return createHmac("sha256", key("operations-authentication")).update(data).digest("base64url");
}
export function validStagingProof(proof: string, expected: string) {
  const candidate = Buffer.from(proof), comparison = Buffer.from(expected);
  return candidate.length === comparison.length && timingSafeEqual(candidate, comparison);
}

// Server-side binding of the publication to its exact authorized initial OTP target.
// This is not a Bearer/session or an OTP and cannot authorize an HTTP invocation.
export function syntheticOtpTargetProof(target: { jobId: string; challengeId: string; notificationId: string; fullName: string; email: string }) {
  return createHmac("sha256", key("otp-target-binding")).update(JSON.stringify([
    "synthetic-otp-target-v1", target.jobId, target.challengeId, target.notificationId,
    target.fullName, target.email.toLowerCase(),
  ])).digest("base64url");
}
