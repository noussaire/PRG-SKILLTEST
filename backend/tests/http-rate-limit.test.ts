import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type Request } from "express";
import { once } from "node:events";
import type { Options } from "express-rate-limit";
import { rateLimit, RequestDrivenMemoryStore, socketRateLimitKey } from "../src/security/http-rate-limit.js";

test("HTTP store expires per-key windows on request without clearing another active protection", async t => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const store = new RequestDrivenMemoryStore(); store.init({ windowMs: 100 } as Options);
  assert.equal((await store.increment("a")).totalHits, 1);
  now = 1050; assert.equal((await store.increment("b")).totalHits, 1);
  now = 1100; assert.equal((await store.increment("a")).totalHits, 1);
  assert.equal((await store.increment("b")).totalHits, 2);
  assert.equal((await store.get("a"))?.resetTime?.getTime(), 1200);
  assert.equal((await store.get("b"))?.resetTime?.getTime(), 1150);
});
test("HTTP store retains all simultaneous increments and isolates identities and instances", async () => {
  const a = new RequestDrivenMemoryStore(), b = new RequestDrivenMemoryStore();
  await Promise.all(Array.from({ length: 50 }, () => a.increment("student")));
  assert.equal((await a.get("student"))?.totalHits, 50);
  assert.equal((await a.increment("other" )).totalHits, 1);
  assert.equal(await b.get("student"), undefined);
});
test("HTTP store decrement/reset operations preserve independent counters", async () => {
  const s = new RequestDrivenMemoryStore(); await s.increment("a"); await s.increment("b");
  await s.decrement("a"); await s.decrement("a"); assert.equal((await s.get("a"))?.totalHits, 0);
  await s.resetKey("a"); assert.equal(await s.get("a"), undefined); assert.equal((await s.get("b"))?.totalHits, 1);
  await s.resetAll(); assert.equal(await s.get("b"), undefined);
});

const peerRequest = (remoteAddress?: string) => ({ socket: { remoteAddress } }) as Request;

test("Socket keys normalize IPv6 subnets and mapped IPv4, and share missing-peer protection", () => {
  const key = (peer?: string) => socketRateLimitKey(peerRequest(peer));
  assert.equal(key("192.0.2.7"), "192.0.2.7");
  assert.equal(key("::ffff:192.0.2.7"), key("192.0.2.7"));
  assert.equal(key("::ffff:c000:207"), key("192.0.2.7"));
  assert.equal(key("2001:db8:1234:5601::1"), "2001:db8:1234:5600::/56");
  assert.equal(key("2001:0db8:1234:56ff:ffff::2"), key("2001:db8:1234:5601::1"));
  assert.notEqual(key("2001:db8:1234:5700::1"), key("2001:db8:1234:5601::1"));
  assert.equal(key(), "unknown-socket");
});

test("Forged forwarding headers cannot reset the socket HTTP limit or emit proxy validation errors", async t => {
  const errors = t.mock.method(console, "error", () => {});
  const app = express();
  app.set("trust proxy", false);
  app.use(rateLimit({ windowMs: 60000, limit: 2, keyGenerator: socketRateLimitKey }));
  app.get("/", (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  for (let n = 0; n < 6; n++) {
    const response = await fetch(url, { headers: {
      "x-forwarded-for": `${n % 2 ? "2001:db8::" : "198.51.100."}${n + 1}, 192.0.2.99`,
      "x-real-ip": `203.0.113.${n + 1}`,
      "x-vercel-forwarded-for": `192.0.2.${n + 1}`,
      "cf-connecting-ip": `198.51.100.${n + 1}`,
      forwarded: `for="[2001:db8::${n + 1}]"`,
      "x-skillquest-proxy-proof": `forged-${n}`,
    } });
    await response.text();
    assert.equal(response.status, n < 2 ? 200 : 429);
  }
  assert.equal(app.get("trust proxy"), false);
  assert.deepEqual(errors.mock.calls.map(call => call.arguments), []);
});

test("Real application global limiter uses the socket bucket before unchanged HMAC verification", async t => {
  const errors = t.mock.method(console, "error", () => {});
  let globalStore: RequestDrivenMemoryStore | undefined;
  const init = RequestDrivenMemoryStore.prototype.init;
  t.mock.method(RequestDrivenMemoryStore.prototype, "init", function (this: RequestDrivenMemoryStore, options: Options) {
    init.call(this, options);
    if (options.windowMs === 15 * 60 * 1000) globalStore = this;
  });
  // No user environment or database: malformed proofs fail before nonce storage.
  const variables = ["NODE_ENV", "SKILLQUEST_PROXY_MODE", "SKILLQUEST_PROXY_HMAC_KEY"];
  const saved = variables.map(name => process.env[name]);
  t.after(() => variables.forEach((name, index) => {
    if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
  }));
  Object.assign(process.env, { NODE_ENV: "test", SKILLQUEST_PROXY_MODE: "required",
    SKILLQUEST_PROXY_HMAC_KEY: Buffer.alloc(32, 91).toString("base64") });
  const { app } = await import("../src/app.js");
  assert.equal(app.get("trust proxy"), false);
  assert.ok(globalStore);
  const bucket = socketRateLimitKey(peerRequest("127.0.0.1"));
  for (let n = 0; n < 49999; n++) await globalStore.increment(bucket);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/adaptive/me`;
  const first = await fetch(url, { headers: { "x-forwarded-for": "192.0.2.1", "x-skillquest-proxy-proof": "forged" } });
  assert.equal(first.status, 403);
  assert.equal((await first.json() as { code: string }).code, "PROXY_PROOF_INVALID");
  const second = await fetch(url, { headers: { "x-forwarded-for": "2001:db8::1", "x-vercel-forwarded-for": "203.0.113.7" } });
  await second.text();
  assert.equal(second.status, 429);
  // The offline preload may log blocked Prisma .env reads at import time.
  // No rate-limit validation diagnostic is acceptable.
  assert.deepEqual(errors.mock.calls.filter(call =>
    call.arguments.some(value => String(value).includes("ERR_ERL_"))), []);
});
