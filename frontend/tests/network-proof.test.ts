import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/adaptive/start/route";
import { internalNetworkProof } from "../src/lib/network-proof";
import { digest, signProof, verifyProof } from "../../shared/network-proof.mjs";
const key = Buffer.alloc(32, 17).toString("base64"), edge = Buffer.alloc(32, 31).toString("base64");
const variables = ["SKILLQUEST_PROXY_HMAC_KEY", "SKILLQUEST_EDGE_HMAC_KEY", "API_INTERNAL_URL"];
let saved: Array<string | undefined>;
beforeEach(() => { saved = variables.map(k => process.env[k]); process.env.SKILLQUEST_PROXY_HMAC_KEY = key; process.env.SKILLQUEST_EDGE_HMAC_KEY = edge; process.env.API_INTERNAL_URL = "http://isolated-api.test"; });
afterEach(() => variables.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }));

test("BFF ignores spoofed forwarding headers and emits an unknown network when no verified ingress proof exists", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    assert.equal(h.get("x-forwarded-for"), null); assert.equal(h.get("x-real-ip"), null);
    const p = verifyProof(h.get("x-skillquest-proxy-proof")!, key, "skillquest-api", "POST", "/api/v1/adaptive/start", digest(String(init?.body)), "");
    assert.equal(p.network, null); assert.equal(init?.redirect, "error");
    return Response.json({ code: "EMAIL_NETWORK_UNAVAILABLE" }, { status: 503 });
  });
  const r = await POST(new NextRequest("https://frontend.test/api/adaptive/start", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2", "x-skillquest-proxy-proof": "browser-forged" }, body: "{}" }));
  assert.equal(r.status, 503);
});
test("BFF verifies ingress signature, minimizes IPv6 and preserves nonce and original lifetime end to end", () => {
  const body = "{}", ts = Date.now() - 40000;
  const token = signProof(edge, "skillquest-bff", "POST", "/api/adaptive/start", body, "", "2001:db8:1:2::1234", undefined, ts);
  const request = new NextRequest("https://frontend.test/api/adaptive/start", { method: "POST", headers: { "x-skillquest-edge-proof": token }, body });
  const signed = internalNetworkProof(request, new URL("http://backend.test/api/v1/adaptive/start"), Buffer.from(body), body, "");
  const p = verifyProof(signed["x-skillquest-proxy-proof"], key, "skillquest-api", "POST", "/api/v1/adaptive/start", digest(body), "");
  const source = verifyProof(token, edge, "skillquest-bff", "POST", "/api/adaptive/start", digest(body), "");
  assert.equal(p.network, "2001:db8:1:2::/64"); assert.equal(p.nonce, source.nonce); assert.equal(p.ts, ts);
});
test("BFF rejects malformed, altered, expired ingress proofs without any upstream call", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Must not call upstream"); });
  for (const proof of ["forged", signProof(edge, "skillquest-bff", "POST", "/api/adaptive/start", "{}", "", "192.0.2.1", undefined, Date.now() - 61000), signProof(edge, "skillquest-bff", "POST", "/api/adaptive/start", "changed", "", "192.0.2.1")]) {
    const r = await POST(new NextRequest("https://frontend.test/api/adaptive/start", { method: "POST", headers: { "x-skillquest-edge-proof": proof, "content-type": "application/json" }, body: "{}" }));
    assert.equal(r.status, 503);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("BFF production never falls back to an unsigned request if its internal key is missing", async t => {
  const runtime = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" }); delete process.env.SKILLQUEST_PROXY_HMAC_KEY;
  t.after(() => { if (runtime === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: runtime }); });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Must not forward unsigned"); });
  const r = await POST(new NextRequest("https://frontend.test/api/adaptive/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(r.status, 503); assert.equal(fetch.mock.callCount(), 0);
});

test("Proof generation preserves existing JSON, compression and measured body-size protections", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Must reject before upstream"); });
  const cases: Array<{ body: string; headers: Record<string, string>; status: number }> = [
    { body: "{", headers: { "content-type": "application/json" }, status: 400 },
    { body: "{}", headers: { "content-type": "application/json", "content-encoding": "gzip" }, status: 415 },
    { body: "a".repeat(2 * 1024 * 1024 + 1), headers: { "content-type": "application/json" }, status: 413 },
  ];
  for (const c of cases) {
    const r = await POST(new NextRequest("https://frontend.test/api/adaptive/start", { method: "POST", headers: c.headers, body: c.body }));
    assert.equal(r.status, c.status);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
