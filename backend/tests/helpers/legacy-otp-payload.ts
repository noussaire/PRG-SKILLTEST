import { createCipheriv, createHash, randomBytes } from "node:crypto";

// Independent copy of the PRE-rotation writer, for genuine v1 compatibility
// fixtures. Never uses the implementation under test to manufacture v1 data.
export function legacyOtpFixture(value: unknown, jobId: string, syntheticSecret: string) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(`skillquest:otp-outbox:v1:${syntheticSecret}`).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`otp-job:${jobId}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("base64")].join(":");
}
