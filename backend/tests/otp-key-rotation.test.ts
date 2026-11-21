import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, hkdfSync, randomUUID } from "node:crypto";
import { encryptOtpPayload, decryptOtpPayload, activeOtpEncryptionKeyId } from "../src/security/otp-payload.js";
import { legacyOtpFixture } from "./helpers/legacy-otp-payload.js";

const variables = ["JOIN_CODE_PEPPER", "JOIN_CODE_PEPPER_PREVIOUS", "OTP_ENCRYPTION_KEYS", "OTP_ENCRYPTION_ACTIVE_KEY_ID", "OTP_PAYLOAD_WRITE_VERSION"];
const pepper = "synthetic-key-tests-pepper-0123456789abcdef";
const a = Buffer.alloc(32, 41), b = Buffer.alloc(32, 73);
let saved: Array<string | undefined>;
beforeEach(() => {
  saved = variables.map(k => process.env[k]); variables.forEach(k => delete process.env[k]);
  process.env.JOIN_CODE_PEPPER = pepper;
});
afterEach(() => variables.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }));
function configure(active = "key-a") {
  process.env.OTP_ENCRYPTION_KEYS = JSON.stringify({ "key-a": a.toString("base64"), "key-b": b.toString("base64") });
  process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID = active;
}

test("Versioned AES-GCM round trip uses HKDF and authenticates key id plus job id", () => {
  configure(); const id = randomUUID(), payload = { synthetic: "OTP" };
  const encrypted = encryptOtpPayload(payload, id);
  assert.match(encrypted, /^v2:key-a:[a-f0-9]{24}:[a-f0-9]{32}:/);
  assert.deepEqual(decryptOtpPayload(encrypted, id), payload);
  assert.notEqual(encryptOtpPayload(payload, id), encrypted);
  assert.equal(activeOtpEncryptionKeyId(), "key-a");
  assert.throws(() => decryptOtpPayload(encrypted, randomUUID()), /OTP_PAYLOAD_INVALID/);
  const [, keyId, iv, tag, data] = encrypted.split(":");
  const derived = Buffer.from(hkdfSync("sha256", a, "skillquest:otp-outbox:hkdf:v2", "aes-256-gcm:key-a", 32));
  assert.notDeepEqual(derived, a);
  assert.notDeepEqual(derived, Buffer.from(hkdfSync("sha256", a, "skillquest:otp-outbox:hkdf:v2", "hmac:entry:key-a", 32)));
  const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(iv, "hex"));
  decipher.setAAD(Buffer.from(JSON.stringify(["skillquest", "otp-outbox", "v2", keyId, id]))); decipher.setAuthTag(Buffer.from(tag, "hex"));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString()), payload);
});

test("Independent historical v1 fixture decrypts using current or previous legacy pepper", () => {
  const id = randomUUID(), payload = { synthetic: "historical pending message" };
  const old = legacyOtpFixture(payload, id, pepper);
  configure("key-b"); assert.deepEqual(decryptOtpPayload(old, id), payload);
  process.env.JOIN_CODE_PEPPER_PREVIOUS = pepper;
  process.env.JOIN_CODE_PEPPER = "synthetic-new-hmac-pepper-0123456789abcdef";
  assert.deepEqual(decryptOtpPayload(old, id), payload);
  delete process.env.JOIN_CODE_PEPPER_PREVIOUS;
  assert.throws(() => decryptOtpPayload(old, id), /OTP_PAYLOAD_INVALID/);
});

test("Encryption roots rotate independently of JOIN_CODE_PEPPER and retain old named-key reads", () => {
  configure(); const id = randomUUID(), payload = { synthetic: true }, old = encryptOtpPayload(payload, id);
  process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID = "key-b";
  delete process.env.JOIN_CODE_PEPPER;
  assert.deepEqual(decryptOtpPayload(old, id), payload);
  assert.match(encryptOtpPayload(payload, id), /^v2:key-b:/);
  process.env.OTP_ENCRYPTION_KEYS = JSON.stringify({ "key-b": b.toString("base64") });
  assert.throws(() => decryptOtpPayload(old, id), /OTP_PAYLOAD_KEY_UNAVAILABLE/);
  configure("key-b"); assert.deepEqual(decryptOtpPayload(old, id), payload);
});

test("Every altered component, extra component and unknown version/key is refused", () => {
  configure(); const id = randomUUID(), parts = encryptOtpPayload({ synthetic: true }, id).split(":");
  for (const index of [2, 3, 4]) {
    const altered = [...parts]; altered[index] = (altered[index][0] === "a" ? "b" : "a") + altered[index].slice(1);
    assert.throws(() => decryptOtpPayload(altered.join(":"), id), /OTP_PAYLOAD_INVALID/);
  }
  const differentId = [...parts]; differentId[1] = "key-b";
  assert.throws(() => decryptOtpPayload(differentId.join(":"), id), /OTP_PAYLOAD_INVALID/);
  const unknownKey = [...parts]; unknownKey[1] = "not-installed";
  assert.throws(() => decryptOtpPayload(unknownKey.join(":"), id), /OTP_PAYLOAD_KEY_UNAVAILABLE/);
  assert.throws(() => decryptOtpPayload(parts.join(":") + ":extra", id), /OTP_PAYLOAD_INVALID/);
  const unknownVersion = [...parts]; unknownVersion[0] = "v99";
  assert.throws(() => decryptOtpPayload(unknownVersion.join(":"), id), /OTP_PAYLOAD_VERSION_UNSUPPORTED/);
  const old = legacyOtpFixture({ synthetic: true }, id, pepper);
  assert.throws(() => decryptOtpPayload(old + ":extra", id), /OTP_PAYLOAD_INVALID/);
});

test("Misconfigured keyrings fail closed and never expose their content", () => {
  for (const raw of ["sensitive-invalid-json", "[]", JSON.stringify({ "key-a": "sensitive-not-a-key" }), JSON.stringify({ "join-pepper": a.toString("base64") })]) {
    process.env.OTP_ENCRYPTION_KEYS = raw;
    assert.throws(() => encryptOtpPayload({}, randomUUID()), (e: Error) => e.message === "OTP_PAYLOAD_CONFIG_INVALID");
  }
  configure("not-installed");
  assert.throws(() => encryptOtpPayload({}, randomUUID()), /OTP_PAYLOAD_CONFIG_INVALID/);
});

test("Staged rollout can still write v1 before all readers support v2", () => {
  configure(); process.env.OTP_PAYLOAD_WRITE_VERSION = "v1";
  const id = randomUUID(), payload = { synthetic: "rolling upgrade" }, old = encryptOtpPayload(payload, id);
  assert.match(old, /^v1:/); assert.equal(activeOtpEncryptionKeyId(), "legacy-v1");
  process.env.OTP_PAYLOAD_WRITE_VERSION = "v2";
  assert.deepEqual(decryptOtpPayload(old, id), payload); assert.match(encryptOtpPayload(payload, id), /^v2:key-a:/);
});

test("Bootstrap uses a separate derived key and remains readable across the existing previous-pepper transition", () => {
  const id = randomUUID(), payload = { synthetic: true }, encrypted = encryptOtpPayload(payload, id);
  assert.match(encrypted, /^v2:join-pepper:/);
  process.env.JOIN_CODE_PEPPER_PREVIOUS = pepper; process.env.JOIN_CODE_PEPPER = "synthetic-next-pepper-0123456789abcdef";
  assert.deepEqual(decryptOtpPayload(encrypted, id), payload);
});

test("Legacy/bootstrap writers never silently fall back to the previous pepper", () => {
  process.env.JOIN_CODE_PEPPER_PREVIOUS = pepper; delete process.env.JOIN_CODE_PEPPER;
  assert.throws(() => encryptOtpPayload({}, randomUUID()), /OTP_PAYLOAD_KEY_UNAVAILABLE/);
  process.env.OTP_PAYLOAD_WRITE_VERSION = "v1";
  assert.throws(() => encryptOtpPayload({}, randomUUID()), /OTP_PAYLOAD_KEY_UNAVAILABLE/);
});
