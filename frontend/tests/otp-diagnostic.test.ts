import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adaptiveProxy } from "../src/lib/adaptive-proxy";

const secret = "SECRET_COOKIE_TOKEN", email = "person@example.test", otp = "654321";
function fixture(t: TestContext) {
  const saved = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  Object.assign(process.env, { NODE_ENV: "test", API_INTERNAL_URL: "https://backend.example.test", SKILLQUEST_NETWORK_SOURCE: "edge" });
  delete process.env.SKILLQUEST_PROXY_HMAC_KEY; delete process.env.SKILLQUEST_PROXY_MODE;
  const logs: any[] = [];
  t.mock.method(console, "info", (line: string) => {
    for (const sensitive of [secret, email, otp, "backend.example.test"]) assert.ok(!line.includes(sensitive));
    logs.push(JSON.parse(line));
  });
  return logs;
}
const request = () => new NextRequest("https://frontend.example.test/api/adaptive/start", {
  method: "POST", headers: { "content-type": "application/json", cookie: `sq_interview=${secret}`, "x-skillquest-request-id": "untrusted" },
  body: JSON.stringify({ fullName: "Fixture", email, verificationCode: otp }),
});

test("frontend start 409 retains body and forwards only a fresh opaque diagnostic request ID", async t => {
  const logs = fixture(t);
  const body = { code: "EMAIL_VERIFICATION_REQUIRED", verificationStatus: "PENDING", challengeId: "fixture" };
  let requestId = "";
  t.mock.method(globalThis, "fetch", async (_url: any, init?: RequestInit) => {
    requestId = new Headers(init?.headers).get("x-skillquest-request-id")!;
    assert.match(requestId, /^[a-f0-9-]{36}$/);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return Response.json(body, { status: 409, headers: { "retry-after": "60" } });
  });
  const response = await adaptiveProxy(request(), "start", { start: true });
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), body);
  assert.equal(response.headers.get("retry-after"), "60"); assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(logs.map(row => [row.event, row.status, row.requestId]), [["START_RECEIVED", "started", requestId], ["START_RESULT", "waiting", requestId]]);
});

test("successful start keeps existing token cookie behavior without logging its value", async t => {
  const logs = fixture(t), interview = { id: "fixture", state: "ready" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ token: secret, interview }, { status: 201 }));
  const response = await adaptiveProxy(request(), "start", { start: true });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), interview);
  assert.equal(response.cookies.get("sq_interview")?.value, secret);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
  assert.equal(logs.at(-1).status, "ok");
});

test("transport error is logged without URL, payload, cookie or raw exception", async t => {
  const logs = fixture(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error(`${secret} ${email} ${otp}`); });
  const response = await adaptiveProxy(request(), "start", { start: true });
  assert.equal(response.status, 503); assert.equal(logs.at(-1).status, "failed");
});

test("non-start proxy traffic keeps its existing headers and emits no new start diagnostics", async t => {
  const logs = fixture(t);
  t.mock.method(globalThis, "fetch", async (_url: any, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("x-skillquest-request-id"), null);
    return Response.json({ configured: true });
  });
  const response = await adaptiveProxy(new NextRequest("https://frontend.example.test/api/adaptive/config"), "config");
  assert.equal(response.status, 200); assert.equal(logs.length, 0);
});

test("log sink failures do not change a 409 verification response", async t => {
  fixture(t);
  t.mock.method(console, "info", () => { throw new Error("sink failed"); });
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 409 }));
  const response = await adaptiveProxy(request(), "start", { start: true });
  assert.equal(response.status, 409);
});
