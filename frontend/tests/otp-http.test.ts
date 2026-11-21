import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/adaptive/start/route";
 
Object.assign(process.env, { NODE_ENV: "test" });

test("Start allows twenty seconds for bounded outbox publication and preserves asynchronous verification metadata", async t => {
  const old = process.env.API_INTERNAL_URL; process.env.API_INTERNAL_URL = "http://isolated-api.test";
  t.after(() => { if (old === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = old; });
  let deadline = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { deadline = ms; return new AbortController().signal; });
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ code: "RETAKE_VERIFICATION_REQUIRED", deliveryStatus: "PENDING", error: "Synthetic" }, { status: 409, headers: { "Retry-After": "60" } }));
  const response = await POST(new NextRequest("http://localhost/api/adaptive/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ synthetic: true }) }));
  assert.equal(deadline, 20000); assert.equal(response.status, 409); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal((await response.json()).deliveryStatus, "PENDING"); assert.equal(fetch.mock.callCount(), 1);
  assert.equal(response.cookies.get("sq_interview"), undefined);
});

test("HTTP timeout returns the existing retry response without creating participant access", async t => {
  const old = process.env.API_INTERNAL_URL; process.env.API_INTERNAL_URL = "http://isolated-api.test";
  t.after(() => { if (old === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = old; });
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Synthetic timeout", "TimeoutError"); });
  const response = await POST(new NextRequest("http://localhost/api/adaptive/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 503); assert.equal(response.cookies.get("sq_interview"), undefined);
});
