import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { interviewView } from "../src/services/adaptive.service.js";
let db: PGlite, socket: PGLiteSocketServer, prisma: PrismaClient;
let enqueueReport: typeof import("../src/services/report-queue.service.js").enqueueReport;
let processReportQueue: typeof import("../src/services/report-queue.service.js").processReportQueue;

before(async () => {
  db = await PGlite.create(); const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL; process.env.JOIN_CODE_PEPPER = "isolated-report-queue-only-0123456789abcdef"; process.env.NODE_ENV = "test";
  process.env.GROQ_API_KEY = "test-report-key"; process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1"; process.env.AI_DAILY_REQUEST_LIMIT = "400";
  ({ prisma } = await import("../src/db/prisma.js"));
  ({ enqueueReport, processReportQueue } = await import("../src/services/report-queue.service.js"));
}, { timeout: 60000 });
after(async () => { await prisma?.$disconnect(); await socket?.stop(); await db?.close(); });

async function fixture() {
  let state = createPreparedInterview("fr");
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const row = await prisma.adaptiveInterview.create({ data: { displayName: "private-name-not-sent", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
  const job = await enqueueReport(row.id);
  return { row, job: job!, state };
}

test("The complete report exists before AI; one queued call only enriches its summary", async t => {
  const { row, job, state } = await fixture();
  assert.equal(interviewView({ ...row, state }, job).report?.summarySource, "rules");
  const provider = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.ok(!String(init?.body).includes(row.displayName));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ fr: "Une synthèse IA pédagogique.", ar: "خلاصة تربوية بالذكاء الاصطناعي." }) } }] });
  });
  await Promise.all([processReportQueue(), processReportQueue()]);
  const completed = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(completed.status, "COMPLETE"); assert.equal(completed.attempts, 1); assert.equal(provider.mock.callCount(), 1);
  assert.equal(interviewView({ ...row, state }, completed).report?.summarySource, "ai");
  assert.deepEqual((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } })).state, row.state);
  await prisma.adaptiveInterview.delete({ where: { id: row.id } });
});

test("Provider quotas pause queued enrichment and keep full reports accessible", async t => {
  const now = Date.now(), clock = t.mock.method(Date, "now", () => now + 60000);
  const first = await fixture(), second = await fixture();
  const provider = t.mock.method(globalThis, "fetch", async () => new Response("quota", { status: 429, headers: { "Retry-After": "120" } }));
  await processReportQueue();
  const retry = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: first.job.id } });
  const pending = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: second.job.id } });
  assert.equal(retry.status, "RETRY"); assert.equal(retry.lastErrorCode, "AI_QUOTA_REACHED");
  assert.ok(pending.nextAttemptAt >= retry.nextAttemptAt);
  assert.equal(interviewView({ ...first.row, state: first.state }, retry).status, "COMPLETED");
  assert.equal(interviewView({ ...first.row, state: first.state }, retry).report?.skills.length, 31);
  await processReportQueue(); assert.equal(provider.mock.callCount(), 1);
  // Passing the in-memory gate still honors the persisted provider cooldown.
  clock.mock.mockImplementation(() => now + 3600000);
  await processReportQueue(); assert.equal(provider.mock.callCount(), 1);
  await prisma.adaptiveInterview.deleteMany({ where: { id: { in: [first.row.id, second.row.id] } } });
  assert.equal(await prisma.adaptiveReportJob.count(), 0);
});
