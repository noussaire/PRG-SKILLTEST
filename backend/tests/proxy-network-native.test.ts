import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server.js";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { digest, networkOf, signProof } from "../../shared/network-proof.mjs";
import { EmailBudget } from "../src/services/email-budget.service.js";
let purgeProxyNonces: typeof import("../src/services/proxy-nonce-retention.service.js").purgeProxyNonces;
let OtpDeliveryQueue: typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;

const options = { skip: process.env.LOT4_NATIVE_CONTEXT ? false : "Owned native PostgreSQL required", timeout: 60000 };
const key = Buffer.alloc(32, 61).toString("base64"), edge = Buffer.alloc(32, 83).toString("base64");
let db: PrismaClient, other: PrismaClient, server: Server, base: string;
let frontStart: (request: NextRequest) => Promise<Response>;
let send: typeof import("../src/services/brevo.service.js").sendReportEmail;
let deliveries: any[];
const nativeFetch = globalThis.fetch.bind(globalThis);
const profile = (email = "proxy@example.test", language: "fr" | "ar" = "fr") => ({ fullName: "Synthetic student", email, language, consent: true, adult: true, emailReport: true });
before(async () => {
  if (options.skip) return;
  other = (await connectLot4NativeDatabase()).client;
  Object.assign(process.env, { NODE_ENV: "test", JOIN_CODE_PEPPER: "lot5-synthetic-pepper-0123456789abcdef", GROQ_API_KEY: "" });
  ({ prisma: db } = await import("../src/db/prisma.js"));
  ({ purgeProxyNonces } = await import("../src/services/proxy-nonce-retention.service.js"));
  ({ OtpDeliveryQueue } = await import("../src/services/otp-delivery.service.js"));
  const { app } = await import("../src/app.js");
  assert.equal(app.get("trust proxy"), false);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
  ({ sendReportEmail: send } = await import("../src/services/brevo.service.js"));
  const route = await import(new URL("../../frontend/src/app/api/adaptive/start/route.ts", import.meta.url).href);
  frontStart = route.POST;
});
beforeEach(async t => {
  if (options.skip) return;
  deliveries = [];
  Object.assign(process.env, { SKILLQUEST_PROXY_MODE: "required", SKILLQUEST_PROXY_HMAC_KEY: key, SKILLQUEST_EDGE_HMAC_KEY: edge,
    API_INTERNAL_URL: base, BREVO_API_KEY: "synthetic-no-network", BREVO_SENDER_EMAIL: "sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_OTHER_USAGE_MARGIN: "60", EMAIL_APP_DAILY_LIMIT: "240", OTP_IDENTITY_DAILY_SENDS: "5",
    OTP_NETWORK_DAILY_SENDS: "100", OTP_GLOBAL_DAILY_SENDS: "120", OTP_IDENTITY_DAILY_FAILURES: "15", OTP_NETWORK_DAILY_FAILURES: "150", OTP_GLOBAL_DAILY_FAILURES: "1000" });
  (t as import("node:test").TestContext).mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://api.brevo.com/v3/smtp/email") {
      deliveries.push(JSON.parse(String(init?.body)));
      return Response.json({ messageId: "synthetic-acceptance" }, { status: 201 });
    }
    if (!url.startsWith(base + "/")) throw Error("EXTERNAL_NETWORK_FORBIDDEN");
    return nativeFetch(input, init);
  });
  await db.$executeRawUnsafe(`TRUNCATE "ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async () => {
  if (options.skip) return;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await db.$disconnect(); await other.$disconnect();
});
async function api(path: string, body?: unknown, network: string | null = "192.0.2.1/32", headers: Record<string, string> = {}, custom?: string) {
  const method = body === undefined ? "GET" : "POST", raw = body === undefined ? "" : JSON.stringify(body);
  const authorization = headers.authorization ?? "";
  const proof = custom ?? signProof(key, "skillquest-api", method, path, raw, authorization, network);
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-skillquest-proxy-proof": proof, ...headers }, ...(body === undefined ? {} : { body: raw }) });
  return { status: r.status, body: await r.json() as any };
}
async function throughFrontend(p = profile(), ip = "192.0.2.1", extra: Record<string, string> = {}, token?: string) {
  const body = JSON.stringify(p);
  const proof = token ?? signProof(edge, "skillquest-bff", "POST", "/api/adaptive/start", body, "", ip);
  const response = await frontStart(new NextRequest("https://frontend.synthetic.test/api/adaptive/start", { method: "POST",
    headers: { "content-type": "application/json", "x-skillquest-edge-proof": proof, ...extra }, body }));
  return { status: response.status, body: await response.json() as any };
}
async function deliver(p = profile(), network = "192.0.2.1/32") {
  const r = await api("/api/v1/adaptive/start", p, network); assert.equal(r.status, 409);
  await new OtpDeliveryQueue(other, send).runOnce();
  const email = deliveries.find(d => d.to[0].email === p.email); assert.ok(email);
  return { challengeId: r.body.challengeId as string, code: email.htmlContent.match(/>(\d{6})<\//)![1] as string };
}

test("Native protected backend rejects direct requests and freely spoofed XFF/X-Real-IP", options, async () => {
  const attempts: Record<string, string>[] = [{}, { "x-forwarded-for": "203.0.113.1" }, { "x-real-ip": "203.0.113.2", forwarded: "for=203.0.113.3" }];
  for (const headers of attempts) {
    const r = await nativeFetch(base + "/api/v1/adaptive/start", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(profile()) });
    assert.equal(r.status, 403);
  }
  assert.equal(await db.emailOtpChallenge.count(), 0); assert.equal(deliveries.length, 0);
});

test("Native production cannot disable proof enforcement or operate without its internal key", options, async () => {
  Object.assign(process.env, { NODE_ENV: "production", SKILLQUEST_PROXY_MODE: "off" });
  delete process.env.SKILLQUEST_PROXY_HMAC_KEY;
  try {
    const r = await nativeFetch(base + "/api/v1/adaptive/config");
    assert.equal(r.status, 503); assert.equal(await db.emailOtpChallenge.count(), 0);
    Object.assign(process.env, { NODE_ENV: "development", SKILLQUEST_PROXY_MODE: "off" });
    assert.equal((await nativeFetch(base + "/api/v1/adaptive/config")).status, 503);
    process.env.SKILLQUEST_PROXY_MODE = "local";
    assert.equal((await nativeFetch(base + "/api/v1/adaptive/config")).status, 200);
  } finally { Object.assign(process.env, { NODE_ENV: "test", SKILLQUEST_PROXY_MODE: "required", SKILLQUEST_PROXY_HMAC_KEY: key }); }
});

test("Native invalid, modified, expired, future, wrong-route/body/bearer and replayed proofs fail closed", options, async () => {
  const path = "/api/v1/adaptive/start", p = profile(), raw = JSON.stringify(p);
  const valid = signProof(key, "skillquest-api", "POST", path, raw, "", "192.0.2.1/32");
  const proofs = ["forged", valid.slice(0, -1) + (valid.endsWith("a") ? "b" : "a"),
    signProof(key, "skillquest-api", "POST", path, raw, "", "192.0.2.1/32", undefined, Date.now() - 61000),
    signProof(key, "skillquest-api", "POST", path, raw, "", "192.0.2.1/32", undefined, Date.now() + 10000),
    signProof(key, "skillquest-api", "POST", "/other", raw, "", "192.0.2.1/32"),
    signProof(key, "skillquest-api", "POST", path, "changed", "", "192.0.2.1/32"),
    signProof(key, "skillquest-api", "POST", path, raw, "Bearer changed", "192.0.2.1/32")];
  for (const proof of proofs) assert.equal((await api(path, p, "192.0.2.1/32", {}, proof)).status, 403);
  assert.equal((await api(path, p, "192.0.2.1/32", {}, valid)).status, 409);
  assert.equal((await api(path, p, "192.0.2.1/32", {}, valid)).status, 403);
  assert.equal(await db.emailOtpChallenge.count(), 1);
});

test("Native replay race accepts exactly one proof across simultaneous real HTTP requests", options, async () => {
  const path = "/api/v1/adaptive/start", p = profile();
  const proof = signProof(key, "skillquest-api", "POST", path, JSON.stringify(p), "", "192.0.2.1/32");
  const results = await Promise.all(Array.from({ length: 5 }, () => api(path, p, "192.0.2.1/32", {}, proof)));
  assert.equal(results.filter(r => r.status === 409).length, 1); assert.equal(results.filter(r => r.status === 403).length, 4);
  assert.equal((await other.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "ProxyRequestNonce"`))[0].count, 1);
  assert.equal(await db.emailOtpChallenge.count(), 1);
});

test("Native browser to simulated ingress to Next.js to Express preserves verified identity and FR/AR OTP", options, async () => {
  for (const language of ["fr", "ar"] as const) {
    const p = profile(`${language}@example.test`, language);
    const issued = await throughFrontend(p, language === "fr" ? "192.0.2.1" : "2001:db8:1:2::1234", { "x-forwarded-for": "198.51.100.99", "x-real-ip": "203.0.113.99" });
    assert.equal(issued.status, 409); await new OtpDeliveryQueue(other, send).runOnce();
    const message = deliveries.find(d => d.to[0].email === p.email); assert.ok(message.htmlContent.includes(`lang="${language}"`));
    const code = message.htmlContent.match(/>(\d{6})<\//)![1];
    const good = await api("/api/v1/adaptive/start", { ...p, challengeId: issued.body.challengeId, verificationCode: code }, networkOf(language === "fr" ? "192.0.2.1" : "2001:db8:1:2::1234"));
    assert.equal(good.status, 201);
    assert.equal((await api("/api/v1/adaptive/me", undefined, null, { authorization: `Bearer ${good.body.token}` })).status, 200);
  }
  assert.equal(await db.emailBudgetReservation.count(), 2);
});

test("Native absence of a verified network cannot issue/verify OTP despite spoofed network headers", options, async () => {
  for (const language of ["fr", "ar"] as const) {
    const r = await api("/api/v1/adaptive/start", profile(`${language}@example.test`, language), null,
      { "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2" });
    assert.equal(r.status, 503); assert.equal(r.body.code, "EMAIL_NETWORK_UNAVAILABLE");
  }
  assert.equal(await db.emailOtpChallenge.count(), 0); assert.equal(await db.emailAbuseCounter.count(), 0);
  assert.equal(await db.emailBudgetReservation.count(), 0); assert.equal(deliveries.length, 0);
});

test("Native edge proof cannot be replayed through Next.js to mint a fresh backend identity", options, async () => {
  const p = profile(), body = JSON.stringify(p), token = signProof(edge, "skillquest-bff", "POST", "/api/adaptive/start", body, "", "192.0.2.1");
  assert.equal((await throughFrontend(p, "192.0.2.1", {}, token)).status, 409);
  assert.equal((await throughFrontend(p, "192.0.2.1", {}, token)).status, 403);
  assert.equal(await db.emailOtpChallenge.count(), 1);
});

test("Native one student's exhausted network allowance does not block another student behind the same NAT", options, async () => {
  process.env.OTP_NETWORK_DAILY_FAILURES = "2";
  const a = profile("a@example.test"), b = profile("b@example.test"), first = await deliver(a), second = await deliver(b);
  const wrong = first.code === "000000" ? "111111" : "000000";
  for (let n = 0; n < 2; n++) assert.equal((await api("/api/v1/adaptive/start", { ...a, challengeId: first.challengeId, verificationCode: wrong })).status, 400);
  assert.equal((await api("/api/v1/adaptive/start", { ...a, challengeId: first.challengeId, verificationCode: first.code }, "192.0.2.1/32",
    { "x-forwarded-for": "198.51.100.1", "x-real-ip": "203.0.113.1" })).status, 429);
  assert.equal((await api("/api/v1/adaptive/start", { ...b, challengeId: second.challengeId, verificationCode: second.code })).status, 201);
  assert.equal(await db.emailBudgetReservation.count(), 2);
});

test("Native changing verified mobile network cannot reset the persistent email failure limit", options, async () => {
  process.env.OTP_IDENTITY_DAILY_FAILURES = "2";
  const p = profile(), c = await deliver(p), wrong = c.code === "000000" ? "111111" : "000000";
  for (const network of ["192.0.2.1/32", "198.51.100.2/32"]) assert.equal((await api("/api/v1/adaptive/start", { ...p, challengeId: c.challengeId, verificationCode: wrong }, network)).status, 400);
  assert.equal((await api("/api/v1/adaptive/start", { ...p, challengeId: c.challengeId, verificationCode: c.code }, "203.0.113.3/32")).status, 429);
  assert.equal(await db.adaptiveInterview.count(), 0);
});

test("Native exhausting a verified network-email send cap preserves other NAT participants and the budget", options, async () => {
  process.env.OTP_NETWORK_DAILY_SENDS = "1";
  const a = profile("send-a@example.test"), b = profile("send-b@example.test");
  await deliver(a);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "nextIssueAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
  await db.$executeRawUnsafe(`UPDATE "EmailOtpThrottle" SET "nextSendAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
  const retry = await api("/api/v1/adaptive/start", { ...a, requestNewCode: true }); assert.equal(retry.status, 409);
  await new OtpDeliveryQueue(other, send).runOnce();
  assert.equal(deliveries.length, 1);
  const blocked = await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { challengeId: retry.body.challengeId } });
  assert.equal(blocked.lastErrorCode, "EMAIL_LOCAL_LIMIT");
  const c = await deliver(b);
  assert.equal((await api("/api/v1/adaptive/start", { ...b, challengeId: c.challengeId, verificationCode: c.code })).status, 201);
  assert.equal(deliveries.length, 2); assert.equal(await db.emailBudgetReservation.count(), 2);
  assert.equal((await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS'`))[0].count, 2);
});

test("Native two verified networks compete atomically for the last Brevo unit", options, async () => {
  process.env.EMAIL_APP_DAILY_LIMIT = "1";
  const [a, b] = await Promise.all([api("/api/v1/adaptive/start", profile("a@example.test"), "192.0.2.1/32"), api("/api/v1/adaptive/start", profile("b@example.test"), "198.51.100.2/32")]);
  assert.equal(a.status, 409); assert.equal(b.status, 409);
  await Promise.all([new OtpDeliveryQueue(db, send).runOnce(), new OtpDeliveryQueue(other, send).runOnce()]);
  await new OtpDeliveryQueue(other, send).runOnce();
  assert.equal(deliveries.length, 1); assert.equal(await db.emailBudgetReservation.count(), 1);
  assert.equal((await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS'`))[0].count, 1);
});

test("Native nonce cleanup preserves live replay barriers and never revives an expired proof", options, async () => {
  const nonce = randomUUID();
  const expired = signProof(key, "skillquest-api", "GET", "/api/v1/adaptive/config", "", "", "192.0.2.1/32", nonce, Date.now() - 120000);
  await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") VALUES ($1::uuid,(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'),($2::uuid,(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 minute')`, nonce, randomUUID());
  assert.equal(await purgeProxyNonces(), 1);
  assert.equal((await api("/api/v1/adaptive/config", undefined, "192.0.2.1/32", {}, expired)).status, 403);
  assert.equal((await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "ProxyRequestNonce"`))[0].count, 1);
});

test("Native replay-store SQL failure returns 500 without bypassing identity checks or creating an OTP", options, async () => {
  await db.$executeRawUnsafe(`CREATE FUNCTION lot5_fail_nonce() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic nonce failure'; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER lot5_fail_nonce BEFORE INSERT ON "ProxyRequestNonce" FOR EACH ROW EXECUTE FUNCTION lot5_fail_nonce()`);
    assert.equal((await api("/api/v1/adaptive/start", profile())).status, 500);
    assert.equal(await db.emailOtpChallenge.count(), 0); assert.equal(await db.emailBudgetReservation.count(), 0);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot5_fail_nonce ON "ProxyRequestNonce"`);
    await db.$executeRawUnsafe(`DROP FUNCTION lot5_fail_nonce()`);
  }
});
