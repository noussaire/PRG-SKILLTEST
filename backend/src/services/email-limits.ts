import { createHash, createHmac } from "node:crypto";

export class EmailLimitError extends Error {
  constructor(public code: string, public retryAfterSeconds = 60, public uncertain = false) { super(code); }
}

export function emailLimits(source: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number) => {
    const value = source[key] === undefined ? fallback : Number(source[key]);
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new EmailLimitError("EMAIL_LIMIT_CONFIG_INVALID");
    return value;
  };
  const account = integer("EMAIL_ACCOUNT_DAILY_LIMIT", 0);
  const margin = integer("EMAIL_OTHER_USAGE_MARGIN", 60);
  return {
    dailyBudget: Math.max(0, Math.min(integer("EMAIL_APP_DAILY_LIMIT", 240), account - margin)),
    identitySends: integer("OTP_IDENTITY_DAILY_SENDS", 5),
    networkSends: integer("OTP_NETWORK_DAILY_SENDS", 100),
    globalSends: integer("OTP_GLOBAL_DAILY_SENDS", 120),
    identityFailures: integer("OTP_IDENTITY_DAILY_FAILURES", 15),
    networkFailures: integer("OTP_NETWORK_DAILY_FAILURES", 150),
    globalFailures: integer("OTP_GLOBAL_DAILY_FAILURES", 1000),
  };
}

export function normalizedEmailIdentity(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  return domain === "gmail.com" || domain === "googlemail.com"
    ? `${local.split("+")[0].replaceAll(".", "")}@gmail.com` : `${local}@${domain}`;
}

// Domain separated HMACs: never persist raw addresses or network origins in counters.
export function emailSubjectHash(kind: "IDENTITY" | "NETWORK" | "GLOBAL", value: string) {
  // No PII in the global subject: keep its budget key stable across key rotation.
  if (kind === "GLOBAL") return createHash("sha256").update("skillquest:brevo:global").digest("hex");
  const secret = process.env.JOIN_CODE_PEPPER;
  if (!secret || secret.length < 32) throw new EmailLimitError("EMAIL_LIMIT_CONFIG_INVALID");
  return createHmac("sha256", secret).update(`email-limit:${kind}:${value}`).digest("hex");
}
