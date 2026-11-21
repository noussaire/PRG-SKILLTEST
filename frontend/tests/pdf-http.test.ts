import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as student } from "../src/app/api/adaptive/me/report/route";
import { GET as admin } from "../src/app/api/admin/adaptive/[...path]/route";

for (const role of ["student", "admin"] as const) test(`${role} PDF proxy preserves temporary reason and Retry-After without retrying HTTP`, async t => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, { NODE_ENV: "test", API_INTERNAL_URL: "http://isolated-api.test", SKILLQUEST_NETWORK_SOURCE: "edge", SKILLQUEST_PROXY_MODE: "local" });
  delete process.env.SKILLQUEST_PROXY_HMAC_KEY;
  let deadline = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { deadline = ms; return new AbortController().signal; });
  const message = { code: "PDF_UNAVAILABLE", reason: "REPORT_PDF_WAIT_TIMEOUT", retryable: true };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(message, { status: 503, headers: { "Retry-After": "2" } }));
  const request = new NextRequest("http://localhost/api/report?lang=ar", { headers: { Cookie: `${role === "student" ? "sq_interview" : "sq_admin"}=${"a".repeat(64)}` } });
  const response = role === "student" ? await student(request) : await admin(request, { params: Promise.resolve({ path: ["participants", "11111111-1111-4111-8111-111111111111", "report.pdf"] }) });
  assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "2");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), message); assert.equal(fetch.mock.callCount(), 1); assert.equal(deadline, 65000);
});
