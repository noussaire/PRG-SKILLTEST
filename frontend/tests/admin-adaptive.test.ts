import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, DELETE, POST } from "../src/app/api/admin/adaptive/[...path]/route";
import { middleware } from "../src/middleware";

let api: string | undefined;
beforeEach(() => { api = process.env.API_INTERNAL_URL; process.env.API_INTERNAL_URL = "http://isolated-api.test"; });
afterEach(() => { if (api === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = api; });

test("Adaptive admin BFF requires an administrator cookie and allowlists read endpoints", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected request"); });
  assert.equal((await GET(new NextRequest("http://localhost/api/admin/adaptive/dashboard"), { params: Promise.resolve({ path: ["dashboard"] }) })).status, 401);
  assert.equal((await GET(new NextRequest("http://localhost/api/admin/adaptive/auth/login", { headers: { cookie: `sq_admin=${"a".repeat(64)}` } }), { params: Promise.resolve({ path: ["auth", "login"] }) })).status, 404);
  assert.equal(provider.mock.callCount(), 0);
});

test("Admin BFF forwards language and safe filters with private uncached authentication", async t => {
  t.mock.method(globalThis, "fetch", async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.pathname, "/api/v1/admin/adaptive/participants");
    assert.equal(url.searchParams.get("lang"), "ar"); assert.equal(url.searchParams.get("search"), "Amine & Salma");
    assert.equal(url.searchParams.get("secret"), null);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"b".repeat(64)}`); assert.equal(init?.cache, "no-store");
    return Response.json({ participants: [], pagination: { total: 0 } });
  });
  const response = await GET(new NextRequest("http://localhost/api/admin/adaptive/participants?lang=ar&search=Amine%20%26%20Salma&secret=ignored", { headers: { cookie: `sq_admin=${"b".repeat(64)}` } }), { params: Promise.resolve({ path: ["participants"] }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("set-cookie"), null);
});

test("Delete proxy requires authentication and allows exactly one participant UUID", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected request"); });
  const id = "11111111-1111-4111-a111-111111111111";
  assert.equal((await DELETE(new NextRequest(`http://localhost/api/admin/adaptive/participants/${id}`, { method: "DELETE" }), { params: Promise.resolve({ path: ["participants", id] }) })).status, 401);
  for (const path of [["participants"], ["dashboard", id], ["participants", "invalid"], ["participants", id, "all"]]) {
    assert.equal((await DELETE(new NextRequest("http://localhost/api/admin/adaptive/test", { method: "DELETE", headers: { cookie: `sq_admin=${"a".repeat(64)}` } }), { params: Promise.resolve({ path }) })).status, 404);
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("Delete proxy forwards the private admin token and preserves failure responses", async t => {
  const id = "11111111-1111-4111-a111-111111111111";
  t.mock.method(globalThis, "fetch", async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(target), `http://isolated-api.test/api/v1/admin/adaptive/participants/${id}`);
    assert.equal(init?.method, "DELETE"); assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    return Response.json({ error: "Absent" }, { status: 404 });
  });
  const result = await DELETE(new NextRequest(`http://localhost/api/admin/adaptive/participants/${id}`, { method: "DELETE", headers: { cookie: `sq_admin=${"a".repeat(64)}` } }), { params: Promise.resolve({ path: ["participants", id] }) });
  assert.equal(result.status, 404); assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("POST admin summary requires admin cookie and validates path strictly", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected request"); });
  const id = "11111111-1111-4111-a111-111111111111";
  // Without cookie -> 401
  assert.equal((await POST(new NextRequest(`http://localhost/api/admin/adaptive/participants/${id}/summary`, { method: "POST" }), { params: Promise.resolve({ path: ["participants", id, "summary"] }) })).status, 401);
  // Invalid paths -> 404
  for (const path of [["participants"], ["participants", id], ["participants", id, "invalid"], ["participants", "not-a-uuid", "summary"], ["dashboard", id, "summary"]]) {
    assert.equal((await POST(new NextRequest("http://localhost/api/admin/adaptive/test", { method: "POST", headers: { cookie: `sq_admin=${"a".repeat(64)}` } }), { params: Promise.resolve({ path }) })).status, 404);
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("POST admin summary forwards admin token, language and Retry-After header", async t => {
  const id = "11111111-1111-4111-a111-111111111111";
  t.mock.method(globalThis, "fetch", async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.pathname, `/api/v1/admin/adaptive/participants/${id}/summary`);
    assert.equal(url.searchParams.get("lang"), "ar");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, "{}");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"a".repeat(64)}`);
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    return new Response(JSON.stringify({ participant: { id, aiStatus: "COMPLETE" } }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Retry-After": "45" },
    });
  });
  const res = await POST(new NextRequest(`http://localhost/api/admin/adaptive/participants/${id}/summary?lang=ar`, {
    method: "POST",
    headers: { cookie: `sq_admin=${"a".repeat(64)}` },
  }), { params: Promise.resolve({ path: ["participants", id, "summary"] }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("retry-after"), "45");
  const data = await res.json();
  assert.equal(data.participant.aiStatus, "COMPLETE");
});

test("Middleware CSRF protection verifies origin, cross-site header and content-type for admin summary POST", () => {
  const id = "11111111-1111-4111-a111-111111111111";
  const url = `http://localhost/api/admin/adaptive/participants/${id}/summary`;

  // 1. Cross-site request is rejected with 403
  const crossSiteReq = new NextRequest(url, {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site", origin: "http://localhost", "content-type": "application/json" },
  });
  assert.equal(middleware(crossSiteReq).status, 403);

  // 2. Foreign origin is rejected with 403
  const foreignOriginReq = new NextRequest(url, {
    method: "POST",
    headers: { origin: "https://malicious-site.test", "content-type": "application/json" },
  });
  assert.equal(middleware(foreignOriginReq).status, 403);

  // 3. Non-json content-type is rejected with 415
  const nonJsonReq = new NextRequest(url, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "text/plain" },
  });
  assert.equal(middleware(nonJsonReq).status, 415);

  // 4. Valid same-origin request passes through
  const validReq = new NextRequest(url, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
  });
  const res = middleware(validReq);
  assert.equal(res.status, 200);
});
