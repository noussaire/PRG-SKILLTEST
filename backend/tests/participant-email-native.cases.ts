import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { decryptOtpPayload } from "../src/security/otp-payload.js";

const enabled = !!process.env.LOT4_NATIVE_CONTEXT;
const options = { skip: enabled ? false : "Native PostgreSQL only: run output/lot4-946647792edf/run-native.cjs", timeout: 60000 };
let prisma: PrismaClient, verifier: PrismaClient, server: Server, base: string;
let processOtp: () => Promise<void>;
let mode: "accept" | "lost" | "rate" | "quota" = "accept";
let deliveries: Array<{ to: Array<{ email: string }>; htmlContent: string; headers: { IdempotencyKey: string } }> = [];
const mailbox = new Map<string, string>();
const realFetch = globalThis.fetch.bind(globalThis);
const profile = (email = "synthetic@example.test", language: "fr" | "ar" = "fr") => ({ fullName: "Synthetic student", email, language, consent: true, adult: true, emailReport: true });
async function api(path: string, method = "GET", body?: unknown, token?: string) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() as any, retry: r.headers.get("retry-after") };
}
async function issue(p = profile()) { return api("/adaptive/start", "POST", p); }
async function deliver(p = profile()) {
  const queued = await issue(p); assert.equal(queued.status, 409); assert.equal(queued.body.code, "EMAIL_VERIFICATION_REQUIRED");
  await processOtp(); const code = mailbox.get(p.email.trim().toLowerCase()); assert.ok(code);
  return { ...queued, code: code!, challengeId: queued.body.challengeId as string };
}
async function verified(p = profile()) {
  const challenge = await deliver(p);
  return api("/adaptive/start", "POST", { ...p, verificationCode: challenge.code, challengeId: challenge.challengeId });
}
async function resendClock() {
  await prisma.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "nextIssueAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
  await prisma.$executeRawUnsafe(`UPDATE "EmailOtpThrottle" SET "nextSendAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
}
before(async () => {
  if (!enabled) return;
  const isolated = await connectLot4NativeDatabase(); verifier = isolated.client;
  process.env.NODE_ENV = "test"; process.env.JOIN_CODE_PEPPER = "lot4-synthetic-only-pepper-0123456789abcdef";
  process.env.GROQ_API_KEY = "";
  ({ prisma } = await import("../src/db/prisma.js"));
  const { app } = await import("../src/app.js");
  ({ processOtpDeliveries: processOtp } = await import("../src/services/otp-delivery.service.js"));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const addr = server.address(); assert.ok(addr && typeof addr !== "string"); base = `http://127.0.0.1:${addr.port}/api/v1`;
}, { timeout: 60000 });
beforeEach(async t => {
  if (!enabled) return;
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1"; // explicit HTTP contract under mocked fetch
  mode = "accept"; deliveries = []; mailbox.clear();
  Object.assign(process.env, { BREVO_API_KEY: "lot4-simulated-no-network", BREVO_SENDER_EMAIL: "sender@example.test", EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_OTHER_USAGE_MARGIN: "60", EMAIL_APP_DAILY_LIMIT: "240", OTP_IDENTITY_DAILY_SENDS: "5", OTP_NETWORK_DAILY_SENDS: "100", OTP_GLOBAL_DAILY_SENDS: "120", OTP_IDENTITY_DAILY_FAILURES: "15", OTP_NETWORK_DAILY_FAILURES: "150", OTP_GLOBAL_DAILY_FAILURES: "1000" });
  (t as import("node:test").TestContext).mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://api.brevo.com/v3/smtp/email") {
      const payload = JSON.parse(String(init?.body)); deliveries.push(payload);
      const match = payload.htmlContent.match(/>(\d{6})<\//); if (match) mailbox.set(payload.to[0].email, match[1]);
      if (mode === "lost") throw new Error("SIMULATED_RESPONSE_LOST");
      if (mode === "rate") return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
      if (mode === "quota") return Response.json({ code: "not_enough_credits" }, { status: 402 });
      return Response.json({ messageId: "synthetic-provider-acceptance" }, { status: 201 });
    }
    if (!url.startsWith("http://127.0.0.1:")) throw Error("EXTERNAL_NETWORK_FORBIDDEN");
    return realFetch(input, init);
  });
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async () => {
  if (!enabled) return;
  server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r()));
  await prisma?.$disconnect(); await verifier?.$disconnect();
});

test("Initial request issues only a temporary challenge, never a participant or token", options, async () => {
  const r = await issue(); assert.equal(r.status, 409); assert.equal(r.body.verificationStatus, "PENDING");
  assert.ok(r.body.challengeId); assert.equal(r.body.token, undefined); assert.equal(r.body.interview, undefined);
  assert.equal(await prisma.adaptiveInterview.count(), 0); assert.equal(deliveries.length, 0);
  assert.equal((await api("/adaptive/me")).status, 401);
  const c = await prisma.emailOtpChallenge.findUniqueOrThrow({ where: { id: r.body.challengeId } });
  assert.equal(c.expiresAt.getTime() - c.createdAt.getTime(), 600000); assert.equal(c.maxAttempts, 5);
});

test("Valid initial OTP creates exactly one participant and starts the 30-day clock at validation", options, async () => {
  const p = profile(), c = await deliver(p);
  assert.equal((await api(`/adaptive/email-verification/${c.challengeId}`)).body.verificationStatus, "SENT");
  const before = (await prisma.$queryRawUnsafe<{ now: Date }[]>(`SELECT clock_timestamp() AS now`))[0].now;
  const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
  assert.equal(r.status, 201); assert.match(r.body.token, /^[a-f0-9]{64}$/); assert.equal(r.body.interview.emailVerified, true);
  const row = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: r.body.interview.id } });
  assert.ok(row.emailVerifiedAt); assert.ok(row.lastTestStartedAt >= before); assert.equal(await prisma.adaptiveInterview.count(), 1);
  assert.equal((await prisma.emailOtpChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt !== null, true);
  assert.equal((await api("/adaptive/me", "GET", undefined, r.body.token)).status, 200);
  assert.equal("email" in r.body.interview, false);
});

test("Wrong, expired and replayed codes never grant a new access token", options, async () => {
  const p = profile(), c = await deliver(p);
  const bad = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code === "000000" ? "111111" : "000000" });
  assert.equal(bad.status, 400); assert.equal(bad.body.token, undefined); assert.equal(await prisma.adaptiveInterview.count(), 0);
  // Non-regression: ensure PostgreSQL CHECK constraint EmailOtpChallenge_check1 (expiresAt > createdAt) is actively enforced
  await assert.rejects(
    () => prisma.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "expiresAt"="createdAt"-interval '1 second' WHERE id=$1::uuid`, c.challengeId),
    (err: any) => err.message.includes("EmailOtpChallenge_check1") || err.message.includes("23514")
  );
  await prisma.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes', "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, c.challengeId);
  assert.equal((await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code })).body.verificationStatus, "EXPIRED");
  assert.equal(await prisma.adaptiveInterview.count(), 0);
  await resendClock(); const fresh = await deliver(p);
  const good = await api("/adaptive/start", "POST", { ...p, challengeId: fresh.challengeId, verificationCode: fresh.code }); assert.equal(good.status, 201);
  const replay = await api("/adaptive/start", "POST", { ...p, challengeId: fresh.challengeId, verificationCode: fresh.code });
  assert.equal(replay.status, 400); assert.equal(replay.body.token, undefined); assert.equal(await prisma.adaptiveInterview.count(), 1);
});

test("Two simultaneous validations use real PostgreSQL backends and create one participant", options, async () => {
  const p = profile(), c = await deliver(p);
  const pids = await Promise.all([prisma.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.1)`), prisma.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.1)`)]);
  assert.notEqual(pids[0][0].pid, pids[1][0].pid);
  const responses = await Promise.all([api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code }), api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code })]);
  assert.equal(responses.filter(r => r.status === 201).length, 1); assert.equal(responses.filter(r => r.body.token).length, 1);
  assert.equal(await prisma.adaptiveInterview.count(), 1);
});

test("Five attempts per code; resend retains cumulative failures and respects 60 seconds", options, async () => {
  const p = profile(), c = await deliver(p), wrong = c.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: wrong })).status, 400);
  assert.equal((await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code })).status, 429);
  assert.equal((await api("/adaptive/start", "POST", { ...p, requestNewCode: true })).status, 429);
  const failed = await prisma.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" WHERE metric=\'OTP_FAILURE\' ORDER BY scope');
  await resendClock(); const fresh = await api("/adaptive/start", "POST", { ...p, requestNewCode: true }); assert.equal(fresh.status, 409); assert.notEqual(fresh.body.challengeId, c.challengeId);
  assert.deepEqual(await prisma.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" WHERE metric=\'OTP_FAILURE\' ORDER BY scope'), failed);
  assert.equal(await prisma.adaptiveInterview.count(), 0);
});

test("Fifteen cumulative failures survive resends and prevent subsequent delivery", options, async () => {
  const p = profile();
  for (let round = 0; round < 3; round++) {
    const c = await deliver(p), wrong = c.code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: wrong })).status, 400);
    await resendClock();
  }
  const fourth = await issue(p); await processOtp();
  assert.equal(deliveries.length, 3);
  assert.equal((await api(`/adaptive/email-verification/${fourth.body.challengeId}`)).body.verificationStatus, "LIMIT_REACHED");
  assert.equal((await api("/adaptive/start", "POST", { ...p, challengeId: fourth.body.challengeId, verificationCode: "123456" })).status, 429);
  assert.equal(await prisma.adaptiveInterview.count(), 0);
});

test("A resend cannot bypass the durable per-address delivery ceiling", options, async () => {
  process.env.OTP_IDENTITY_DAILY_SENDS = "1";
  await deliver(); await resendClock();
  const second = await api("/adaptive/start", "POST", { ...profile(), requestNewCode: true }); await processOtp();
  assert.equal(deliveries.length, 1);
  assert.equal((await api(`/adaptive/email-verification/${second.body.challengeId}`)).body.verificationStatus, "LIMIT_REACHED");
  assert.equal(await prisma.emailBudgetReservation.count(), 1);
});

test("Expiry at final consumption rolls back participant and token creation atomically", options, async () => {
  const p = profile(), c = await deliver(p);
  // This synthetic-only trigger advances the challenge to an expired state
  // inside participant insertion, after the initial validation predicate.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION lot4_expire_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes', "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'; RETURN NEW; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER lot4_expire BEFORE INSERT ON "AdaptiveInterview" FOR EACH ROW EXECUTE FUNCTION lot4_expire_on_insert()`);
    const response = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
    assert.equal(response.status, 400); assert.equal(response.body.verificationStatus, "EXPIRED"); assert.equal(response.body.token, undefined);
    assert.equal(await prisma.adaptiveInterview.count(), 0);
    const challenge = await prisma.emailOtpChallenge.findUniqueOrThrow({ where: { id: c.challengeId } });
    assert.equal(challenge.consumedAt, null); assert.equal(challenge.attempts, 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot4_expire ON "AdaptiveInterview"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION lot4_expire_on_insert()`);
  }
});

test("An unverified request never permanently reserves an address", options, async () => {
  const p = profile(), first = await issue(p);
  assert.equal((await issue({ ...p, fullName: "Another browser" })).body.challengeId, first.body.challengeId);
  await prisma.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes', "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  await resendClock(); const next = await issue(p);
  assert.notEqual(next.body.challengeId, first.body.challengeId); assert.equal(await prisma.adaptiveInterview.count(), 0);
  // One tick rejects the obsolete queued challenge, the following tick sends
  // its replacement. Production advances this bounded queue every second.
  await processOtp(); await processOtp();
  const code = mailbox.get(p.email); assert.ok(code); assert.equal(deliveries.length, 1);
  const r = await api("/adaptive/start", "POST", { ...p, challengeId: next.body.challengeId, verificationCode: code });
  assert.equal(r.status, 201); assert.equal(await prisma.adaptiveInterview.count(), 1);
});

test("Public requests do not disclose whether an email already has a participation", options, async () => {
  const known = profile("known@example.test"), unknown = profile("unknown@example.test");
  const { createPreparedInterview } = await import("../src/services/prepared-interview.service.js");
  const { hashGuestToken } = await import("../src/security/tokens.js");
  const row = await prisma.adaptiveInterview.create({ data: { displayName: "Historical", email: known.email, emailIdentity: known.email, tokenHash: hashGuestToken("a".repeat(64)), state: createPreparedInterview("fr") as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
  const a = await issue(known), b = await issue(unknown);
  assert.equal(a.status, b.status); assert.equal(a.body.code, b.body.code); assert.equal(a.body.verificationStatus, b.body.verificationStatus);
  assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort()); assert.equal(a.body.nextAllowedAt, undefined);
  assert.equal((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } })).emailVerifiedAt, null);
  await processOtp(); const verifiedKnown = await api("/adaptive/start", "POST", { ...known, challengeId: a.body.challengeId, verificationCode: mailbox.get(known.email) });
  assert.equal(verifiedKnown.body.code, "RETAKE_COOLDOWN"); assert.equal(verifiedKnown.body.verificationStatus, "VERIFIED"); assert.equal(verifiedKnown.body.token, undefined);
  assert.equal((await api("/adaptive/me", "GET", undefined, "a".repeat(64))).status, 200);
});

test("In-flight uncertain OTP is preserved, usable and never automatically redelivered", options, async () => {
  const p = profile(); mode = "lost"; const c = await deliver(p);
  assert.equal((await api(`/adaptive/email-verification/${c.challengeId}`)).body.verificationStatus, "UNCERTAIN");
  await resendClock(); const again = await api("/adaptive/start", "POST", { ...p, requestNewCode: true }); assert.equal(again.body.challengeId, c.challengeId);
  await processOtp(); assert.equal(deliveries.length, 1);
  const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code }); assert.equal(r.status, 201);
  assert.equal((await prisma.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
});

test("Local budget exhaustion prevents transport; provider quota and 429 remain shared", options, async () => {
  process.env.EMAIL_APP_DAILY_LIMIT = "0"; const q = await issue(); await processOtp();
  assert.equal(deliveries.length, 0); assert.equal((await api(`/adaptive/email-verification/${q.body.challengeId}`)).body.verificationStatus, "LIMIT_REACHED");
  assert.equal(await prisma.adaptiveInterview.count(), 0);
});

test("Known 429 retries the same queued OTP with the same budget reservation", options, async () => {
  mode = "rate"; const p = profile(), r = await issue(p); await processOtp();
  assert.equal(deliveries.length, 1); const firstKey = deliveries[0].headers.IdempotencyKey;
  await processOtp(); assert.equal(deliveries.length, 1);
  await prisma.$executeRawUnsafe(`UPDATE "EmailProviderState" SET "blockedUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  await prisma.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  mode = "accept"; await processOtp(); assert.equal(deliveries.length, 2); assert.equal(deliveries[1].headers.IdempotencyKey, firstKey);
  assert.equal(await prisma.emailBudgetReservation.count(), 1);
  assert.equal((await api(`/adaptive/email-verification/${r.body.challengeId}`)).body.verificationStatus, "SENT");
});

test("Provider quota closes the shared circuit and never creates a participant", options, async () => {
  mode = "quota"; const r = await issue(); await processOtp(); assert.equal(deliveries.length, 1);
  const { sendReportEmail } = await import("../src/services/brevo.service.js");
  await assert.rejects(sendReportEmail({ recipient: "report@example.test", recipientName: "Synthetic", idempotencyKey: randomUUID(), subject: "Synthetic", htmlContent: "<p>Synthetic</p>" }), /BREVO_QUOTA/);
  assert.equal(deliveries.length, 1); assert.equal(await prisma.adaptiveInterview.count(), 0);
  assert.equal((await api(`/adaptive/email-verification/${r.body.challengeId}`)).body.verificationStatus, "LIMIT_REACHED");
});

test("OTP and report competing for the last credit consume a single shared unit", options, async () => {
  process.env.EMAIL_APP_DAILY_LIMIT = "1"; await issue();
  const { sendReportEmail } = await import("../src/services/brevo.service.js");
  await Promise.allSettled([processOtp(), sendReportEmail({ recipient: "report@example.test", recipientName: "Synthetic", idempotencyKey: randomUUID(), subject: "Synthetic", htmlContent: "<p>Synthetic</p>" })]);
  assert.equal(deliveries.length, 1); assert.equal(await prisma.emailBudgetReservation.count(), 1);
  assert.equal((await prisma.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
});

test("Expired, invalid UUID and cross-address challenge requests cannot grant access", options, async () => {
  const c = await deliver();
  assert.equal((await api("/adaptive/start", "POST", { ...profile("other@example.test"), challengeId: c.challengeId, verificationCode: c.code })).status, 400);
  assert.equal((await api("/adaptive/start", "POST", { ...profile(), challengeId: "not-a-uuid", verificationCode: c.code })).status, 400);
  assert.equal((await api("/adaptive/start", "POST", { ...profile(), verificationCode: "123" })).status, 400);
  assert.equal((await api(`/adaptive/email-verification/${randomUUID()}`)).body.verificationStatus, "INVALID");
  assert.equal(await prisma.adaptiveInterview.count(), 0);
});

test("FR/AR work without AI quota; all 31 prepared questions and bilingual report remain available", options, async () => {
  const p = profile("arabic@example.test", "ar"), r = await verified(p); assert.equal(r.status, 201);
  assert.ok(deliveries[0].htmlContent.includes('lang="ar" dir="rtl"'));
  let current = r.body.interview;
  for (let i = 0; i < 31; i++) {
    const question = current.currentQuestion; assert.equal(question.choices.length, 4); assert.equal("rubric" in question, false);
    const next = await api("/adaptive/answer?lang=ar", "POST", { questionId: question.id, choiceId: question.choices[0].id }, r.body.token); assert.equal(next.status, 200); current = next.body;
  }
  assert.equal(current.report.skills.length, 31); assert.equal(current.currentQuestion, null);
  const translated = await api("/adaptive/me?lang=fr", "GET", undefined, r.body.token); assert.equal(translated.status, 200); assert.equal(translated.body.language, "fr");
});

test("Retake after 30 days renews the same participant, preserves previous report and revokes old access", options, async () => {
  const { createPreparedInterview, advancePreparedInterview } = await import("../src/services/prepared-interview.service.js");
  let state = createPreparedInterview("fr"); while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const { hashGuestToken } = await import("../src/security/tokens.js");
  const p = profile("historical@example.test"), row = await prisma.adaptiveInterview.create({ data: { displayName: "Historical", email: p.email, emailIdentity: p.email, tokenHash: hashGuestToken("b".repeat(64)), state: state as unknown as Prisma.InputJsonValue, lastTestStartedAt: new Date(Date.now() - 31 * 86400000), expiresAt: new Date(Date.now() + 86400000) } });
  await prisma.adaptiveReportJob.create({ data: { interviewId: row.id, status: "COMPLETE", summary: JSON.stringify({ fr: "Ancien rapport", ar: "Synthetic previous report" }), emailStatus: "SENT" } });
  assert.equal((await api("/adaptive/me", "GET", undefined, "b".repeat(64))).status, 200);
  const c = await deliver(p); const current = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(current.previousResult, null);
  const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code }); assert.equal(r.status, 201); assert.equal(r.body.interview.id, row.id);
  const renewed = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } }); assert.ok(renewed.previousResult); assert.ok(renewed.emailVerifiedAt);
  assert.equal((await api("/adaptive/me", "GET", undefined, "b".repeat(64))).status, 401); assert.equal(await prisma.adaptiveInterview.count(), 1);
});

test("Pre-upgrade pending retake code remains valid without marking history verified beforehand", options, async () => {
  const p = profile("legacy-code@example.test"), id = randomUUID(), code = "654321";
  const hash = createHmac("sha256", process.env.JOIN_CODE_PEPPER!).update(`retake:${id}:${code}`).digest("hex");
  await prisma.adaptiveInterview.create({ data: { id, displayName: "Historical", email: p.email, emailIdentity: p.email, tokenHash: "c".repeat(64), state: {}, lastTestStartedAt: new Date(Date.now() - 31 * 86400000), expiresAt: new Date(Date.now() + 86400000), retakeCodeHash: hash, retakeCodeExpiresAt: new Date(Date.now() + 600000) } });
  const r = await api("/adaptive/start", "POST", { ...p, verificationCode: code }); assert.equal(r.status, 201); assert.equal(r.body.interview.id, id); assert.equal(r.body.interview.emailVerified, true);
});

test("Administrator authentication still requires password, ADMIN role and an unexpired session", options, async () => {
  const { hashPassword } = await import("../src/security/tokens.js");
  await prisma.user.create({ data: { email: "admin@example.test", role: "ADMIN", passwordHash: await hashPassword("Synthetic-only-password") } });
  assert.equal((await api("/admin/auth/login", "POST", { email: "admin@example.test", password: "wrong" })).status, 401);
  const login = await api("/admin/auth/login", "POST", { email: "admin@example.test", password: "Synthetic-only-password" }); assert.equal(login.status, 200);
  assert.equal((await api("/admin/auth/me", "GET", undefined, login.body.token)).status, 200);
  assert.equal((await api("/admin/adaptive/dashboard")).status, 401);
  const student = await prisma.user.create({ data: { email: "student@example.test", role: "STUDENT" } });
  const { hashAdminToken } = await import("../src/security/adminAuth.js");
  await prisma.adminSession.create({ data: { userId: student.id, tokenHash: hashAdminToken("d".repeat(64)), expiresAt: new Date(Date.now() + 600000) } });
  assert.equal((await api("/admin/auth/me", "GET", undefined, "d".repeat(64))).status, 401);
  await prisma.adminSession.updateMany({ data: { expiresAt: new Date(0) } }); assert.equal((await api("/admin/auth/me", "GET", undefined, login.body.token)).status, 401);
});

test("Historical session-code participation and existing guest access remain independent of the email gate", options, async () => {
  const { hashJoinCode } = await import("../src/security/tokens.js");
  const user = await prisma.user.create({ data: { email: "teacher@example.test", role: "ADMIN" } });
  const assessment = await prisma.assessment.create({ data: { slug: randomUUID(), title: "Synthetic historical assessment", status: "PUBLISHED" } });
  const mission = await prisma.mission.create({ data: { assessmentId: assessment.id, position: 1, title: "Synthetic mission", status: "PUBLISHED", version: 1 } });
  const first = await prisma.scenarioNode.create({ data: { missionId: mission.id, key: "start", kind: "QUESTION", title: "Synthetic question", story: "Synthetic story", question: "Choose", isStart: true } });
  const last = await prisma.scenarioNode.create({ data: { missionId: mission.id, key: "end", kind: "ENDING", title: "Synthetic ending", story: "Synthetic complete" } });
  const choice = await prisma.scenarioChoice.create({ data: { nodeId: first.id, nextNodeId: last.id, position: 0, label: "Synthetic choice" } });
  const graph = [
    { id: first.id, key: "start", kind: "QUESTION", title: "Synthetic question", story: "Synthetic story", question: "Choose", isStart: true, choices: [{ id: choice.id, position: 0, label: choice.label, nextNodeId: last.id, impacts: [] }] },
    { id: last.id, key: "end", kind: "ENDING", title: "Synthetic ending", story: "Synthetic complete", question: null, isStart: false, choices: [] },
  ];
  await prisma.missionVersion.create({ data: { missionId: mission.id, version: 1, title: "Synthetic mission", graphSnapshot: graph as unknown as Prisma.InputJsonValue } });
  await prisma.assessmentSession.create({ data: { assessmentId: assessment.id, createdById: user.id, label: "Synthetic class", status: "OPEN", codeHash: hashJoinCode("SQ-NATIVE-ONLY"), opensAt: new Date(Date.now() - 60000), closesAt: new Date(Date.now() + 86400000) } });
  const join = await api("/sessions/join", "POST", { registrationId: crypto.randomUUID(), code: "SQ-NATIVE-ONLY", displayName: "Synthetic learner" }); assert.equal(join.status, 201);
  assert.equal((await api("/participants/me", "GET", undefined, join.body.guestToken)).status, 200);
  const adaptive = await api("/adaptive/me", "GET", undefined, join.body.guestToken);
  assert.equal(adaptive.status, 200);
  assert.equal(adaptive.body.totalQuestions, 31);
  assert.equal(adaptive.body.answeredCount, 0);
  assert.equal(adaptive.body.status, "IN_PROGRESS");
  assert.equal((await api("/participants/decisions", "POST", { choiceId: choice.id }, join.body.guestToken)).status, 200);
  assert.equal(await prisma.adaptiveInterview.count(), 1);
  assert.equal(await prisma.emailOtpChallenge.count(), 0);
});

test("300 participants on the same network can request verification without creating unverified accounts", options, async () => {
  for (let start = 0; start < 300; start += 25) {
    const responses = await Promise.all(Array.from({ length: 25 }, (_, offset) => issue(profile(`cohort-${start + offset}@example.test`))));
    assert.ok(responses.every(r => r.status === 409 && r.body.verificationStatus === "PENDING" && !r.body.token));
  }
  assert.equal(await prisma.adaptiveInterview.count(), 0); assert.equal(await prisma.emailOtpChallenge.count(), 300); assert.equal(deliveries.length, 0);
});

test("Admin deletion race during pre-upgrade retake never creates a participant without OTP", options, async () => {
  const p = profile("deleted-race@example.test");
  const id = randomUUID(), code = "123456";
  const hash = createHmac("sha256", process.env.JOIN_CODE_PEPPER!).update(`retake:${id}:${code}`).digest("hex");
  // Participant exists with a pending retake code
  await prisma.adaptiveInterview.create({
    data: {
      id, displayName: "Historical", email: p.email, emailIdentity: p.email,
      tokenHash: "e".repeat(64), state: {}, lastTestStartedAt: new Date(Date.now() - 31 * 86400000),
      expiresAt: new Date(Date.now() + 86400000), retakeCodeHash: hash, retakeCodeExpiresAt: new Date(Date.now() + 600000),
    },
  });

  // Admin deletes the student right before submission completes
  await prisma.adaptiveInterview.delete({ where: { id } });

  // Submission of the retake code must NOT resurrect the user or create a new interview
  const r = await api("/adaptive/start", "POST", { ...p, verificationCode: code });
  assert.notEqual(r.status, 201);
  assert.equal(r.body.token, undefined);
  assert.equal(await prisma.adaptiveInterview.count(), 0);
});

test("Email abuse counter retention cleanup preserves active quota windows and purges only expired entries", options, async () => {
  const { EmailBudget } = await import("../src/services/email-budget.service.js");
  const budget = new EmailBudget(prisma);
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentExpiry = new Date(day.getTime() + 86400000);
  const yesterdayExpiry = new Date(day.getTime());
  const threeDaysAgoExpiry = new Date(day.getTime() - 2 * 86400000);
  const fiveDaysAgoExpiry = new Date(day.getTime() - 4 * 86400000);
  const h = "f".repeat(64);

  // Insert counters with different expiries
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EmailAbuseCounter" (scope, "subjectHash", metric, "windowStart", "expiresAt", count) VALUES
     ('IDENTITY', $1, 'OTP_SEND', $2, $3, 3),
     ('IDENTITY', $1, 'OTP_SEND', $4, $5, 4),
     ('IDENTITY', $1, 'OTP_SEND', $6, $7, 2),
     ('IDENTITY', $1, 'OTP_SEND', $8, $9, 1)`,
    h,
    day, currentExpiry,
    new Date(day.getTime() - 86400000), yesterdayExpiry,
    new Date(day.getTime() - 3 * 86400000), threeDaysAgoExpiry,
    new Date(day.getTime() - 5 * 86400000), fiveDaysAgoExpiry
  );

  // Throttles: one active (now + 60s) and one expired (now - 2 hours)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EmailOtpThrottle" ("identityHash", "nextSendAt") VALUES
     ($1, $2), ($3, $4)`,
    "1".repeat(64), new Date(now.getTime() + 60000),
    "2".repeat(64), new Date(now.getTime() - 7200000)
  );

  // Run purge
  const purgeResult = await budget.purgeExpiredCounters();
  assert.equal(purgeResult.deletedCounters, 2); // only 3-days and 5-days ago
  assert.equal(purgeResult.deletedThrottles, 1); // only 2-hours ago throttle

  // Active counter (today) and yesterday counter are PRESERVED
  const remaining = await prisma.$queryRawUnsafe<{ count: number; expiresAt: Date }[]>(
    `SELECT count, "expiresAt" FROM "EmailAbuseCounter" WHERE "subjectHash"=$1 ORDER BY "expiresAt" DESC`,
    h
  );
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].count, 3); // today
  assert.equal(remaining[1].count, 4); // yesterday

  // Active throttle is PRESERVED
  const throttles = await prisma.$queryRawUnsafe<{ identityHash: string }[]>(
    `SELECT "identityHash" FROM "EmailOtpThrottle"`
  );
  assert.equal(throttles.length, 1);
  assert.equal(throttles[0].identityHash, "1".repeat(64));
});

test("Secret rotation with previous key decrypts in-flight OTP payloads and verifies pending challenges", options, async () => {
  const { encryptOtpPayload, decryptOtpPayload } = await import("../src/security/otp-payload.js");
  const oldPepper = process.env.JOIN_CODE_PEPPER!;
  const newPepper = "new-rotated-pepper-key-0123456789abcdef";
  const jobId = randomUUID();

  // Payload encrypted with old key before rotation
  const payload = { recipient: "rotated@example.test", recipientName: "Rotated User", subject: "Test", htmlContent: "<p>123456</p>" };
  const ciphertext = encryptOtpPayload(payload, jobId);

  // Rotate key in environment: primary becomes newPepper, previous becomes oldPepper
  process.env.JOIN_CODE_PEPPER = newPepper;
  process.env.JOIN_CODE_PEPPER_PREVIOUS = oldPepper;

  try {
    // Decryption of in-flight payload encrypted under old key succeeds seamlessly
    const decrypted = decryptOtpPayload(ciphertext, jobId);
    assert.deepEqual(decrypted, payload);

    // New encryption uses new key
    const newCiphertext = encryptOtpPayload(payload, jobId);
    assert.deepEqual(decryptOtpPayload(newCiphertext, jobId), payload);

    // Verifying OTP issued under old key works via previous pepper
    const p = profile("rotated@example.test");
    const issueResponse = await issue(p);
    // Simulate challenge created with oldPepper
    const oldCodeHash = createHmac("sha256", oldPepper).update(`entry:${issueResponse.body.challengeId}:123456`).digest("hex");
    await prisma.$executeRawUnsafe(
      `UPDATE "EmailOtpChallenge" SET "codeHash"=$1 WHERE id=$2::uuid`,
      oldCodeHash, issueResponse.body.challengeId
    );

    const verifyResponse = await api("/adaptive/start", "POST", {
      ...p, challengeId: issueResponse.body.challengeId, verificationCode: "123456",
    });
    assert.equal(verifyResponse.status, 201);
    assert.ok(verifyResponse.body.token);
  } finally {
    // Restore environment
    process.env.JOIN_CODE_PEPPER = oldPepper;
    delete process.env.JOIN_CODE_PEPPER_PREVIOUS;
  }
});

// Intercept only the selected SQL boundary; all transactions and SQL still run
// on the owned native PostgreSQL cluster, without production-only test hooks.
function replacePrismaMethod(t: import("node:test").TestContext, target: any, key: string, replacement: any) {
  // Prisma delegates are dynamic proxies without method descriptors, so
  // node:test mock.method cannot patch them. Restore the assignment explicitly.
  const original = target[key];
  target[key] = replacement;
  const restore = () => { target[key] = original; };
  t.after(restore);
  return restore;
}
function interceptEntrySql(t: import("node:test").TestContext,
  intercept: (tx: Prisma.TransactionClient, sql: string, args: unknown[]) => Promise<number | undefined>) {
  const transaction = prisma.$transaction.bind(prisma);
  return replacePrismaMethod(t, prisma, "$transaction", (work: (tx: Prisma.TransactionClient) => Promise<unknown>, settings: any) =>
    transaction(async tx => work(new Proxy(tx, { get(target, property) {
      if (property === "$executeRawUnsafe") return async (sql: string, ...args: unknown[]) => {
        const replacement = await intercept(target, sql, args);
        return replacement ?? target.$executeRawUnsafe(sql, ...args);
      };
      return Reflect.get(target, property);
    } })), settings));
}

async function installFinalExpiry() {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION lot4_final_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes',
      "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER lot4_final_expiry BEFORE INSERT ON "AdaptiveInterview" FOR EACH ROW EXECUTE FUNCTION lot4_final_expiry()`);
}
async function removeFinalExpiry() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot4_final_expiry ON "AdaptiveInterview"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lot4_final_expiry()`);
}
async function assertEntryRolledBack(id: string) {
  assert.equal(await verifier.adaptiveInterview.count(), 0);
  const row = await verifier.emailOtpChallenge.findUniqueOrThrow({ where: { id } });
  assert.equal(row.attempts, 0); assert.equal(row.consumedAt, null);
}

test("Unexpected zero-row attempt or consumption is HTTP 500, not expiry or attempt limit", options, async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION lot4_skip_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (TG_ARGV[0]='attempt' AND NEW.attempts>OLD.attempts)
      OR (TG_ARGV[0]='consumption' AND NEW."consumedAt" IS NOT NULL) THEN RETURN NULL; END IF;
    RETURN NEW; END $$`);
  try {
    for (const phase of ["attempt", "consumption"]) {
      const p = profile(`zero-${phase}@example.test`), c = await deliver(p);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER lot4_skip_update BEFORE UPDATE ON "EmailOtpChallenge"
        FOR EACH ROW EXECUTE FUNCTION lot4_skip_update('${phase}')`);
      try {
        const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
        assert.equal(r.status, 500); assert.equal(r.body.verificationStatus, undefined); assert.equal(r.body.token, undefined);
        await assertEntryRolledBack(c.challengeId);
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER lot4_skip_update ON "EmailOtpChallenge"`); }
    }
  } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION lot4_skip_update()`); }
});

test("Expiry between locked read and attempt returns HTTP 400; live exhausted OTP returns HTTP 429", options, async t => {
  const p = profile(), c = await deliver(p);
  let intercepted = false;
  const restore = interceptEntrySql(t, async (tx, sql, args) => {
    if (!intercepted && sql.startsWith('UPDATE "EmailOtpChallenge" SET attempts=attempts+1')) {
      intercepted = true;
      await tx.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '11 minutes',
        "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, args[0]);
    }
    return undefined;
  });
  const expired = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
  assert.ok(intercepted); assert.equal(expired.status, 400); assert.equal(expired.body.code, "EMAIL_CODE_EXPIRED");
  assert.equal(expired.body.token, undefined); await assertEntryRolledBack(c.challengeId);
  restore();
  const live = await deliver(profile("exhausted@example.test"));
  await prisma.emailOtpChallenge.update({ where: { id: live.challengeId }, data: { attempts: 5 } });
  const limited = await api("/adaptive/start", "POST", { ...profile("exhausted@example.test"), challengeId: live.challengeId, verificationCode: live.code });
  assert.equal(limited.status, 429); assert.equal(limited.body.code, "EMAIL_LIMIT_REACHED"); assert.equal(limited.body.token, undefined);
  assert.equal(await verifier.adaptiveInterview.count(), 0);
});

test("Unexpected native SQL failure returns HTTP 500 and rolls back attempts and participant", options, async () => {
  const p = profile(), c = await deliver(p);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION lot4_sql_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'synthetic SQL failure' USING ERRCODE='XX000'; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER lot4_sql_failure BEFORE INSERT ON "AdaptiveInterview" FOR EACH ROW EXECUTE FUNCTION lot4_sql_failure()`);
    const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
    assert.equal(r.status, 500); assert.equal(r.body.verificationStatus, undefined); assert.equal(r.body.token, undefined);
    await assertEntryRolledBack(c.challengeId);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot4_sql_failure ON "AdaptiveInterview"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION lot4_sql_failure()`);
  }
});

test("Native savepoint rollback failure after expiry returns HTTP 500, never EXPIRED", options, async t => {
  const p = profile(), c = await deliver(p); let attemptedRollback = false;
  await installFinalExpiry();
  const restore = interceptEntrySql(t, async (tx, sql) => {
    if (sql === "ROLLBACK TO SAVEPOINT email_entry_validation") {
      attemptedRollback = true;
      return tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT nonexistent_synthetic_savepoint`);
    }
    return undefined;
  });
  try {
    const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
    assert.ok(attemptedRollback); assert.equal(r.status, 500); assert.equal(r.body.verificationStatus, undefined); assert.equal(r.body.token, undefined);
    await assertEntryRolledBack(c.challengeId);
  } finally { restore(); await removeFinalExpiry(); }
});

test("Native deferred commit failure after successful expiry rollback remains HTTP 500", options, async () => {
  const p = profile(), c = await deliver(p);
  await installFinalExpiry();
  await prisma.$executeRawUnsafe(`DELETE FROM "EmailProviderState"`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION lot4_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'synthetic deferred commit failure' USING ERRCODE='XX000'; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER lot4_commit_failure AFTER INSERT ON "EmailProviderState"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lot4_commit_failure()`);
    const r = await api("/adaptive/start", "POST", { ...p, challengeId: c.challengeId, verificationCode: c.code });
    assert.equal(r.status, 500); assert.equal(r.body.verificationStatus, undefined); assert.equal(r.body.token, undefined);
    await assertEntryRolledBack(c.challengeId);
    assert.equal(await verifier.emailProviderState.count(), 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot4_commit_failure ON "EmailProviderState"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION lot4_commit_failure()`);
    await removeFinalExpiry();
  }
});

test("Independent PostgreSQL connection deletes participant after first retake read and before legacyRetake", options, async t => {
  const p = profile("concurrent-delete@example.test"), id = randomUUID(), code = "654321";
  const hash = createHmac("sha256", process.env.JOIN_CODE_PEPPER!).update(`retake:${id}:${code}`).digest("hex");
  await prisma.adaptiveInterview.create({ data: { id, displayName: "Historical", email: p.email, emailIdentity: p.email,
    tokenHash: "9".repeat(64), state: {}, lastTestStartedAt: new Date(Date.now() - 31 * 86400000),
    expiresAt: new Date(Date.now() + 86400000), retakeCodeHash: hash, retakeCodeExpiresAt: new Date(Date.now() + 600000) } });
  let signalRead!: () => void, release!: () => void;
  const read = new Promise<void>(resolve => { signalRead = resolve; });
  const deleted = new Promise<void>(resolve => { release = resolve; });
  let firstPid = 0, deletePid = 0, reads = 0;
  const events: string[] = [];
  const find = prisma.adaptiveInterview.findUnique.bind(prisma.adaptiveInterview);
  const restore = replacePrismaMethod(t, prisma.adaptiveInterview, "findUnique", async (args: any) => {
    if (args.where.emailIdentity !== p.email) return find(args);
    reads++;
    if (reads === 1) {
      const row = await prisma.$transaction(async tx => {
        firstPid = (await tx.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
        return tx.adaptiveInterview.findUnique(args);
      });
      assert.ok(row); events.push("first-read-present"); signalRead();
      await deleted; return row;
    }
    const row = await find(args);
    assert.equal(row, null); events.push("legacy-read-absent"); return row;
  });
  const pending = api("/adaptive/start", "POST", { ...p, verificationCode: code });
  try {
    // A deadline only detects a broken barrier; it never determines ordering.
    await Promise.race([read, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("First-read barrier not reached")), 10000); timer.unref();
    })]);
    await verifier.$transaction(async tx => {
      deletePid = (await tx.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
      await tx.adaptiveInterview.delete({ where: { id } });
    });
    events.push("admin-delete-committed"); assert.notEqual(firstPid, deletePid); release();
    const r = await pending;
    assert.deepEqual(events, ["first-read-present", "admin-delete-committed", "legacy-read-absent"]);
    assert.equal(reads, 2); assert.equal(r.status, 409); assert.equal(r.body.code, "INTERVIEW_BUSY");
    assert.equal(r.body.token, undefined); assert.equal(r.body.interview, undefined);
    assert.equal(await verifier.adaptiveInterview.count(), 0);
    restore();
    const replay = await api("/adaptive/start", "POST", { ...p, verificationCode: code });
    assert.equal(replay.status, 400); assert.equal(replay.body.code, "EMAIL_CODE_INVALID"); assert.equal(replay.body.token, undefined);
    assert.equal(await verifier.adaptiveInterview.count(), 0);
    console.log("LOT4 deterministic deletion proof", JSON.stringify({ firstPid, deletePid, events, status: r.status, replayStatus: replay.status }));
  } finally { release(); await pending; restore(); }
});

