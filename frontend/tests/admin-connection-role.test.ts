import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/admin/connection-role/route";

const originalApi = process.env.API_INTERNAL_URL;
afterEach(() => {
  if (originalApi === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApi;
});
const request = (token?: string) => new NextRequest("https://frontend.example.test/api/admin/connection-role", {
  headers: token ? { cookie: `sq_admin=${token}` } : {},
});

test("role BFF refuses missing or malformed existing cookie without upstream request", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw new Error("NETWORK_FORBIDDEN"); });
  for (const token of [undefined, "invalid"]) assert.equal((await GET(request(token))).status, 401);
  assert.equal(calls.mock.callCount(), 0);
});

test("existing HttpOnly session is forwarded server-side; only two booleans returned", async t => {
  process.env.API_INTERNAL_URL = "https://backend.example.test";
  const token = "a".repeat(64);
  t.mock.method(globalThis, "fetch", async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(target), "https://backend.example.test/api/v1/admin/connection-role");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.equal(init?.body, undefined);
    return Response.json({ is_app: false, is_runtime: true, secret: "NEVER_RETURN" });
  });
  const response = await GET(request(token));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { is_app: false, is_runtime: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("upstream authentication denial is not relayed verbatim", async t => {
  process.env.API_INTERNAL_URL = "https://backend.example.test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ secret: "NEVER_RETURN" }, { status: 401 }));
  const response = await GET(request("b".repeat(64)));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Session administrateur requise." });
});

test("upstream failures and malformed responses expose no details", async t => {
  process.env.API_INTERNAL_URL = "https://backend.example.test";
  let body: unknown = { is_app: "true", is_runtime: false };
  let status = 200;
  t.mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
  for (const failure of [false, true]) {
    if (failure) { body = { secret: "DATABASE_URL=SECRET" }; status = 500; }
    const response = await GET(request("c".repeat(64)));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Diagnostic indisponible." });
  }
});

test("missing configuration or transport failure stays generic and never creates a session", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw new Error("postgresql://SECRET"); });
  delete process.env.API_INTERNAL_URL;
  assert.equal((await GET(request("d".repeat(64)))).status, 503);
  assert.equal(calls.mock.callCount(), 0);
  process.env.API_INTERNAL_URL = "https://backend.example.test";
  const response = await GET(request("d".repeat(64)));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Diagnostic indisponible." });
  assert.equal(response.headers.get("set-cookie"), null);
});
