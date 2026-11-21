import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/security/passwords.js";

test("hashPassword generates valid scrypt format without env dependencies", async () => {
  const pwd = "TestStrongPassword123!";
  const hash = await hashPassword(pwd);

  assert.ok(hash.startsWith("scrypt:"), "Hash must use scrypt prefix");
  const parts = hash.split(":");
  assert.equal(parts.length, 3, "Hash must have algorithm:salt:digest format");
  assert.equal(parts[0], "scrypt");
  assert.equal(parts[1].length, 32, "Salt must be 16 bytes hex (32 chars)");
  assert.equal(parts[2].length, 128, "Digest must be 64 bytes hex (128 chars)");

  const isValid = await verifyPassword(pwd, hash);
  assert.equal(isValid, true, "verifyPassword must succeed with correct password");

  const isInvalid = await verifyPassword("WrongPassword123!", hash);
  assert.equal(isInvalid, false, "verifyPassword must fail with wrong password");

  const malformed = await verifyPassword(pwd, "invalid:hash:format");
  assert.equal(malformed, false, "verifyPassword must reject malformed hash safely");
});
