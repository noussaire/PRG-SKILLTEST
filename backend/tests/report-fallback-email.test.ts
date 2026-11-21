import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { buildReportEmail, escapeEmailHTML } from "../src/services/report-email-template.js";
import { reportPdfRenderer } from "../src/services/report-pdf.service.js";
import { interviewView } from "../src/services/adaptive.service.js";
import { openSyntheticMail } from "../src/security/synthetic-staging.js";
import { sendReportEmail } from "../src/services/brevo.service.js";

let db: PGlite | undefined, socket: PGLiteSocketServer | undefined, prisma: PrismaClient;
let processReportEmails: typeof import("../src/services/report-email-queue.service.js").processReportEmails;
let enqueueReport: typeof import("../src/services/report-queue.service.js").enqueueReport;
const realFetch = globalThis.fetch;
let externalCalls = 0;
before(async () => {
  process.env.DOTENV_CONFIG_PATH = "__local_fixture_only__";
  if (process.env.LOT4_NATIVE_CONTEXT) {
    const { connectLot4NativeDatabase } = await import("./helpers/native-postgres.js");
    const owned = await connectLot4NativeDatabase(); await owned.client.$disconnect();
  } else {
    db = await PGlite.create(); const root = new URL("../prisma/migrations/", import.meta.url);
    for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
    socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
  process.env.NODE_ENV = "test"; process.env.JOIN_CODE_PEPPER = "local-fallback-mail-tests-0123456789abcdef";
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300";
  process.env.EMAIL_APP_DAILY_LIMIT = "50";
  for (const key of ["GROQ_API_KEY", "BREVO_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) process.env[key] = "";
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = randomUUID();
  process.env.SKILLQUEST_STAGING_SECRET = Buffer.alloc(32, 91).toString("base64url");
  process.env.REPORT_EMAIL_LOGO_URL = "";
  ({ prisma } = await import("../src/db/prisma.js"));
  await prisma.$executeRawUnsafe('INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,current_database())', process.env.SKILLQUEST_STAGING_ID);
  ({ processReportEmails } = await import("../src/services/report-email-queue.service.js"));
  ({ enqueueReport } = await import("../src/services/report-queue.service.js"));
  globalThis.fetch = (() => { externalCalls++; throw Error("EXTERNAL_NETWORK_FORBIDDEN"); }) as typeof fetch;
}, { timeout: 60000 });
afterEach(async () => { await prisma.adaptiveInterview.deleteMany(); assert.equal(externalCalls, 0); });
after(async () => { globalThis.fetch = realFetch; await prisma?.$disconnect(); await socket?.stop(); await db?.close(); });

async function fixture(status = "UNAVAILABLE", language: "fr" | "ar" = "fr", email: string | null = `student-${randomUUID()}@example.test`, requested = true) {
  let state = createPreparedInterview(language);
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const row = await prisma.adaptiveInterview.create({ data: { displayName: "SYNTH-rapport", email, reportEmailRequested: requested,
    tokenHash: randomUUID().replaceAll("-", "").repeat(2), state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
  const initial = (await enqueueReport(row.id))!;
  const job = await prisma.adaptiveReportJob.update({ where: { id: initial.id }, data: { status, summary: status === "COMPLETE" ? JSON.stringify({ fr: "Synthèse simulée validée.", ar: "خلاصة محاكاة معتمدة." }) : null } });
  return { row, job, state };
}
async function mail(id: string) {
  const rows = await prisma.$queryRawUnsafe<{ ciphertext: string }[]>('SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid', id);
  return rows[0] ? openSyntheticMail(id, rows[0].ciphertext) as { htmlContent: string; recipient: string; simulated: boolean; attachments: { name: string; bytes: number }[] } : null;
}

test("synthetic mailbox accepts a bounded full report without external transport", async () => {
  const { row, job } = await fixture();
  const { simulateEmail } = await import("../src/services/synthetic-providers.service.js");
  assert.equal((await simulateEmail(prisma, { ...buildReportEmail(row, job), recipient: row.email!, recipientName: row.displayName, idempotencyKey: job.id, purpose: "REPORT" })).outcome, "ACCEPTED");
  assert.ok(await mail(job.id));
});

for (const language of ["fr", "ar"] as const) for (const status of ["COMPLETE", "UNAVAILABLE"]) test(`${status} ${language}: simulated email preserves the selected summary, 31 skills and a real local PDF, once`, async () => {
  const { row, job, state } = await fixture(status, language);
  const before = interviewView({ ...row, state }, job).report!;
  assert.equal(before.emailStatus, "PENDING");
  const candidates = await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM "JobPublicationReady" WHERE "jobId"=$1::uuid AND phase=\'EMAIL\'', job.id);
  assert.equal(candidates.length, 1);
  await Promise.all([processReportEmails(job.id), processReportEmails(job.id)]);
  const saved = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(saved.emailStatus, "SENT", saved.emailLastErrorCode ?? "missing error code"); assert.equal(saved.emailAttempts, 1); assert.equal(saved.status, status);
  const message = (await mail(job.id))!;
  assert.ok(message.simulated); assert.equal(message.recipient, row.email);
  assert.ok(message.htmlContent.includes(escapeEmailHTML(before.summary).replace(/\r?\n/g, "<br>")));
  assert.equal(message.htmlContent.match(/<section /g)?.length, 31);
  assert.ok(message.htmlContent.includes(`lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}"`));
  if (status === "UNAVAILABLE") {
    assert.ok(message.htmlContent.includes(language === "fr" ? "Bilan pédagogique" : "خلاصة تربوية"));
    assert.ok(!message.htmlContent.includes(language === "fr" ? "Synthèse générée par IA" : "خلاصة مولدة بالذكاء الاصطناعي"));
  }
  assert.equal(message.attachments[0].name, "SkillQuest-rapport.pdf"); assert.ok(message.attachments[0].bytes > 1000);
  assert.ok(!message.htmlContent.includes(row.tokenHash));
  await processReportEmails(job.id);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailAttempts, 1);
  assert.deepEqual((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } })).state, row.state);
});

test("PENDING, RETRY and PROCESSING never prepare or send mail prematurely", async t => {
  const render = t.mock.method(reportPdfRenderer, "render", async () => { throw Error("Premature PDF"); });
  for (const status of ["PENDING", "RETRY", "PROCESSING"]) {
    const { row, job } = await fixture(status);
    assert.throws(() => buildReportEmail(row, job), { code: "EMAIL_REPORT_NOT_READY" });
    await processReportEmails(job.id);
    assert.equal(await mail(job.id), null);
    assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailAttempts, 0);
  }
  assert.equal(render.mock.callCount(), 0);
});

test("no address, absent consent, expiry and incomplete or invalid reports cannot send", async t => {
  const render = t.mock.method(reportPdfRenderer, "render", async () => { throw Error("Must not render"); });
  for (const args of [[null, true], [null, false], ["no-consent@example.test", false]] as const) {
    const { row, job, state } = await fixture("UNAVAILABLE", "fr", args[0], args[1]);
    assert.equal(job.emailStatus, "NOT_REQUESTED"); await processReportEmails(job.id);
    assert.equal(await mail(job.id), null);
    assert.equal(interviewView({ ...row, state }, job).report?.emailStatus, "NOT_REQUESTED");
  }
  const expired = await fixture(); await prisma.adaptiveInterview.update({ where: { id: expired.row.id }, data: { expiresAt: new Date(0) } });
  await processReportEmails(expired.job.id); assert.equal(await mail(expired.job.id), null);
  const incomplete = await fixture(); await prisma.adaptiveInterview.update({ where: { id: incomplete.row.id }, data: { state: createPreparedInterview("fr") as unknown as Prisma.InputJsonValue } });
  await processReportEmails(incomplete.job.id); assert.equal(await mail(incomplete.job.id), null);
  const invalid = await fixture("COMPLETE"); await prisma.adaptiveReportJob.update({ where: { id: invalid.job.id }, data: { summary: null } });
  await processReportEmails(invalid.job.id); assert.equal(await mail(invalid.job.id), null);
  assert.equal(render.mock.callCount(), 0);
});

test("consent revoked during PDF preparation blocks the transaction before simulated transport", async t => {
  const { row, job } = await fixture();
  t.mock.method(reportPdfRenderer, "render", async () => {
    await prisma.adaptiveInterview.update({ where: { id: row.id }, data: { reportEmailRequested: false } });
    return Buffer.from("%PDF-1.7\nLocal fixture");
  });
  await processReportEmails(job.id); assert.equal(await mail(job.id), null);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailLastErrorCode, "REPORT_OBSOLETE");
});

test("simulated lost response retries the same UUID without a second mailbox entry", async t => {
  const { job } = await fixture();
  t.mock.method(reportPdfRenderer, "render", async () => Buffer.from("%PDF-1.7\nLocal fixture"));
  await prisma.$executeRawUnsafe('INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES (\'EMAIL\',$1::uuid,\'ACCEPTED_RESPONSE_LOST\',1)', job.id);
  await processReportEmails(job.id);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailStatus, "RETRY");
  assert.ok(await mail(job.id));
  // Move the local retry clocks, never change the logical key or fingerprint.
  await prisma.adaptiveReportJob.update({ where: { id: job.id }, data: { emailNextAttemptAt: new Date(0) } });
  await processReportEmails(job.id);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailStatus, "SENT");
  assert.equal((await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count(*) FROM "SyntheticMail" WHERE id=$1::uuid', job.id))[0].count, 1n);
});

test("synthetic-v1 refuses real identities and a bad installation marker without external fallback", async () => {
  const input = { recipient: "someone@example.com", recipientName: "SYNTH-mail", idempotencyKey: randomUUID(), purpose: "REPORT" as const, subject: "Fixture", htmlContent: "<p>Fixture</p>" };
  await assert.rejects(sendReportEmail(input), { code: "SYNTHETIC_IDENTITY_REQUIRED" });
  const original = process.env.SKILLQUEST_STAGING_ID; process.env.SKILLQUEST_STAGING_ID = randomUUID();
  try { await assert.rejects(sendReportEmail({ ...input, recipient: "student@example.test" }), { code: "SYNTHETIC_STAGING_UNAVAILABLE" }); }
  finally { process.env.SKILLQUEST_STAGING_ID = original; }
});

test("no AI configuration can create a terminal fallback job only with an opted-in email destination", async () => {
  process.env.SKILLQUEST_STAGING_MODE = "off";
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1"; // transport remains mocked/forbidden
  process.env.BREVO_API_KEY = "local-fixture-only"; process.env.BREVO_SENDER_EMAIL = "sender@example.test";
  try {
    const { row } = await fixture("UNAVAILABLE");
    const saved = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: row.id } });
    assert.equal(saved.status, "UNAVAILABLE"); assert.equal(saved.lastErrorCode, "AI_NOT_CONFIGURED"); assert.equal(saved.attempts, 0);
    const { state } = await fixture("UNAVAILABLE");
    const withoutEmail = await prisma.adaptiveInterview.create({ data: { displayName: "SYNTH-no-email", tokenHash: randomUUID(), state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
    assert.equal(await enqueueReport(withoutEmail.id), null);
  } finally { process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1"; process.env.BREVO_API_KEY = ""; delete process.env.SKILLQUEST_ALLOW_REAL_BREVO; }
});

test("budget exhaustion and malformed attachment stop before simulated transport", async t => {
  const { job } = await fixture();
  t.mock.method(reportPdfRenderer, "render", async () => Buffer.from("%PDF-1.7\nFixture"));
  process.env.EMAIL_APP_DAILY_LIMIT = "0";
  try {
    await processReportEmails(job.id); assert.equal(await mail(job.id), null);
    assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailLastErrorCode, "EMAIL_LOCAL_LIMIT");
  } finally { process.env.EMAIL_APP_DAILY_LIMIT = "50"; }
  await assert.rejects(sendReportEmail({ recipient: "student@example.test", recipientName: "SYNTH-invalid-pdf", idempotencyKey: randomUUID(), purpose: "REPORT", subject: "Fixture", htmlContent: "Fixture", attachments: [{ name: "report.pdf", content: Buffer.from("not pdf").toString("base64") }] }), { code: "EMAIL_INVALID_ATTACHMENT" });
});
