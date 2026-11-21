import type { PrismaClient } from "@prisma/client";
import { activeOtpEncryptionKeyId, OTP_BOOTSTRAP_KEY_ID } from "../security/otp-payload.js";

export type OtpKeyUsage = { format: string; keyId: string | null; payloads: number; unexpired: number; leased: number; uncertain: number };

// Inventory BOTH outboxes, including expired, leased and uncertain payloads.
// Never returns ciphertext, addresses, codes or key material.
export async function inspectOtpKeyUsage(db: PrismaClient): Promise<OtpKeyUsage[]> {
  return db.$queryRawUnsafe<OtpKeyUsage[]>(`WITH payloads AS (
    SELECT "encryptedPayload" AS value,"expiresAt","leaseUntil",status FROM "OtpDeliveryJob" WHERE "encryptedPayload" IS NOT NULL
    UNION ALL SELECT "encryptedPayload","expiresAt","leaseUntil",status FROM "ParticipantEmailDeliveryJob" WHERE "encryptedPayload" IS NOT NULL
  ), classified AS (
    SELECT CASE WHEN split_part(value,':',1)='v1' AND array_length(string_to_array(value,':'),1)=4 THEN 'v1'
      WHEN split_part(value,':',1)='v2' AND array_length(string_to_array(value,':'),1)=5
        AND split_part(value,':',2) ~ '^[A-Za-z0-9_-]{1,48}$' THEN 'v2' ELSE 'unknown' END AS format,
      CASE WHEN split_part(value,':',1)='v2' THEN split_part(value,':',2) ELSE NULL END AS "keyId", "expiresAt","leaseUntil",status FROM payloads
  ) SELECT format,CASE WHEN format='v2' THEN "keyId" ELSE NULL END AS "keyId",count(*)::int AS payloads,
    count(*) FILTER (WHERE "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))::int AS unexpired,
    count(*) FILTER (WHERE "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC'))::int AS leased,
    count(*) FILTER (WHERE status='UNCERTAIN')::int AS uncertain
    FROM classified GROUP BY format,CASE WHEN format='v2' THEN "keyId" ELSE NULL END ORDER BY format,"keyId"`);
}

// Necessary local checks, not proof that every writer has switched versions.
export async function assertOtpKeyRetirable(db: PrismaClient, keyId: string) {
  if (activeOtpEncryptionKeyId() === keyId) throw new Error("OTP_KEY_STILL_ACTIVE");
  const rows = await inspectOtpKeyUsage(db);
  if (rows.some(row => row.format === "unknown" || row.keyId === keyId
    || (row.format === "v1" && ["legacy-v1", OTP_BOOTSTRAP_KEY_ID].includes(keyId)))) throw new Error("OTP_KEY_STILL_REQUIRED");
}
