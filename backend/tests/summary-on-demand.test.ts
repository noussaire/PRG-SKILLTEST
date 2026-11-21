import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { reportPdfRenderer } from "../src/services/report-pdf.service.js";
import { buildReportEmail } from "../src/services/report-email-template.js";

let db: PGlite, socket: PGLiteSocketServer, prisma: PrismaClient, server: Server, base: string;
let queue: typeof import("../src/services/report-queue.service.js");
const realFetch = globalThis.fetch;
let externalCalls = 0;
before(async () => {
  process.env.DOTENV_CONFIG_PATH = "__no_environment_file_for_local_tests__";
  db = await PGlite.create();
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "local-summary-only-0123456789abcdef";
  for (const key of ["GROQ_API_KEY", "BREVO_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) process.env[key] = "";
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = randomUUID();
  // Fixed local fixture only; never written to a deployment or environment file.
  process.env.SKILLQUEST_STAGING_SECRET = Buffer.alloc(32, 87).toString("base64url");
  await db.query('INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1,current_database())', [process.env.SKILLQUEST_STAGING_ID]);
  ({ prisma } = await import("../src/db/prisma.js"));
  queue = await import("../src/services/report-queue.service.js");
  const { adaptiveRouter } = await import("../src/routes/adaptive.routes.js");
  const { adminAdaptiveRouter } = await import("../src/routes/admin/adaptive.routes.js");
  const { hashAdminToken } = await import("../src/security/adminAuth.js");
  const admin = await prisma.user.create({ data: { email: "admin@example.test", role: "ADMIN" } });
  await prisma.adminSession.create({ data: { userId: admin.id, tokenHash: hashAdminToken("a".repeat(64)), expiresAt: new Date(Date.now() + 86400000) } });
  const app = express(); app.use(express.json()); app.use("/student", adaptiveRouter); app.use("/admin", adminAdaptiveRouter);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = ((input, init) => {
    if (!String(input).startsWith(base + "/")) { externalCalls++; throw Error("EXTERNAL_NETWORK_FORBIDDEN"); }
    return realFetch(input, init);
  }) as typeof fetch;
}, { timeout: 60000 });
after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await prisma?.$disconnect(); await socket?.stop(); await db?.close();
});
async function fixture(language: "fr" | "ar" = "fr") {
  const { hashGuestToken } = await import("../src/security/tokens.js");
  let state = createPreparedInterview(language);
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const row = await prisma.adaptiveInterview.create({ data: { displayName: "SYNTH-summary", tokenHash: hashGuestToken(token), state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
  return { row, token };
}
const request = (path: string, token?: string, method = "GET") => fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

for (const lang of ["fr", "ar"] as const) test(`${lang}: read-only GET, explicit concurrent POST, persisted student/admin report and real local PDF`, async () => {
  const { row, token } = await fixture(lang);
  assert.equal((await request("/student/me/summary", undefined, "POST")).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await request("/student/me", token)).status, 200);
  assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: row.id } }), 0);
  const fallback = await reportPdfRenderer.render(row, { status: "PENDING", summary: null, nextAttemptAt: new Date() });
  assert.equal(fallback.subarray(0, 5).toString(), "%PDF-");
  assert.throws(() => buildReportEmail(row, { status: "PENDING", summary: null, nextAttemptAt: new Date() }), { code: "EMAIL_REPORT_NOT_READY" });
  const responses = await Promise.all(Array.from({ length: 4 }, () => request("/student/me/summary", token, "POST")));
  assert.ok(responses.every(r => r.status === 200));
  const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: row.id } });
  assert.equal(job.status, "COMPLETE"); assert.equal(job.attempts, 1);
  const summaries = JSON.parse(job.summary!);
  assert.match(summaries.fr, /sans appel IA/); assert.match(summaries.ar, /[\u0600-\u06ff]/);
  for (const locale of ["fr", "ar"]) {
    const student = await (await request(`/student/me?lang=${locale}`, token)).json();
    assert.equal(student.report.summary, summaries[locale]); assert.equal(student.report.skills.length, 31);
    const admin = await (await request(`/admin/participants/${row.id}?lang=${locale}`, "a".repeat(64))).json();
    assert.ok(JSON.stringify(admin).includes(summaries[locale]));
  }
  const pdf = await reportPdfRenderer.render(row, job); assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buildReportEmail(row, job).htmlContent.includes(summaries[lang]));
  await request("/student/me/summary", token, "POST");
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).attempts, 1);
  assert.deepEqual((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: row.id } })).state, row.state);
  assert.equal(externalCalls, 0);
});

test("old jobs respect retry dates, active leases and a durable three-attempt ceiling including crashes", async () => {
  const { row, token } = await fixture(); const job = (await queue.enqueueReport(row.id))!;
  for (const data of [
    { status: "RETRY", nextAttemptAt: new Date(Date.now() + 60000), attempts: 1 },
    { status: "PROCESSING", leaseUntil: new Date(Date.now() + 60000), attempts: 2 },
  ]) {
    await prisma.adaptiveReportJob.update({ where: { id: job.id }, data });
    await request("/student/me/summary", token, "POST");
    assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).attempts, data.attempts);
  }
  await prisma.adaptiveReportJob.update({ where: { id: job.id }, data: { status: "PROCESSING", leaseUntil: new Date(0), attempts: 3 } });
  for (let i = 0; i < 5; i++) await request("/student/me/summary", token, "POST");
  const stopped = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(stopped.status, "UNAVAILABLE"); assert.equal(stopped.attempts, 3); assert.equal(externalCalls, 0);
});

test("SYNTH name alone never enables simulation; invalid staging fails closed", async () => {
  const { row } = await fixture();
  process.env.SKILLQUEST_STAGING_MODE = "off";
  try { assert.equal(await queue.enqueueReport(row.id), null); }
  finally { process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1"; }
  process.env.SKILLQUEST_STAGING_ACK = "invalid";
  try { await assert.rejects(queue.enqueueReport(row.id), { code: "SYNTHETIC_STAGING_UNAVAILABLE" }); }
  finally { process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS"; }
  assert.equal(externalCalls, 0);
});

test("unfinished and expired participants cannot trigger generation", async () => {
  const { row, token } = await fixture();
  await prisma.adaptiveInterview.update({ where: { id: row.id }, data: { state: createPreparedInterview("fr") as unknown as Prisma.InputJsonValue } });
  assert.equal((await request("/student/me/summary", token, "POST")).status, 409);
  await prisma.adaptiveInterview.update({ where: { id: row.id }, data: { expiresAt: new Date(0), state: row.state as Prisma.InputJsonValue } });
  assert.equal((await request("/student/me/summary", token, "POST")).status, 401);
  assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: row.id } }), 0);
});

test("synthetic validation failure retries only three times without falling back to Groq", async () => {
  const { row, token } = await fixture();
  const job = (await queue.enqueueReport(row.id))!;
  const originalId = process.env.SKILLQUEST_STAGING_ID;
  process.env.SKILLQUEST_STAGING_ID = randomUUID(); // Valid config, wrong installation marker.
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await prisma.adaptiveReportJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
      await request("/student/me/summary", token, "POST");
      const saved = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(saved.attempts, attempt);
      assert.equal(saved.status, attempt < 3 ? "RETRY" : "UNAVAILABLE");
      const view = await (await request("/student/me", token)).json();
      assert.equal(view.report.summarySource, "rules"); assert.equal(view.report.skills.length, 31);
    }
    await request("/student/me/summary", token, "POST");
    assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).attempts, 3);
  } finally { process.env.SKILLQUEST_STAGING_ID = originalId; }
  assert.equal(externalCalls, 0);
});

test("admin summary generation: authenticated admin can generate summary for finished participant", async () => {
  const { row } = await fixture("fr");
  // 1. Without admin token -> 401
  assert.equal((await request(`/admin/participants/${row.id}/summary`, undefined, "POST")).status, 401);
  // 2. Incomplete participant -> 409
  const incomplete = await prisma.adaptiveInterview.create({
    data: {
      displayName: "SYNTH-incomplete",
      tokenHash: "fakehash1",
      state: createPreparedInterview("fr") as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert.equal((await request(`/admin/participants/${incomplete.id}/summary`, "a".repeat(64), "POST")).status, 409);
  // 3. Expired participant -> 410
  const expired = await prisma.adaptiveInterview.create({
    data: {
      displayName: "SYNTH-expired",
      tokenHash: "fakehash2",
      state: row.state as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(0),
    },
  });
  assert.equal((await request(`/admin/participants/${expired.id}/summary`, "a".repeat(64), "POST")).status, 410);
  // 4. Finished participant -> 200, status COMPLETE, admin participant detail refreshed with summary
  const res = await request(`/admin/participants/${row.id}/summary?lang=fr`, "a".repeat(64), "POST");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.participant.id, row.id);
  assert.equal(data.participant.aiStatus, "COMPLETE");
  assert.equal(data.participant.status, "COMPLETED");
  assert.ok(data.interview.report.summary);
  const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: row.id } });
  assert.equal(job.status, "COMPLETE");
  assert.equal(externalCalls, 0);
});
