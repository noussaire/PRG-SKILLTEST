import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationCopy, parseEmailVerification, normalizeOtpDigits } from "../src/lib/email-verification";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/adaptive/email-verification/route";
 
Object.assign(process.env, { NODE_ENV: "test" });

test("Every verification state has clear French and Arabic feedback", () => {
  for (const status of ["PENDING", "SENT", "UNCERTAIN", "UNAVAILABLE", "INVALID", "EXPIRED", "VERIFIED", "LIMIT_REACHED"] as const) {
    assert.ok(verificationCopy(status, "fr").length > 10);
    assert.match(verificationCopy(status, "ar"), /[\u0600-\u06ff]/);
    assert.equal(parseEmailVerification({ verificationStatus: status })?.verificationStatus, status);
  }
  assert.equal(parseEmailVerification({ verificationStatus: "unknown" }), null);
});
test("OTP input permits paste and French or Arabic numeral keyboards", () => {
  assert.equal(normalizeOtpDigits("123456"), "123456");
  assert.equal(normalizeOtpDigits("١٢٣٤٥٦"), "123456");
  assert.equal(normalizeOtpDigits("۱۲۳۴۵۶"), "123456");
  assert.equal(normalizeOtpDigits(" 12 34 56 "), "123456");
});
test("Malformed challenge IDs never reach the verification backend", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected network"); });
  const r = await GET(new NextRequest("http://localhost/api/adaptive/email-verification?challenge=../../admin"));
  assert.equal(r.status, 400); assert.equal(fetch.mock.callCount(), 0);
});
test("Verification status proxy preserves state and sends no participant or administrator token", async t => {
  const old = process.env.API_INTERNAL_URL; process.env.API_INTERNAL_URL = "http://isolated-api.test";
  t.after(() => { if (old === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = old; });
  const id = "11111111-1111-4111-8111-111111111111";
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(input), `http://isolated-api.test/api/v1/adaptive/email-verification/${id}`);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return Response.json({ verificationStatus: "SENT", challengeId: id });
  });
  const r = await GET(new NextRequest(`http://localhost/api/adaptive/email-verification?challenge=${id}`));
  assert.equal((await r.json()).verificationStatus, "SENT"); assert.equal(r.cookies.get("sq_interview"), undefined);
});
