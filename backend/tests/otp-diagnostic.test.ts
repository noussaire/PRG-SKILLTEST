import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { diagnosticId, linkOtpTrace, logOtpEvent, safeOtpCode, withOtpContext } from "../src/services/otp-diagnostic.service.js";
import { configuredDispatch, wakeJobs, acquireDispatchAdmission } from "../src/services/job-dispatch.service.js";
import { realQstashPublisher } from "../src/services/qstash-publisher.service.js";
import { JobPublications } from "../src/services/job-publication.service.js";
import { EmailBudget } from "../src/services/email-budget.service.js";
import { EmailLimitError } from "../src/services/email-limits.js";
import { sendReportEmail, ReportEmailError } from "../src/services/brevo.service.js";
import { encryptOtpPayload } from "../src/security/otp-payload.js";
import { prisma } from "../src/db/prisma.js";
import { processJob } from "../src/services/job-processing.service.js";
import express from "express";
import { once } from "node:events";
import { qstashRouter } from "../src/routes/qstash.routes.js";
import { qstashCurrent, qstashNext, qstashUrl, signQstash } from "./helpers/qstash-signature.js";

const secrets = ["person@example.test", "654321", "SECRET_API_TOKEN", "SECRET_CIPHERTEXT", "https://signed.example.test/private"];
function capture(t: TestContext) {
  const rows: any[] = [];
  t.mock.method(console, "info", (line: string) => {
    for (const secret of secrets) assert.ok(!line.includes(secret), `Sensitive diagnostic field leaked`);
    rows.push(JSON.parse(line));
  });
  return rows;
}
function environment(t: TestContext) {
  const saved = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
    JOIN_CODE_PEPPER: "diagnostic-fixture-pepper-0123456789abcdef", SKILLQUEST_STAGING_MODE: "off",
    SKILLQUEST_DISPATCH_ENABLED: "1", SKILLQUEST_DISPATCH_SECRET: Buffer.alloc(32, 83).toString("base64url"),
    QSTASH_APP_DAILY_LIMIT: "100", SKILLQUEST_QSTASH_MODE: "real", SKILLQUEST_ALLOW_REAL_QSTASH: "1",
    QSTASH_TOKEN: "SECRET_API_TOKEN", QSTASH_CALLBACK_URL: "https://backend.example.test/api/internal/jobs/qstash",
    SKILLQUEST_ALLOW_REAL_BREVO: "1", BREVO_API_KEY: "SECRET_API_TOKEN", BREVO_SENDER_EMAIL: "sender@example.test",
  });
  delete process.env.OTP_ENCRYPTION_KEYS; delete process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID; delete process.env.OTP_PAYLOAD_WRITE_VERSION;
}
function override(t: TestContext, object: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); });
}

test("logger projects only allowlisted fields and sanitizes errors including hostile getters", t => {
  const rows = capture(t), requestId = randomUUID(), traceId = randomUUID();
  withOtpContext({ requestId }, () => {
    linkOtpTrace(traceId);
    logOtpEvent("OTP_DELIVERY_STATUS", "ok", { code: secrets.join(" "), deliveryState: "ACCEPTED", email: secrets[0], payload: secrets[3], error: new Error(secrets[2]) } as any);
    logOtpEvent(secrets[0], "ok");
    logOtpEvent("BREVO_SEND_FAILED", "failed", { traceId: secrets[1], deliveryState: secrets[0], durationMs: NaN });
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { event: "OTP_DELIVERY_STATUS", status: "ok", receipt: "not_observed", requestId, traceId, code: "UNKNOWN_ERROR", deliveryState: "ACCEPTED" });
  assert.equal(safeOtpCode(Object.assign(new Error(secrets.join(" ")), { code: "P2010", meta: { code: "42501" } })), "DB_42501");
  assert.equal(safeOtpCode({ get code() { throw new Error(secrets[0]); } }), "UNKNOWN_ERROR");
  assert.notEqual(diagnosticId(secrets[0]), secrets[0]);
});

test("concurrent async contexts retain their own request, job and dispatcher identities", async t => {
  const rows = capture(t);
  const contexts = [0, 1].map(() => ({ requestId: randomUUID(), traceId: randomUUID(), dispatchId: randomUUID() }));
  await Promise.all(contexts.map(context => withOtpContext(context, async () => {
    await new Promise<void>(resolve => setImmediate(resolve)); logOtpEvent("JOB_SELECTED", "ok");
  })));
  for (const context of contexts) assert.ok(rows.some(row => Object.entries(context).every(([key, value]) => row[key] === value)));
});

test("logger failure never affects the caller", t => {
  t.mock.method(console, "info", () => { throw new Error("sink unavailable"); });
  assert.doesNotThrow(() => logOtpEvent("JOB_SELECTED", "ok"));
});

test("disabled wake and pre-admission QStash failure are explicit without SQL access", async t => {
  environment(t); const rows = capture(t);
  let queries = 0;
  override(t, prisma, "$transaction", async () => { queries++; throw Error("UNEXPECTED_SQL"); });
  process.env.SKILLQUEST_DISPATCH_ENABLED = "0";
  await wakeJobs();
  assert.ok(rows.some(r => r.event === "DISPATCH_FINISHED" && r.status === "disabled"));
  process.env.SKILLQUEST_DISPATCH_ENABLED = "1"; process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "0";
  await assert.rejects(configuredDispatch(), /QSTASH_REAL_TRANSPORT_DISABLED/);
  assert.equal(queries, 0);
  assert.ok(rows.some(r => r.event === "QSTASH_PUBLISH_SKIPPED" && r.code === "QSTASH_REAL_TRANSPORT_DISABLED"));
  assert.ok(!rows.some(r => r.event === "DB_LEASE_ACQUIRED"));
  assert.ok(rows.every(r => /^[a-f0-9-]{36}$/.test(r.dispatchId)));
});

test("admission logs failure then committed success in the same dispatch context", async t => {
  const rows = capture(t); const dispatchId = randomUUID(); let count = 0, committed = false;
  const db = { async $transaction(work: (tx: any) => Promise<void>) {
    count++;
    await work({ async $executeRawUnsafe() {}, async $queryRawUnsafe() {
      if (count === 1) throw Object.assign(new Error(secrets[0]), { code: "P2010", meta: { code: "55P03" } });
      return [{ singleton: 1 }];
    } });
    committed = true;
  } } as unknown as PrismaClient;
  await withOtpContext({ dispatchId }, () => acquireDispatchAdmission(db, randomUUID()));
  assert.equal(committed, true);
  assert.deepEqual(rows.map(r => [r.event, r.attempt, r.dispatchId]), [["DB_LEASE_FAILED", 1, dispatchId], ["DB_LEASE_ACQUIRED", 2, dispatchId]]);
});

test("publication links job selection and provider acceptance without changing envelope or quota", async t => {
  environment(t); const rows = capture(t);
  const jobId = randomUUID(), notificationId = randomUUID(), dispatchId = randomUUID(); let charged = 0;
  const intent = { id: notificationId, kind: "OTP_INITIAL", jobId, phase: "DELIVER", generation: 0, dueAt: new Date(), attempts: 1, attemptToken: randomUUID() };
  const db = { async $transaction(work: (tx: any) => Promise<unknown>) { return work({
    async $executeRawUnsafe() { return 1; },
    async $queryRawUnsafe(sql: string, ...args: any[]) {
      if (sql.startsWith("SELECT cursor")) return [{ cursor: 0 }];
      if (sql.includes('INSERT INTO "JobDispatchUsage"')) { assert.equal(args[0], 100); charged += 4; return [{ day: new Date() }]; }
      if (sql.startsWith("WITH clock")) return [intent];
      throw new Error("Unexpected query");
    },
  }); } } as unknown as PrismaClient;
  t.mock.method(globalThis, "fetch", async (_url: any, init?: RequestInit) => {
    assert.deepEqual(Object.keys(JSON.parse(String(init?.body))).sort(), ["version", "notificationId", "kind", "jobId", "phase", "generation", "dueAt"].sort());
    return Response.json({ messageId: secrets[0] }, { status: 201 });
  });
  const result = await withOtpContext({ dispatchId }, () => new JobPublications(db, undefined, 100).publishBatch(realQstashPublisher(), 1));
  assert.equal(result.published, 1); assert.equal(charged, 4);
  for (const event of ["JOB_SELECTED", "QSTASH_PUBLISH_STARTED", "QSTASH_PUBLISH_OK"]) {
    assert.ok(rows.some(r => r.event === event && r.traceId === jobId && r.dispatchId === dispatchId));
  }
  assert.ok(rows.some(r => r.code === "PROVIDER_ACCEPTED"));
});

test("empty publication selection is explicit and does not call a provider", async t => {
  const rows = capture(t); let sent = 0;
  const db = { async $transaction(work: (tx: any) => Promise<unknown>) { return work({ async $executeRawUnsafe() {},
    async $queryRawUnsafe(sql: string) { return sql.startsWith("SELECT cursor") ? [{ cursor: 0 }] : []; },
  }); } } as unknown as PrismaClient;
  await new JobPublications(db).publishBatch({ async publish() { sent++; } }, 1);
  assert.equal(sent, 0); assert.ok(rows.some(r => r.event === "NO_JOB_READY" && r.code === "NO_ELIGIBLE_JOB"));
});

test("OTP creation and reuse are logged after commit and retain the 409 contract", async t => {
  environment(t); const rows = capture(t);
  const { startEmailVerifiedParticipant } = await import("../src/services/participant-email.service.js");
  const requestId = randomUUID(), challengeId = randomUUID(); let jobId = "", reused = false, failCommit = false;
  const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  const challenge = () => ({ id: challengeId, jobId, attempts: 0, maxAttempts: 5, consumedAt: null, expiresAt, deliveryStatus: "PENDING", active: challengeId, nextIssueAt: new Date(now.getTime() + 60000), dbNow: now, lastErrorCode: null });
  override(t, prisma, "$transaction", async (work: (tx: any) => Promise<unknown>) => {
    const result = await work({
      async $executeRawUnsafe(sql: string, ...args: any[]) { if (sql.includes('INSERT INTO "ParticipantEmailDeliveryJob"')) jobId = args[0]; return 1; },
      async $queryRawUnsafe(sql: string) {
        if (sql.includes("SELECT clock_timestamp() AS now")) return [{ now }];
        if (sql.includes('INSERT INTO "ParticipantEmailGate"')) return [{ challengeId: reused ? challengeId : null, nextIssueAt: reused ? new Date(now.getTime() + 60000) : now }];
        if (sql.includes('SELECT c.*')) return [challenge()];
        if (sql.includes('INSERT INTO "EmailOtpChallenge"')) return [{ expiresAt, createdAt: now }];
        throw Error("Unexpected SQL");
      },
    });
    if (failCommit) throw Object.assign(new Error(secrets[0]), { code: "P2010", meta: { code: "42501" } });
    assert.ok(!rows.some(r => r.event === "OTP_JOB_CREATED" && r.traceId === jobId));
    return result;
  });
  override(t, prisma, "$queryRawUnsafe", async () => [challenge()]);
  const profile = { fullName: "Fixture", email: secrets[0], language: "fr" as const, emailReport: false };
  const result = await withOtpContext({ requestId }, () => startEmailVerifiedParticipant(profile));
  assert.equal(result.status, 409); assert.equal(result.body.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.ok(!("traceId" in result.body));
  assert.ok(rows.some(r => r.event === "OTP_JOB_CREATED" && r.traceId === jobId && r.requestId === requestId));
  reused = true;
  // Drop the commit-order check's prior creation record before the reused request.
  rows.length = 0;
  const second = await withOtpContext({ requestId: randomUUID() }, () => startEmailVerifiedParticipant(profile));
  assert.equal(second.status, 409);
  assert.ok(rows.some(r => r.event === "OTP_JOB_REUSED" && r.traceId === jobId));
  rows.length = 0; reused = false; failCommit = true;
  await assert.rejects(startEmailVerifiedParticipant(profile));
  assert.ok(!rows.some(r => r.event === "OTP_JOB_CREATED"));
  assert.ok(rows.some(r => r.event === "OTP_JOB_FAILED" && r.code === "DB_42501"));
});

function workerFixture(t: TestContext, options: { persistFailure?: boolean; zeroRows?: boolean; providerStatus?: number; duplicate?: boolean } = {}) {
  environment(t);
  const jobId = randomUUID(), challengeId = randomUUID(), now = new Date();
  const payload = { recipient: secrets[0], recipientName: "Fixture", subject: "Fixture", htmlContent: `<p>${secrets[1]}</p>` };
  const job = { id: jobId, challengeId, codeHash: "fixture", status: "PENDING", encryptedPayload: encryptOtpPayload(payload, jobId), attempts: 0, attemptToken: null as string | null, expiresAt: new Date(now.getTime() + 600000) };
  let sends = 0;
  override(t, prisma, "$transaction", async (work: (tx: any) => Promise<unknown>) => work({
    async $executeRawUnsafe(sql: string, ...args: any[]) {
      if (sql.includes('AS job SET status=\'ACCEPTED\'')) return 0;
      if (sql.includes("attempts=attempts+1")) job.attemptToken = args[1];
      return 1;
    },
    async $queryRawUnsafe(sql: string) {
      if (sql.includes("SELECT clock_timestamp() AS now")) return [{ now }];
      if (sql.includes("SELECT * FROM")) return [job];
      if (sql.includes('SELECT status FROM "EmailBudgetReservation"')) return [];
      if (sql.includes("SELECT c.id") || sql.includes("SELECT j.id")) return [{ id: challengeId }];
      throw Error("Unexpected query");
    },
  }));
  override(t, prisma, "$executeRawUnsafe", async () => {
    if (options.persistFailure) throw Object.assign(new Error(secrets.join(" ")), { code: "P2010", meta: { code: "42501" } });
    return options.zeroRows ? 0 : 1;
  });
  override(t, prisma, "$queryRawUnsafe", async () => options.persistFailure ? [{ status: "ACCEPTED" }] : []);
  t.mock.method(EmailBudget.prototype, "claim", async (_input: any, beforeClaim?: any) => {
    if (beforeClaim) await beforeClaim({ async $queryRawUnsafe() { return [{ id: jobId }]; } }, now);
    return { id: randomUUID(), token: randomUUID(), duplicate: options.duplicate ?? false };
  });
  t.mock.method(EmailBudget.prototype, "finish", async () => {});
  t.mock.method(globalThis, "fetch", async () => { sends++; return Response.json({ messageId: secrets[0], message: secrets[2] }, { status: options.providerStatus ?? 201 }); });
  return { jobId, job, sends: () => sends };
}

test("worker, real-shaped mocked Brevo acceptance and final persisted state share the job trace", async t => {
  const fixture = workerFixture(t), rows = capture(t);
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 1);
  for (const event of ["WORKER_RECEIVED", "JOB_SELECTED", "BREVO_SEND_STARTED", "BREVO_SEND_OK", "OTP_DELIVERY_STATUS", "WORKER_FINISHED"]) {
    assert.ok(rows.some(r => r.event === event && r.traceId === fixture.jobId), event);
  }
  assert.ok(rows.some(r => r.event === "OTP_DELIVERY_STATUS" && r.deliveryState === "ACCEPTED" && r.code === "STATE_PERSISTED"));
  assert.ok(rows.some(r => r.code === "DELIVERY_NOT_OBSERVABLE"));
});

test("Brevo acceptance followed by SQL failure never claims a persisted final status", async t => {
  const fixture = workerFixture(t, { persistFailure: true }), rows = capture(t);
  await assert.rejects(processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" }));
  assert.ok(rows.some(r => r.event === "BREVO_SEND_OK"));
  assert.ok(rows.some(r => r.event === "OTP_STATUS_PERSIST_FAILED" && r.code === "DB_42501"));
  assert.ok(!rows.some(r => r.deliveryState === "ACCEPTED" && r.code === "STATE_PERSISTED"));
});

test("lost job lease does not announce a persisted state", async t => {
  const fixture = workerFixture(t, { zeroRows: true }), rows = capture(t);
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.ok(rows.some(r => r.event === "OTP_STATUS_PERSIST_FAILED" && r.code === "LEASE_LOST"));
  assert.ok(!rows.some(r => r.deliveryState === "ACCEPTED"));
});

test("already accepted budget reservation skips transport without changing worker behavior", async t => {
  const fixture = workerFixture(t, { duplicate: true }), rows = capture(t);
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 0);
  assert.ok(rows.some(r => r.event === "BREVO_SEND_SKIPPED" && r.code === "ALREADY_ACCEPTED"));
  assert.ok(!rows.some(r => r.event === "BREVO_SEND_STARTED"));
});

test("quota refusal is visible, preserves safe code and never calls Brevo", async t => {
  const fixture = workerFixture(t), rows = capture(t);
  t.mock.method(EmailBudget.prototype, "claim", async () => { throw new EmailLimitError("EMAIL_LOCAL_LIMIT"); });
  await assert.rejects(sendReportEmail({ recipient: secrets[0], recipientName: "Fixture", subject: "Fixture", htmlContent: secrets[1], idempotencyKey: fixture.jobId, purpose: "OTP" }), e => e instanceof ReportEmailError && e.code === "EMAIL_LOCAL_LIMIT");
  assert.equal(fixture.sends(), 0);
  assert.ok(rows.some(r => r.event === "BREVO_SEND_SKIPPED" && r.code === "EMAIL_LOCAL_LIMIT"));
});

test("provider rejection logs safe technical code and keeps deferred status semantics", async t => {
  const fixture = workerFixture(t, { providerStatus: 429 }), rows = capture(t);
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 1);
  assert.ok(rows.some(r => r.event === "BREVO_SEND_FAILED" && r.code === "BREVO_RATE_LIMIT"));
  assert.ok(rows.some(r => r.event === "OTP_DELIVERY_STATUS" && r.deliveryState === "PENDING"));
});

test("unreadable ciphertext pauses the existing job without sending or leaking its contents", async t => {
  const fixture = workerFixture(t), rows = capture(t);
  fixture.job.encryptedPayload = secrets[3];
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 0);
  assert.ok(rows.some(r => r.event === "BREVO_SEND_SKIPPED" && r.code === "OTP_PAYLOAD_VERSION_UNSUPPORTED"));
  assert.ok(rows.some(r => r.event === "OTP_DELIVERY_STATUS" && r.deliveryState === "PENDING"));
});

test("worker disabled provider is explicit without incrementing a transport attempt", async t => {
  const fixture = workerFixture(t), rows = capture(t);
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "0";
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 0);
  assert.ok(rows.some(r => r.event === "BREVO_SEND_SKIPPED" && r.status === "disabled"));
});

test("a broken logging sink does not interrupt the complete worker attempt", async t => {
  const fixture = workerFixture(t);
  t.mock.method(console, "info", () => { throw new Error("sink unavailable"); });
  await processJob({ kind: "OTP_INITIAL", jobId: fixture.jobId, phase: "DELIVER" });
  assert.equal(fixture.sends(), 1);
});

test("retirement reports per-job final status only after commit, never after rollback", async t => {
  const rows = capture(t); const jobId = randomUUID(); let failCommit = false;
  const db = { async $transaction(work: (tx: any) => Promise<unknown>) {
    const result = await work({ async $executeRawUnsafe() { return 0; }, async $queryRawUnsafe(sql: string) {
      assert.ok(sql.includes("RETURNING j.id,j.status"));
      return sql.includes('"ParticipantEmailDeliveryJob"') ? [{ id: jobId, status: "REJECTED" }] : [];
    } });
    assert.equal(rows.length, 0);
    if (failCommit) throw Error("commit failure");
    return result;
  } } as unknown as PrismaClient;
  assert.deepEqual(await new JobPublications(db).retire(12), { reports: 0, otp: 1, summaries: 0 });
  assert.ok(rows.some(r => r.event === "OTP_DELIVERY_STATUS" && r.traceId === jobId && r.deliveryState === "REJECTED"));
  rows.length = 0; failCommit = true;
  await assert.rejects(new JobPublications(db).retire(12));
  assert.equal(rows.length, 0);
});

test("callback logs correlate only authenticated envelopes and preserve deferred HTTP 503", async t => {
  environment(t); const rows = capture(t);
  Object.assign(process.env, { SKILLQUEST_QSTASH_MODE: "simulated", QSTASH_CURRENT_SIGNING_KEY: qstashCurrent,
    QSTASH_NEXT_SIGNING_KEY: qstashNext, QSTASH_CALLBACK_URL: qstashUrl, SKILLQUEST_DISPATCH_ENABLED: "0" });
  delete process.env.VERCEL;
  let consumed = 0;
  const app = express(); app.use(qstashRouter(async () => { consumed++; return "DEFERRED"; }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const jobId = randomUUID(), notificationId = randomUUID();
  const raw = JSON.stringify({ version: 1, kind: "OTP_INITIAL", phase: "DELIVER", jobId, notificationId, generation: 0, dueAt: new Date().toISOString() });
  const url = `http://127.0.0.1:${address.port}/api/internal/jobs/qstash`;
  try {
    let response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "upstash-signature": "forged" }, body: raw });
    assert.equal(response.status, 401); assert.equal(consumed, 0);
    assert.ok(!rows.some(r => r.traceId === jobId));
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "upstash-signature": signQstash(raw) }, body: raw });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { disposition: "DEFERRED" });
    assert.equal(response.headers.get("retry-after"), "30"); assert.equal(consumed, 1);
    assert.ok(rows.some(r => r.event === "WORKER_RECEIVED" && r.traceId === jobId && r.notificationId === notificationId));
    assert.ok(rows.some(r => r.event === "WORKER_FINISHED" && r.code === "DEFERRED" && r.status === "waiting"));
    assert.ok(rows.some(r => r.event === "DISPATCH_FINISHED" && r.traceId === jobId && r.dispatchId && r.status === "disabled"));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
