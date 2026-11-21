import { test, before, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createIsolatedEmailDatabase } from "./helpers/isolated-email.js";
import { OtpDeliveryQueue } from "../src/services/otp-delivery.service.js";
import { EmailBudget } from "../src/services/email-budget.service.js";
import { sendReportEmail } from "../src/services/brevo.service.js";
import { decryptOtpPayload, encryptOtpPayload } from "../src/security/otp-payload.js";

let isolated: Awaited<ReturnType<typeof createIsolatedEmailDatabase>>, socket: PGLiteSocketServer, db: PrismaClient, queue: OtpDeliveryQueue;
let now = new Date("2026-10-30T12:00:00Z");
type Delivery = { id: string; status: string; attempts: number; encryptedPayload: string | null; nextAttemptAt: Date | null; lastErrorCode: string | null; codeHash: string };
before(async () => {
  isolated = await createIsolatedEmailDatabase(); for (const name of isolated.names) await isolated.migrate(name);
  socket = new PGLiteSocketServer({ db: isolated.db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  const url = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`;
  process.env.DATABASE_URL = url; process.env.DIRECT_URL = url; process.env.NODE_ENV = "test";
  db = new PrismaClient({ datasourceUrl: url }); queue = new OtpDeliveryQueue(db, sendReportEmail, () => now);
}, { timeout: 60000 });
beforeEach(async t => {
  now = new Date("2026-10-30T12:00:00Z");
  process.env.JOIN_CODE_PEPPER = "synthetic-otp-queue-only-0123456789abcdef";
  process.env.BREVO_API_KEY = "synthetic-no-network"; process.env.BREVO_SENDER_EMAIL = "sender@example.test";
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1";
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300";
  process.env.EMAIL_APP_DAILY_LIMIT = "240"; process.env.EMAIL_OTHER_USAGE_MARGIN = "60";
  (t as TestContext).mock.method(EmailBudget.prototype, "transactionNow", async () => now);
  (t as TestContext).mock.method(globalThis, "fetch", async () => { throw Error("NETWORK_FORBIDDEN"); });
  await db.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
  await db.$executeRawUnsafe('TRUNCATE "AdaptiveInterview", "EmailBudgetReservation", "EmailAbuseCounter", "EmailOtpThrottle", "EmailProviderState" CASCADE');
});
after(async () => {
  const { prisma } = await import("../src/db/prisma.js"); await prisma.$disconnect();
  await db?.$disconnect();
  // pglite-socket schedules detach callbacks with setImmediate; stop() does not
  // await them. Drain disconnected handlers before closing the WASM database.
  for (let i = 0; i < 100 && socket.getStats().activeConnections; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(socket.getStats().activeConnections, 0);
  await new Promise<void>(r => setImmediate(r));
  await socket.stop(); await isolated.db.query("SELECT 1"); await isolated.db.close();
});
async function fixture() {
  const id = randomUUID(), code = "654321", email = "synthetic@example.test";
  const hash = createHmac("sha256", process.env.JOIN_CODE_PEPPER!).update(`retake:${id}:${code}`).digest("hex");
  const row = await db.adaptiveInterview.create({ data: { id, displayName: "Synthetic", email, emailIdentity: email, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), state: {}, expiresAt: new Date(now.getTime() + 86400000), lastTestStartedAt: new Date(now.getTime() - 31 * 86400000) } });
  const input = { interviewId: id, lastTestStartedAt: row.lastTestStartedAt, codeHash: hash, payload: { recipient: email, recipientName: "Synthetic", subject: "Synthetic OTP", htmlContent: `<p>${code}</p>`, networkOrigin: "127.0.0.1" } };
  return { row, input, code, hash, email };
}
async function job() { return (await db.$queryRawUnsafe<Delivery[]>('SELECT * FROM "OtpDeliveryJob"'))[0]; }
async function units() { return (await db.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0]?.count ?? 0; }

test("Enqueue is local, transactional and coalesces concurrent requests; payload is encrypted", async t => {
  const f = await fixture(), fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected provider"); });
  const results = await Promise.all([queue.enqueue(f.input), queue.enqueue(f.input)]);
  assert.equal(results.filter(r => r && !r.reused).length, 1);
  assert.equal((await db.$queryRawUnsafe<unknown[]>('SELECT * FROM "OtpDeliveryJob"')).length, 1);
  const saved = await job(); assert.equal(saved.status, "PENDING");
  assert.ok(!saved.encryptedPayload!.includes(f.input.payload.htmlContent));
  assert.deepEqual(decryptOtpPayload(saved.encryptedPayload!, saved.id), f.input.payload);
  assert.equal(fetch.mock.callCount(), 0); assert.equal(await units(), 0);
});

test("Payload authentication rejects tampering and copying to another job", () => {
  const id = randomUUID(), cipher = encryptOtpPayload({ synthetic: true }, id);
  assert.throws(() => decryptOtpPayload(cipher, randomUUID()), /OTP_PAYLOAD_INVALID/);
  const parts = cipher.split(":"); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.throws(() => decryptOtpPayload(parts.join(":"), id), /OTP_PAYLOAD_INVALID/);
});

test("Concurrent workers use one transport and preserve reports", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  await db.adaptiveReportJob.create({ data: { interviewId: f.row.id, status: "COMPLETE", summary: "Synthetic old report", emailStatus: "SENT" } });
  const before = await db.adaptiveReportJob.findUnique({ where: { interviewId: f.row.id } });
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ messageId: "synthetic-accepted" }, { status: 201 }));
  await Promise.all([queue.runOnce(), new OtpDeliveryQueue(db, sendReportEmail, () => now).runOnce()]);
  assert.equal(fetch.mock.callCount(), 1); assert.equal((await job()).status, "ACCEPTED");
  assert.equal((await job()).encryptedPayload, null); assert.equal(await units(), 1);
  assert.deepEqual(await db.adaptiveReportJob.findUnique({ where: { interviewId: f.row.id } }), before);
});

test("Lost response preserves a usable OTP, reservation and same job on resend", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Simulated response lost after acceptance"); });
  await queue.runOnce(); const first = await job();
  assert.equal(first.status, "UNCERTAIN"); assert.equal(first.nextAttemptAt, null);
  now = new Date(now.getTime() + 61000);
  assert.equal((await queue.enqueue({ ...f.input, codeHash: "b".repeat(64) }))?.reused, true);
  await new OtpDeliveryQueue(db, sendReportEmail, () => now).runOnce();
  assert.equal(fetch.mock.callCount(), 1); assert.equal((await job()).id, first.id); assert.equal(await units(), 1);
  const row = await db.adaptiveInterview.findUniqueOrThrow({ where: { id: f.row.id } });
  assert.equal(row.retakeCodeHash, f.hash);
  assert.equal(await new EmailBudget(db, () => now).retakeAttempt({ id: row.id, hash: f.hash, correct: true, email: f.email }), true);
});

test("Known 429 retries immutable payload/key without a second budget reservation", async t => {
  const f = await fixture(); await queue.enqueue(f.input); const bodies: string[] = [];
  const fetch = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    bodies.push(String(init?.body));
    return bodies.length === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "60" } }) : Response.json({ messageId: "synthetic" }, { status: 201 });
  });
  await queue.runOnce(); assert.equal((await job()).status, "PENDING");
  await queue.runOnce(); assert.equal(fetch.mock.callCount(), 1);
  now = new Date(now.getTime() + 61000); await queue.runOnce();
  assert.equal(fetch.mock.callCount(), 2); assert.equal((await job()).status, "ACCEPTED");
  assert.equal(bodies[0], bodies[1]); assert.equal(await units(), 1);
});

for (const [name, status] of [["quota", 402], ["permanent refusal", 401]] as const) {
  test(`${name} is refused without clearing a still-valid challenge`, async t => {
    const f = await fixture(); await queue.enqueue(f.input);
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    await queue.runOnce(); assert.equal((await job()).status, "REJECTED"); assert.equal((await job()).encryptedPayload, null);
    assert.equal((await db.adaptiveInterview.findUniqueOrThrow({ where: { id: f.row.id } })).retakeCodeHash, f.hash);
    await queue.runOnce(); assert.equal(fetch.mock.callCount(), 1);
  });
}

for (const [name, status, payload] of [["provider unavailable", 503, null], ["malformed acceptance", 201, {}]] as const) {
  test(`${name} remains uncertain without automatic redelivery`, async t => {
    const f = await fixture(); await queue.enqueue(f.input);
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
    await queue.runOnce(); await queue.runOnce(); assert.equal((await job()).status, "UNCERTAIN"); assert.equal(fetch.mock.callCount(), 1);
  });
}

test("Provider timeout is bounded to eight seconds and preserves uncertainty", async t => {
  const f = await fixture(); await queue.enqueue(f.input); let deadline = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { deadline = ms; return new AbortController().signal; });
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Synthetic timeout", "TimeoutError"); });
  await queue.runOnce(); assert.equal(deadline, 8000); assert.equal((await job()).status, "UNCERTAIN");
});

test("Crash before budget reservation resumes pending work after lease expiry", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  await db.$executeRawUnsafe(`UPDATE "OtpDeliveryJob" SET status='UNCERTAIN',attempts=1,"attemptToken"=$1::uuid,"leaseUntil"=$2,"nextAttemptAt"=$2`, randomUUID(), new Date(now.getTime() - 1000));
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ messageId: "synthetic" }, { status: 201 }));
  await new OtpDeliveryQueue(db, sendReportEmail, () => now).runOnce();
  assert.equal(fetch.mock.callCount(), 1); assert.equal((await job()).status, "ACCEPTED"); assert.equal(await units(), 1);
});

test("Crash after persisted acceptance reconciles without a second provider call", async t => {
  const f = await fixture(); await queue.enqueue(f.input); const j = await job();
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ messageId: "synthetic" }, { status: 201 }));
  await sendReportEmail({ ...f.input.payload, idempotencyKey: j.id, purpose: "OTP" });
  await db.$executeRawUnsafe(`UPDATE "OtpDeliveryJob" SET status='UNCERTAIN',attempts=1`);
  await new OtpDeliveryQueue(db, sendReportEmail, () => now).runOnce();
  assert.equal(fetch.mock.callCount(), 1); assert.equal((await job()).status, "ACCEPTED"); assert.equal(await units(), 1);
});

test("Late worker completion is fenced; accepted budget reconciles after recovery", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  let started!: () => void, complete!: (response: Response) => void;
  const entered = new Promise<void>(r => { started = r; });
  const fetch = t.mock.method(globalThis, "fetch", async () => { started(); return new Promise<Response>(r => { complete = r; }); });
  const first = queue.runOnce(); await entered;
  now = new Date(now.getTime() + 121000);
  await new OtpDeliveryQueue(db, sendReportEmail, () => now).runOnce();
  assert.equal((await job()).status, "UNCERTAIN");
  complete(Response.json({ messageId: "synthetic" }, { status: 201 })); await first;
  await queue.runOnce(); assert.equal((await job()).status, "ACCEPTED"); assert.equal(fetch.mock.callCount(), 1);
});

test("Expired payload is purged without delivery; legacy potentially delivered code is preserved", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected provider"); });
  now = new Date(now.getTime() + 600001); await queue.runOnce();
  assert.equal((await job()).status, "REJECTED"); assert.equal((await job()).encryptedPayload, null); assert.equal(fetch.mock.callCount(), 0);
  await db.$executeRawUnsafe('DELETE FROM "OtpDeliveryJob"');
  await db.$executeRawUnsafe('UPDATE "AdaptiveInterview" SET "retakeCodeExpiresAt"=$1', new Date(now.getTime() + 600000));
  assert.equal((await queue.enqueue({ ...f.input, codeHash: "b".repeat(64) }))?.status, "UNCERTAIN");
  assert.equal((await db.adaptiveInterview.findUniqueOrThrow({ where: { id: f.row.id } })).retakeCodeHash, f.hash);
});

test("Removing provider configuration pauses sending but still purges expired ciphertext", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  delete process.env.BREVO_API_KEY;
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected provider"); });
  await queue.runOnce(); assert.equal((await job()).status, "PENDING");
  now = new Date(now.getTime() + 600001); await queue.runOnce();
  assert.equal((await job()).status, "REJECTED"); assert.equal((await job()).encryptedPayload, null); assert.equal(fetch.mock.callCount(), 0);
});

test("An exhausted code is not delivered and can be replaced without resetting cumulative counters", async t => {
  const f = await fixture(); await queue.enqueue(f.input);
  const budget = new EmailBudget(db, () => now);
  for (let i = 0; i < 5; i++) await budget.retakeAttempt({ id: f.row.id, hash: f.hash, correct: false, email: f.email, networkOrigin: "127.0.0.1" });
  const counters = await db.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" WHERE metric=\'OTP_FAILURE\' ORDER BY scope');
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected provider"); });
  await queue.runOnce(); assert.equal((await job()).status, "REJECTED"); assert.equal(fetch.mock.callCount(), 0);
  now = new Date(now.getTime() + 61000);
  assert.equal((await queue.enqueue({ ...f.input, codeHash: "b".repeat(64) }))?.reused, false);
  assert.equal((await db.adaptiveInterview.findUniqueOrThrow({ where: { id: f.row.id } })).retakeCodeAttempts, 0);
  assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" WHERE metric=\'OTP_FAILURE\' ORDER BY scope'), counters);
  assert.equal(await units(), 0);
});
