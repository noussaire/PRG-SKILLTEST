import { test, before, after, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { buildReportEmail } from "../src/services/report-email-template.js";
import { brevoConfigured, sendReportEmail } from "../src/services/brevo.service.js";
import { interviewView } from "../src/services/adaptive.service.js";
import { reportPdfRenderer } from "../src/services/report-pdf.service.js";
import { ReportEmailError } from "../src/services/brevo.service.js";
import { EmailBudget } from "../src/services/email-budget.service.js";

let db: PGlite, socket: PGLiteSocketServer, prisma: PrismaClient;
let enqueueReport: typeof import("../src/services/report-queue.service.js").enqueueReport;
let processReportEmails: typeof import("../src/services/report-email-queue.service.js").processReportEmails;
let time = Date.now();
const summary = JSON.stringify({ fr: "Une synthèse IA pédagogique personnelle.", ar: "خلاصة تربوية شخصية بالذكاء الاصطناعي." });
const accepted = () => Response.json({ messageId: "<report-test@brevo.example>" }, { status: 201 });

before(async () => {
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300";
  db = await PGlite.create(); const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL; process.env.JOIN_CODE_PEPPER = "isolated-brevo-tests-only-0123456789abcdef"; process.env.NODE_ENV = "test";
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1";
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1";
  ({ prisma } = await import("../src/db/prisma.js"));
  ({ enqueueReport } = await import("../src/services/report-queue.service.js"));
  ({ processReportEmails } = await import("../src/services/report-email-queue.service.js"));
}, { timeout: 60000 });
beforeEach(async t => {
  time += 2 * 86400000;
  (t as TestContext).mock.method(EmailBudget.prototype, "transactionNow", async () => new Date(time));
  (t as TestContext).mock.method(reportPdfRenderer, "render", async () => Buffer.from("%PDF-1.7\nIsolated attachment fixture"));
  (t as TestContext).mock.method(Date, "now", () => time);
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1";
  process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1";
  process.env.BREVO_API_KEY = "test-brevo-private-key";
  process.env.BREVO_SENDER_EMAIL = "reports@example.test";
  process.env.BREVO_SENDER_NAME = "SkillQuest";
  await prisma.$executeRawUnsafe('TRUNCATE "AdaptiveInterview", "EmailBudgetReservation", "EmailAbuseCounter", "EmailOtpThrottle", "EmailProviderState" CASCADE');
});
afterEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "AdaptiveInterview", "EmailBudgetReservation", "EmailAbuseCounter", "EmailOtpThrottle", "EmailProviderState" CASCADE');
});
after(async () => { await prisma?.$disconnect(); await socket?.stop(); await db?.close(); });

async function fixture(options: { requested?: boolean; ready?: boolean; language?: "fr" | "ar" } = {}) {
  let state = createPreparedInterview(options.language ?? "fr");
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const row = await prisma.adaptiveInterview.create({ data: {
    displayName: "Participant email", email: "student@example.test", reportEmailRequested: options.requested ?? true,
    tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), state: state as unknown as Prisma.InputJsonValue,
    expiresAt: new Date(time + 7 * 86400000),
  } });
  const initial = (await enqueueReport(row.id))!;
  await prisma.adaptiveReportJob.update({ where: { id: initial.id }, data: { createdAt: new Date(time) } });
  const job = options.ready === false ? initial : await prisma.adaptiveReportJob.update({ where: { id: initial.id }, data: { status: "COMPLETE", summary, createdAt: new Date(time) } });
  return { row, state, job };
}

test("Only an AI-complete requested report is sent to the form address, once across concurrent ticks and refreshes", async t => {
  const { row, job, state } = await fixture();
  const provider = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(payload.to, [{ email: row.email, name: row.displayName }]);
    assert.equal(payload.headers.IdempotencyKey, job.id);
    assert.equal(payload.sender.email, "reports@example.test");
    assert.equal(payload.replyTo.email, "reports@example.test");
    assert.equal(payload.htmlContent.match(/<section /g).length, 31);
    assert.equal(payload.attachment.length, 1);
    assert.equal(payload.attachment[0].name, "SkillQuest-rapport.pdf");
    assert.ok(Buffer.from(payload.attachment[0].content, "base64").subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.ok(payload.htmlContent.includes("Une synthèse IA pédagogique personnelle."));
    assert.ok(!String(init?.body).includes(row.tokenHash));
    assert.ok(!String(init?.body).includes("test-brevo-private-key"));
    return accepted();
  });
  await Promise.all([processReportEmails(), processReportEmails()]);
  const sent = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(sent.emailStatus, "SENT"); assert.equal(sent.emailAttempts, 1); assert.ok(sent.emailAcceptedAt);
  assert.equal(interviewView({ ...row, state }, sent).report?.emailStatus, "SENT");
  await enqueueReport(row.id); time += 10000; await processReportEmails();
  assert.equal(provider.mock.callCount(), 1);
});

test("No email before AI completion, for historical reports, or when Brevo is not configured", async t => {
  const pending = await fixture({ ready: false }); const historical = await fixture({ requested: false });
  const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected external request"); });
  await processReportEmails(); assert.equal(provider.mock.callCount(), 0);
  assert.equal(historical.job.emailStatus, "NOT_REQUESTED");
  assert.equal(interviewView({ ...pending.row, state: pending.state }, pending.job).report?.emailStatus, "WAITING_AI");
  const requested = await fixture(); process.env.BREVO_API_KEY = ""; time += 10000;
  assert.equal(brevoConfigured(), false); await processReportEmails(); assert.equal(provider.mock.callCount(), 0);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: requested.job.id } })).emailStatus, "PENDING");
});

test("Arabic email contains the full Arabic report and HTML values are escaped", async () => {
  const { row, job } = await fixture({ language: "ar" });
  const rendered = buildReportEmail({ ...row, displayName: '<img src=x onerror="alert(1)">' }, { ...job, summary: JSON.stringify({ fr: "Synthèse", ar: "خلاصة <script>alert(1)</script>" }) });
  assert.ok(rendered.htmlContent.includes('lang="ar" dir="rtl"'));
  assert.equal(rendered.htmlContent.match(/<section /g)?.length, 31);
  assert.ok(rendered.htmlContent.includes("التواصل"));
  assert.ok(rendered.htmlContent.includes("&lt;script&gt;"));
  assert.ok(!rendered.htmlContent.includes("<script>")); assert.ok(!rendered.htmlContent.includes("<img src=x"));
  assert.ok(!rendered.htmlContent.includes("localhost")); assert.ok(!rendered.htmlContent.includes(row.tokenHash));
});

test("Timeout retries reuse the UUID; Brevo duplicate response completes without a second delivery", async t => {
  const { job } = await fixture(); const keys: string[] = [];
  const provider = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    keys.push(JSON.parse(String(init?.body)).headers.IdempotencyKey);
    if (keys.length === 1) throw Error("Connection interrupted after request");
    return Response.json({ code: "duplicate_parameter" }, { status: 400 });
  });
  await processReportEmails();
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailStatus, "RETRY");
  time += 31000; await processReportEmails();
  const sent = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(sent.emailStatus, "SENT"); assert.equal(provider.mock.callCount(), 2);
  assert.deepEqual(keys, [job.id, job.id]); assert.equal(sent.emailMessageId, null);
});

test("A worker restart after the safe retry window never resends an uncertain message", async t => {
  const { job } = await fixture(); const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("No response"); });
  await processReportEmails(); time += 11 * 60000; await processReportEmails();
  const unknown = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(unknown.emailStatus, "UNKNOWN"); assert.equal(provider.mock.callCount(), 1);
  assert.equal(unknown.emailLastErrorCode, "BREVO_ACCEPTANCE_UNKNOWN");
});

test("Expired worker leases recover using the same key inside its deduplication window", async t => {
  const { job } = await fixture();
  await prisma.adaptiveReportJob.update({ where: { id: job.id }, data: { emailStatus: "PROCESSING", emailLeaseUntil: new Date(time - 1000), emailAttemptWindowAt: new Date(time - 60000), emailAttempts: 1 } });
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ code: "duplicate_parameter" }, { status: 400 }));
  await processReportEmails(); assert.equal(provider.mock.callCount(), 1);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailStatus, "SENT");
});

test("Brevo daily credits pause the queue durably and keep reports available", async t => {
  const first = await fixture(), second = await fixture();
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ code: "not_enough_credits" }, { status: 402 }));
  await processReportEmails(); const retry = await prisma.adaptiveReportJob.findFirstOrThrow({ where: { emailStatus: "RETRY" } });
  assert.equal(retry.emailLastErrorCode, "BREVO_QUOTA"); assert.equal(retry.emailAttemptWindowAt, null);
  assert.ok(retry.emailNextAttemptAt.getTime() >= time + 86400000);
  time += 3600000; await processReportEmails(); assert.equal(provider.mock.callCount(), 1);
  assert.equal(interviewView({ ...first.row, state: first.state }, first.job).report?.skills.length, 31);
  assert.equal(interviewView({ ...second.row, state: second.state }, second.job).report?.summarySource, "ai");
  provider.mock.mockImplementation(async () => accepted()); time += 86400000;
  await prisma.adaptiveReportJob.updateMany({ data: { createdAt: new Date(time) } });
  await processReportEmails();
  assert.equal(provider.mock.callCount(), 2);
});

test("Rate limits respect Retry-After without marking a report as sent", async t => {
  await fixture(); const provider = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  await processReportEmails(); const retry = await prisma.adaptiveReportJob.findFirstOrThrow();
  assert.equal(retry.emailStatus, "RETRY"); assert.equal(retry.emailLastErrorCode, "BREVO_RATE_LIMIT");
  assert.equal(retry.emailNextAttemptAt.getTime(), time + 120000);
  time += 60000; await processReportEmails(); assert.equal(provider.mock.callCount(), 1);
});

test("Permanent errors remain honest; deleting a participant cancels pending delivery", async t => {
  const { job, row, state } = await fixture(); const provider = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await processReportEmails(); const failed = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(failed.emailStatus, "FAILED"); assert.equal(failed.emailAcceptedAt, null); assert.equal(failed.emailAttemptWindowAt, null);
  assert.equal(interviewView({ ...row, state }, failed).report?.emailStatus, "FAILED");
  const pending = await fixture(); await prisma.adaptiveInterview.delete({ where: { id: pending.row.id } }); time += 10000; await processReportEmails();
  assert.equal(provider.mock.callCount(), 1); assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: pending.row.id } }), 0);
});

test("A report without complete AI and invalid recipients never reach the provider", async t => {
  const { row, job } = await fixture({ ready: false });
  assert.throws(() => buildReportEmail(row, job), /EMAIL_REPORT_NOT_READY/);
  const provider = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected external request"); });
  await assert.rejects(sendReportEmail({ recipient: "bad\r\naddress", recipientName: "Test", idempotencyKey: randomUUID(), subject: "Test", htmlContent: "<p>Test</p>" }), /EMAIL_INVALID_RECIPIENT/);
  assert.equal(provider.mock.callCount(), 0);
});

test("A failed PDF is retried locally without calling Brevo or inventing an uncertain delivery", async t => {
  const { job } = await fixture();
  t.mock.method(reportPdfRenderer, "render", async () => { throw new ReportEmailError("REPORT_PDF_UNAVAILABLE", true, 60); });
  const provider = t.mock.method(globalThis, "fetch", async () => accepted());
  await processReportEmails();
  const pending = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(provider.mock.callCount(), 0); assert.equal(pending.emailStatus, "RETRY");
  assert.equal(pending.emailAttemptWindowAt, null); assert.equal(pending.emailLastErrorCode, "REPORT_PDF_UNAVAILABLE");
});

test("Deleting a participation during PDF preparation cancels the provider request", async t => {
  const { row } = await fixture();
  t.mock.method(reportPdfRenderer, "render", async () => { await prisma.adaptiveInterview.delete({ where: { id: row.id } }); return Buffer.from("%PDF-1.7\nFixture"); });
  const provider = t.mock.method(globalThis, "fetch", async () => accepted());
  await processReportEmails(); assert.equal(provider.mock.callCount(), 0);
});

test("Only HTTPS hosted logos are placed in the email and their attributes remain escaped", async () => {
  const { row, job } = await fixture(); const original = process.env.REPORT_EMAIL_LOGO_URL;
  try {
    process.env.REPORT_EMAIL_LOGO_URL = 'https://img.mailinblue.com/brand/logo.png?label="white"';
    assert.ok(buildReportEmail(row, job).htmlContent.includes("data-report-logo"));
    for (const invalid of ['http://localhost:3000/logo.png', 'javascript:alert(1)', 'https://user:private@example.test/logo.png']) {
      process.env.REPORT_EMAIL_LOGO_URL = invalid; assert.ok(!buildReportEmail(row, job).htmlContent.includes("data-report-logo"));
    }
  } finally { if (original === undefined) delete process.env.REPORT_EMAIL_LOGO_URL; else process.env.REPORT_EMAIL_LOGO_URL = original; }
});

test("Exhausted local budget prevents any Brevo transport call", async t => {
  const previous = process.env.EMAIL_APP_DAILY_LIMIT;
  process.env.EMAIL_APP_DAILY_LIMIT = "0";
  const provider = t.mock.method(globalThis, "fetch", async () => accepted());
  try {
    await assert.rejects(sendReportEmail({ recipient: "synthetic@example.test", recipientName: "Synthetic", idempotencyKey: randomUUID(), subject: "Synthetic", htmlContent: "<p>Synthetic</p>" }), /EMAIL_LOCAL_LIMIT/);
    assert.equal(provider.mock.callCount(), 0);
  } finally { if (previous === undefined) delete process.env.EMAIL_APP_DAILY_LIMIT; else process.env.EMAIL_APP_DAILY_LIMIT = previous; }
});

test("Simulated OTP 429 blocks report sends through the same durable circuit breaker", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  const message = { recipient: "synthetic@example.test", recipientName: "Synthetic", subject: "Synthetic", htmlContent: "<p>Synthetic</p>" };
  await assert.rejects(sendReportEmail({ ...message, purpose: "OTP", networkOrigin: "127.0.0.1", idempotencyKey: randomUUID() }), /BREVO_RATE_LIMIT/);
  await assert.rejects(sendReportEmail({ ...message, purpose: "REPORT", idempotencyKey: randomUUID() }), /BREVO_RATE_LIMIT/);
  assert.equal(provider.mock.callCount(), 1);
});

test("Simulated report quota blocks OTP sends without a second provider call", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ code: "not_enough_credits" }, { status: 402 }));
  const message = { recipient: "synthetic@example.test", recipientName: "Synthetic", subject: "Synthetic", htmlContent: "<p>Synthetic</p>" };
  await assert.rejects(sendReportEmail({ ...message, purpose: "REPORT", idempotencyKey: randomUUID() }), /BREVO_QUOTA/);
  await assert.rejects(sendReportEmail({ ...message, purpose: "OTP", networkOrigin: "127.0.0.1", idempotencyKey: randomUUID() }), /BREVO_QUOTA/);
  assert.equal(provider.mock.callCount(), 1);
});

test("PDF metadata changes do not create another logical budget reservation on retry", async t => {
  const { job } = await fixture(); let attempt = 0;
  t.mock.method(reportPdfRenderer, "render", async () => Buffer.from(`%PDF-1.7\nSynthetic metadata ${++attempt}`));
  const provider = t.mock.method(globalThis, "fetch", async () => {
    if (attempt === 1) throw Error("Simulated response lost");
    return Response.json({ code: "duplicate_parameter" }, { status: 400 });
  });
  await processReportEmails(); time += 31000; await processReportEmails();
  assert.equal(provider.mock.callCount(), 2);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailStatus, "SENT");
  assert.equal((await prisma.$queryRawUnsafe<{ count: number }[]>('SELECT count(*)::int AS count FROM "EmailBudgetReservation" WHERE "logicalKey"=$1', job.id))[0].count, 1);
});
