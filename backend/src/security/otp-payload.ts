import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export const OTP_BOOTSTRAP_KEY_ID = "join-pepper";
type PayloadErrorCode = "OTP_PAYLOAD_INVALID" | "OTP_PAYLOAD_KEY_UNAVAILABLE" | "OTP_PAYLOAD_VERSION_UNSUPPORTED" | "OTP_PAYLOAD_CONFIG_INVALID";
export class OtpPayloadError extends Error {
  constructor(public readonly code: PayloadErrorCode) { super(code); }
}
const invalid = () => new OtpPayloadError("OTP_PAYLOAD_INVALID");
const badConfig = () => new OtpPayloadError("OTP_PAYLOAD_CONFIG_INVALID");

function configuration() {
  try {
    const raw = process.env.OTP_ENCRYPTION_KEYS;
    const active = process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID;
    const writeVersion = process.env.OTP_PAYLOAD_WRITE_VERSION ?? "v2";
    if (!["v1", "v2"].includes(writeVersion)) throw badConfig();
    const parsed: unknown = raw === undefined ? {} : JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw badConfig();
    const entries = Object.entries(parsed);
    if (entries.length > 16) throw badConfig();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of entries) {
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || id === OTP_BOOTSTRAP_KEY_ID || typeof value !== "string") throw badConfig();
      const material = Buffer.from(value, "base64");
      if (material.length !== 32 || material.toString("base64") !== value) throw badConfig();
      keys.set(id, material);
    }
    if (active !== undefined && !keys.has(active)) throw badConfig();
    return { keys, active, writeVersion };
  } catch { throw badConfig(); }
}

function legacySecrets() {
  const secrets = [process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS]
    .filter((s): s is string => !!s && s.length >= 32);
  if (!secrets.length) throw new OtpPayloadError("OTP_PAYLOAD_KEY_UNAVAILABLE");
  return secrets;
}
function currentLegacySecret() {
  const secret = process.env.JOIN_CODE_PEPPER;
  if (!secret || secret.length < 32) throw new OtpPayloadError("OTP_PAYLOAD_KEY_UNAVAILABLE");
  return secret;
}
function deriveKey(material: Buffer, id: string) {
  return Buffer.from(hkdfSync("sha256", material, "skillquest:otp-outbox:hkdf:v2", `aes-256-gcm:${id}`, 32));
}
function aad(id: string, jobId: string) { return Buffer.from(JSON.stringify(["skillquest", "otp-outbox", "v2", id, jobId])); }
export function activeOtpEncryptionKeyId() {
  const config = configuration();
  return config.writeVersion === "v1" ? "legacy-v1" : config.active ?? OTP_BOOTSTRAP_KEY_ID;
}

export function encryptOtpPayload(value: unknown, jobId: string): string {
  const config = configuration(), iv = randomBytes(12);
  const id = config.active ?? OTP_BOOTSTRAP_KEY_ID;
  // Bootstrap avoids changing existing secrets. Dedicated encryption roots can
  // rotate independently of session codes, counters and historical OTP HMACs.
  const material = config.active ? config.keys.get(config.active)! : Buffer.from(currentLegacySecret());
  const key = config.writeVersion === "v1"
    ? createHash("sha256").update(`skillquest:otp-outbox:v1:${currentLegacySecret()}`).digest()
    : deriveKey(material, id);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(config.writeVersion === "v1" ? Buffer.from(`otp-job:${jobId}`) : aad(id, jobId));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [...(config.writeVersion === "v1" ? ["v1"] : ["v2", id]), iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("base64")].join(":");
}

export function decryptOtpPayload(value: string, jobId: string): unknown {
  try {
    if (typeof value !== "string" || value.length > 1048576) throw invalid();
    const parts = value.split(":"), version = parts[0];
    if (version !== "v1" && version !== "v2") throw new OtpPayloadError("OTP_PAYLOAD_VERSION_UNSUPPORTED");
    if (parts.length !== (version === "v1" ? 4 : 5)) throw invalid();
    const [iv, tag, data] = parts.slice(version === "v1" ? 1 : 2);
    if (!/^[a-f0-9]{24}$/.test(iv) || !/^[a-f0-9]{32}$/.test(tag) || !data || Buffer.from(data, "base64").toString("base64") !== data) throw invalid();
    let keys: Buffer[], authenticated: Buffer;
    if (version === "v1") {
      keys = legacySecrets().map(secret => createHash("sha256").update(`skillquest:otp-outbox:v1:${secret}`).digest());
      authenticated = Buffer.from(`otp-job:${jobId}`);
    } else {
      const id = parts[1];
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) throw invalid();
      const config = configuration();
      if (id === OTP_BOOTSTRAP_KEY_ID) keys = legacySecrets().map(secret => deriveKey(Buffer.from(secret), id));
      else {
        const material = config.keys.get(id);
        if (!material) throw new OtpPayloadError("OTP_PAYLOAD_KEY_UNAVAILABLE");
        keys = [deriveKey(material, id)];
      }
      authenticated = aad(id, jobId);
    }
    for (const key of keys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
        decipher.setAAD(authenticated); decipher.setAuthTag(Buffer.from(tag, "hex"));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8"));
      } catch { /* Only legacy/bootstrap payloads may try the previous pepper. */ }
    }
    throw invalid();
  } catch (error) {
    if (error instanceof OtpPayloadError) throw error;
    throw invalid();
  }
}
