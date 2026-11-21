import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, DELETE } from "../src/app/api/adaptive/me/route";
import { POST as answer } from "../src/app/api/adaptive/answer/route";
import { POST as choices } from "../src/app/api/adaptive/choices/route";
import { POST as summary } from "../src/app/api/adaptive/me/summary/route";
import { POST as withdraw } from "../src/app/api/adaptive/me/report-email/withdraw/route";

Object.assign(process.env, { NODE_ENV: "test" });

test("Report email withdrawal requires the private cookie and forwards one authenticated POST", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++; assert.equal(url, "http://isolated-api.test/api/v1/adaptive/me/report-email/withdraw");
    assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    return Response.json({ reportEmailRequested: false });
  });
  const url = "http://localhost:3000/api/adaptive/me/report-email/withdraw";
  assert.equal((await withdraw(new NextRequest(url, { method: "POST", body: "{}" }))).status, 401); assert.equal(calls, 0);
  const response = await withdraw(new NextRequest(url, { method: "POST", headers: { cookie: `sq_interview=${"a".repeat(64)}`, "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.deepEqual(await response.json(), { reportEmailRequested: false });
});

test("Summary generation requires the private session and forwards one explicit POST", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++;
    assert.equal(url, "http://isolated-api.test/api/v1/adaptive/me/summary?lang=ar");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    return Response.json({ report: { aiStatus: "COMPLETE" } });
  });
  const url = "http://localhost:3000/api/adaptive/me/summary?lang=ar";
  assert.equal((await summary(new NextRequest(url, { method: "POST", body: "{}" }))).status, 401);
  assert.equal(calls, 0);
  const response = await summary(new NextRequest(url, { method: "POST", headers: { cookie: `sq_interview=${"a".repeat(64)}`, "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
});

let previousApi: string | undefined;
beforeEach(() => { previousApi = process.env.API_INTERNAL_URL; process.env.API_INTERNAL_URL = "http://isolated-api.test"; });
afterEach(() => { if (previousApi === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = previousApi; });

test("A first visit has no saved interview and makes no protected API request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
  const response = await GET(new NextRequest("http://localhost:3000/api/adaptive/me"));
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(fetch.mock.callCount(), 0);
});

test("A saved session is restored using its private cookie", async t => {
  const saved = { id: "saved-interview", answeredCount: 1, currentQuestion: { id: "question-2" } };
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "http://isolated-api.test/api/v1/adaptive/me");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    return Response.json(saved);
  });
  const response = await GET(new NextRequest("http://localhost:3000/api/adaptive/me", { headers: { cookie: `sq_interview=${"a".repeat(64)}` } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), saved);
});

test("The selected display language reaches the backend without changing the private session", async t => {
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "http://isolated-api.test/api/v1/adaptive/me?lang=ar");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    return Response.json({ language: "ar", answeredCount: 9 });
  });
  const response = await GET(new NextRequest("http://localhost:3000/api/adaptive/me?lang=ar", { headers: { cookie: `sq_interview=${"a".repeat(64)}` } }));
  assert.equal((await response.json()).language, "ar");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("Expired sessions clear browser access without offering participant deletion", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Entretien expiré", code: "UNAUTHORIZED" }, { status: 401 }));
  const response = await GET(new NextRequest("http://localhost:3000/api/adaptive/me", { headers: { cookie: `sq_interview=${"b".repeat(64)}` } }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).canDelete, undefined);
  assert.ok(response.headers.get("set-cookie")?.includes("sq_interview="));
});

test("Answers require authentication and participant deletion is always forbidden", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
  const answerResponse = await answer(new NextRequest("http://localhost:3000/api/adaptive/answer", { method: "POST" }));
  const deleteResponse = await DELETE();
  assert.equal(answerResponse.status, 401);
  assert.equal(deleteResponse.status, 403);
  assert.equal((await choices(new NextRequest("http://localhost:3000/api/adaptive/choices", { method: "POST" }))).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Quota wait metadata and Retry-After are forwarded while keeping the private session", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Limite par minute", retryAfterSeconds: 7, quotaScope: "minute" }, { status: 429, headers: { "Retry-After": "7" } }));
  const response = await answer(new NextRequest("http://localhost:3000/api/adaptive/answer", { method: "POST", headers: { cookie: `sq_interview=${"a".repeat(64)}`, "Content-Type": "application/json" }, body: JSON.stringify({ questionId: "question", choiceId: "choice" }) }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal((await response.json()).retryAfterSeconds, 7);
  assert.equal(response.headers.get("set-cookie"), null);
});
