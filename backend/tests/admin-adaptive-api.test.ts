import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import type { Server } from "node:http";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
let db: PGlite, socket: PGLiteSocketServer, http: Server, prisma: PrismaClient, base: string, completeId: string, partialId: string;
const adminToken = "a".repeat(64), studentToken = "b".repeat(64), expiredToken = "c".repeat(64);
const realFetch = globalThis.fetch.bind(globalThis);
let providerCalls = 0;
async function request(path: string, token?: string) {
  const response = await fetch(`${base}/api/v1/admin/adaptive${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, body: await response.json() as any };
}
before(async () => {
  db = await PGlite.create(); const migrations = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL; process.env.NODE_ENV = "test"; process.env.JOIN_CODE_PEPPER = "isolated-admin-test-only-0123456789abcdef"; process.env.GROQ_API_KEY = "";
  ({ prisma } = await import("../src/db/prisma.js"));
  const { hashAdminToken } = await import("../src/security/adminAuth.js");
  const admin = await prisma.user.create({ data: { email: "admin@example.test", role: "ADMIN" } });
  const student = await prisma.user.create({ data: { email: "student@example.test", role: "STUDENT" } });
  for (const [token, userId, expiry] of [[adminToken, admin.id, Date.now() + 86400000], [studentToken, student.id, Date.now() + 86400000], [expiredToken, admin.id, 0]] as const) await prisma.adminSession.create({ data: { userId, tokenHash: hashAdminToken(token), expiresAt: new Date(expiry) } });
  for (const [index, name] of ["Amine", "Salma", "En cours"].entries()) {
    let state = createPreparedInterview(index === 1 ? "ar" : "fr");
    if (index < 2) while (state.currentQuestion) {
      const q = state.currentQuestion;
      const selected = q.choices!.find(choice => q.rubric![choice.id].level === (index === 0 ? 4 : 1))!;
      state = advancePreparedInterview(state, { questionId: q.id, choiceId: selected.id });
    }
    if (index === 1) state.answers.find(answer => answer.question.skillId === "communication")!.assessment.level = null;
    const row = await prisma.adaptiveInterview.create({ data: { tokenHash: String(index).repeat(64), displayName: name, email: index === 0 ? "amine@campus.example.test" : null, state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(index === 0 ? 0 : Date.now() + 86400000) } });
    if (index === 0) { completeId = row.id; await prisma.adaptiveReportJob.create({ data: { interviewId: row.id, status: "COMPLETE", summary: JSON.stringify({ fr: "Synthèse française", ar: "خلاصة عربية" }) } }); }
    if (index === 1) await prisma.adaptiveReportJob.create({ data: { interviewId: row.id, status: "RETRY", summary: null, nextAttemptAt: new Date(Date.now() + 3600000) } });
    if (index === 2) partialId = row.id;
  }
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("http://127.0.0.1:")) { providerCalls++; throw Error("No provider request permitted"); }
    return realFetch(input, init);
  }) as typeof fetch;
  const { app } = await import("../src/app.js"); http = app.listen(0, "127.0.0.1"); await once(http, "listening");
  const address = http.address(); if (!address || typeof address === "string") throw Error("Missing HTTP address"); base = `http://127.0.0.1:${address.port}`;
}, { timeout: 60000 });
after(async () => { globalThis.fetch = realFetch; http?.closeAllConnections(); if (http) await new Promise<void>(resolve => http.close(() => resolve())); await prisma?.$disconnect(); await socket?.stop(); await db?.close(); });

test("Adaptive administration requires an active administrator session on every endpoint", async () => {
  for (const path of ["/dashboard", "/participants", `/participants/${completeId}`]) {
    for (const token of [undefined, studentToken, expiredToken]) assert.equal((await request(path, token)).status, 401);
  }
});
test("KPIs count completed tests and actual AI summaries once; unfinished tests do not affect top skills", async () => {
  const result = await request("/dashboard?lang=ar", adminToken);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.kpis, { totalParticipants: 3, completedTests: 2, inProgressTests: 1, aiReports: 1, pendingAIReports: 1, completionRate: 67 });
  const communication = result.body.topSkills.find((skill: any) => skill.id === "communication");
  assert.equal(communication.participants, 1); assert.equal(communication.average, 4);
  for (const skill of result.body.topSkills) { assert.match(skill.label, /[\u0600-\u06ff]/); if (skill.id !== "communication") { assert.equal(skill.average, 2.5); assert.equal(skill.participants, 2); } }
});
test("Participant search, status, AI filters and pagination use adaptive interviews", async () => {
  const completed = await request("/participants?status=COMPLETED&limit=1&page=2", adminToken);
  assert.equal(completed.body.pagination.total, 2); assert.equal(completed.body.participants.length, 1);
  const ai = await request("/participants?ai=COMPLETE", adminToken); assert.equal(ai.body.pagination.total, 1); assert.equal(ai.body.participants[0].id, completeId);
  assert.equal((await request("/participants?ai=PENDING", adminToken)).body.pagination.total, 1);
  assert.equal((await request("/participants?search=ami", adminToken)).body.participants[0].displayName, "Amine");
  assert.equal((await request("/participants?search=campus.example.test", adminToken)).body.participants[0].email, "amine@campus.example.test");
  assert.equal((await request("/participants?search=absent", adminToken)).body.pagination.total, 0);
  assert.equal((await request("/participants?page=-1", adminToken)).status, 400);
});
test("An expired participant report remains available only to administrators, in both languages, without new AI requests", async () => {
  const before = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: completeId }, include: { reportJob: true } });
  const french = (await request(`/participants/${completeId}?lang=fr`, adminToken)).body;
  const arabic = (await request(`/participants/${completeId}?lang=ar`, adminToken)).body;
  assert.equal(french.interview.report.summary, "Synthèse française"); assert.equal(arabic.interview.report.summary, "خلاصة عربية");
  assert.equal(french.participant.email, "amine@campus.example.test");
  assert.equal(arabic.interview.report.skills.length, 31); assert.equal(arabic.interview.transcript.length, 31);
  assert.ok(!JSON.stringify(arabic).includes("tokenHash") && !JSON.stringify(arabic).includes("rubric"));
  assert.deepEqual(await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: completeId }, include: { reportJob: true } }), before);
  const partial = (await request(`/participants/${partialId}`, adminToken)).body;
  assert.equal(partial.participant.email, null);
  assert.equal(partial.interview.report, null); assert.equal(partial.interview.currentQuestion.choices.length, 4); assert.ok(!JSON.stringify(partial).includes("rubric"));
  assert.equal((await request("/participants/not-an-id", adminToken)).status, 400);
  assert.equal((await request(`/participants/${"ffffffff-ffff-4fff-afff-ffffffffffff"}`, adminToken)).status, 404);
  assert.equal(providerCalls, 0);
});

test("Only an active administrator can delete one participation; report and pending email cascade", async () => {
  const remove = async (id: string, token?: string) => {
    const response = await fetch(`${base}/api/v1/admin/adaptive/participants/${id}`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return response.status;
  };
  for (const token of [undefined, studentToken, expiredToken]) assert.equal(await remove(completeId, token), 401);
  assert.ok(await prisma.adaptiveInterview.findUnique({ where: { id: completeId } }));
  assert.equal(await remove("not-an-id", adminToken), 400);
  await prisma.adaptiveReportJob.update({ where: { interviewId: completeId }, data: { emailStatus: "PENDING" } });
  assert.equal(await remove(completeId, adminToken), 200);
  assert.equal(await prisma.adaptiveInterview.findUnique({ where: { id: completeId } }), null);
  assert.equal(await prisma.adaptiveReportJob.findUnique({ where: { interviewId: completeId } }), null);
  assert.ok(await prisma.adaptiveInterview.findUnique({ where: { id: partialId } }));
  assert.equal((await request(`/participants/${completeId}`, adminToken)).status, 404);
  assert.equal(await remove(completeId, adminToken), 404);
  assert.equal((await request("/dashboard", adminToken)).body.kpis.totalParticipants, 2);
  assert.equal(providerCalls, 0);
});
