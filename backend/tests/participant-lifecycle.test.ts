import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";

let db: PGlite | undefined, socket: PGLiteSocketServer, server: Server, prisma: PrismaClient, nativeVerifier: PrismaClient | undefined, base: string, adminId: string;
let hashJoinCode: (s: string) => string, encryptCode: (s: string) => string;
const adminToken = "a".repeat(64), hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function api(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(base + "/api/v1" + path, { method, headers: {
    ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() as any };
}
before(async () => {
  if (process.env.LOT4_NATIVE_CONTEXT) {
    nativeVerifier = (await connectLot4NativeDatabase()).client;
  } else {
  db = await PGlite.create();
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const n of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()) await db.exec(await readFile(new URL(n + "/migration.sql", root), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 6 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=4`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "lifecycle-local-synthetic-0123456789abcdef";
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = randomUUID(); process.env.SKILLQUEST_STAGING_SECRET = Buffer.alloc(32, 7).toString("base64url");
  for (const k of ["GROQ_API_KEY", "BREVO_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) process.env[k] = "";
  ({ prisma } = await import("../src/db/prisma.js"));
  await prisma.$executeRawUnsafe(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,'postgres')`, process.env.SKILLQUEST_STAGING_ID);
  ({ hashJoinCode, encryptCode } = await import("../src/security/tokens.js"));
  const admin = await prisma.user.create({ data: { email: "admin@example.test", role: "ADMIN" } }); adminId = admin.id;
  await prisma.adminSession.create({ data: { userId: adminId, tokenHash: hash(adminToken), expiresAt: new Date(Date.now() + 86400000) } });
  const { app } = await import("../src/app.js"); server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(r => server.close(() => r()));
  await prisma?.$disconnect(); await socket?.stop();
  await nativeVerifier?.$disconnect();
  // Drain socket protocol work before disposing the embedded engine.
  await new Promise<void>(r => setImmediate(r));
  await db?.query("SELECT 1"); await db?.close();
});
async function session(capacity = 5) {
  const code = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const row = await prisma.assessmentSession.create({ data: { label: "SYNTH-LIFECYCLE", createdById: adminId, codeHash: hashJoinCode(code), codeCipher: encryptCode(code), status: "OPEN", maxParticipants: capacity } });
  return { row, code };
}
async function join(code: string, name = "SYNTH-Learner", registrationId = randomUUID()) {
  const input = { code, displayName: name, language: "fr", registrationId };
  const result = await api("/sessions/join", "POST", input); return { ...result, input };
}
async function mirror(token: string) { return prisma.participant.findUniqueOrThrow({ where: { guestTokenHash: hash(token) } }); }

test("missing/invalid registration IDs are rejected without creating any participation", async () => {
  const s = await session();
  for (const registrationId of [undefined, "bad"]) assert.equal((await api("/sessions/join", "POST", { code: s.code, displayName: "SYNTH-Test", registrationId })).status, 400);
  assert.equal(await prisma.participant.count({ where: { sessionId: s.row.id } }), 0);
});
test("eight simultaneous retries create one participation and recover the same bearer even when capacity is full", async () => {
  const s = await session(1), id = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => join(s.code, "SYNTH-Replay", id)));
  assert.equal(results.filter(r => r.status === 201).length, 1); assert.equal(results.filter(r => r.status === 200).length, 7);
  assert.equal(new Set(results.map(r => r.body.token)).size, 1); assert.equal(new Set(results.map(r => r.body.interviewId)).size, 1);
  assert.equal(await prisma.participant.count({ where: { sessionId: s.row.id } }), 1);
  assert.equal(await prisma.adaptiveInterview.count({ where: { sessionId: s.row.id } }), 1);
  assert.equal((await join(s.code, "SYNTH-Other")).status, 409);
  assert.equal((await join(s.code, "SYNTH-Replay", id)).status, 200); // lost-response/manual retry
  const first = results[0].body, question = first.interview.currentQuestion;
  assert.equal((await api("/adaptive/answer", "POST", { questionId: question.id, choiceId: question.choices[0].id }, first.token)).status, 200);
  assert.equal((await join(s.code, "SYNTH-Replay", id)).body.interview.answeredCount, 1);
});
test("homonyms with different intentions remain independent; a key cannot change its name or session", async () => {
  const s = await session(), id = randomUUID(); const a = await join(s.code, "SYNTH-Same", id), b = await join(s.code, "SYNTH-Same");
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.notEqual(a.body.token, b.body.token);
  assert.equal((await join(s.code, "SYNTH-Changed", id)).status, 409);
  const other = await session(); assert.equal((await join(other.code, "SYNTH-Same", id)).status, 409);
});
test("one key racing across two sessions never creates two participants", async () => {
  const a = await session(), b = await session(), id = randomUUID();
  const results = await Promise.all([join(a.code, "SYNTH-Cross-Session", id), join(b.code, "SYNTH-Cross-Session", id)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await prisma.participant.count({ where: { sessionId: { in: [a.row.id, b.row.id] } } }), 1);
});
test("revocation denies every protected adaptive endpoint and fences a pending response, while admin/other participant retain access", async () => {
  const s = await session(), a = await join(s.code), b = await join(s.code, "SYNTH-Control");
  const p = await mirror(a.body.token), lease = new Date(Date.now() + 15000);
  const before = await prisma.adaptiveInterview.update({ where: { id: a.body.interviewId }, data: { busyUntil: lease } });
  assert.equal((await api(`/admin/participants/${p.id}/revoke`, "POST", undefined, adminToken)).status, 200);
  for (const [path, method] of [["/adaptive/me", "GET"], ["/adaptive/me/report.pdf", "GET"], ["/adaptive/me/summary", "POST"], ["/adaptive/answer", "POST"], ["/adaptive/choices", "POST"]]) {
    assert.equal((await api(path, method, method === "POST" ? {} : undefined, a.body.token)).status, 401, path);
  }
  assert.equal((await prisma.adaptiveInterview.updateMany({ where: { id: before.id, revision: before.revision, busyUntil: lease, expiresAt: { gt: new Date() } }, data: { revision: { increment: 1 } } })).count, 0);
  assert.equal((await api("/adaptive/me", "GET", undefined, b.body.token)).status, 200);
  assert.equal((await api(`/admin/adaptive/participants/${before.id}`, "GET", undefined, adminToken)).status, 200);
  assert.equal((await join(s.code, a.input.displayName, a.input.registrationId)).status, 401);
});
test("historical revocation without an expired AdaptiveInterview is also enforced", async () => {
  const s = await session(), a = await join(s.code); const p = await mirror(a.body.token);
  await prisma.participant.update({ where: { id: p.id }, data: { revokedAt: new Date() } });
  assert.equal((await api("/adaptive/me", "GET", undefined, a.body.token)).status, 401);
});
test("deletion anonymizes only the mirror, clears identity linkage, removes report/jobs and cannot resurrect the bearer", async () => {
  const s = await session(), a = await join(s.code, "SYNTH-Personal-Name"), b = await join(s.code, "SYNTH-Control");
  const p = await mirror(a.body.token), otherBefore = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: b.body.interviewId } });
  const assessment = await prisma.assessment.create({ data: { slug: randomUUID(), title: "SYNTH-History" } });
  const mission = await prisma.mission.create({ data: { assessmentId: assessment.id, position: 1, title: "SYNTH-Mission" } });
  const node = await prisma.scenarioNode.create({ data: { missionId: mission.id, key: "end", kind: "ENDING", title: "SYNTH-End", story: "SYNTH" } });
  const attempt = await prisma.attempt.create({ data: { participantId: p.id, currentNodeId: node.id, missionVersion: 1 } });
  const version = await prisma.missionVersion.create({ data: { missionId: mission.id, version: 1, title: "SYNTH-Frozen", graphSnapshot: [] } });
  await prisma.participant.update({ where: { id: p.id }, data: { userId: adminId } });
  await prisma.adaptiveReportJob.create({ data: { interviewId: a.body.interviewId } });
  assert.equal((await api(`/admin/adaptive/participants/${a.body.interviewId}`, "DELETE", undefined, b.body.token)).status, 401);
  assert.equal((await api(`/admin/adaptive/participants/${a.body.interviewId}`, "DELETE", undefined, adminToken)).status, 200);
  const anonymized = await mirror(a.body.token);
  assert.equal(anonymized.displayName, "SYNTH-DELETED"); assert.equal(anonymized.userId, null); assert.ok(anonymized.revokedAt); assert.equal(anonymized.tokenExpiresAt.getTime(), 0);
  assert.equal(await prisma.adaptiveInterview.count({ where: { id: a.body.interviewId } }), 0);
  assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: a.body.interviewId } }), 0);
  assert.equal(await prisma.participant.count({ where: { displayName: "SYNTH-Personal-Name" } }), 0);
  assert.deepEqual(await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } }), attempt);
  assert.deepEqual(await prisma.missionVersion.findUniqueOrThrow({ where: { id: version.id } }), version);
  assert.equal((await join(s.code, a.input.displayName, a.input.registrationId)).status, 401);
  assert.equal((await api("/adaptive/me", "GET", undefined, a.body.token)).status, 401);
  assert.deepEqual(await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: b.body.interviewId } }), otherBefore);
  assert.equal((await api("/admin/auth/me", "GET", undefined, adminToken)).status, 200);
  assert.equal((await api(`/admin/adaptive/participants/${a.body.interviewId}`, "DELETE", undefined, adminToken)).status, 404);
});
test("a PDF rendered before revocation is denied if it completes after revocation", async () => {
  const s = await session(), a = await join(s.code, "SYNTH-Late-PDF"), p = await mirror(a.body.token);
  const { createPreparedInterview, advancePreparedInterview } = await import("../src/services/prepared-interview.service.js");
  let state = createPreparedInterview("fr");
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  await prisma.adaptiveInterview.update({ where: { id: a.body.interviewId }, data: { state: JSON.parse(JSON.stringify(state)) } });
  const { pdfDownloads } = await import("../src/services/pdf-download.service.js");
  const original = pdfDownloads.render;
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(r => { started = r; }), pending = new Promise<void>(r => { release = r; });
  pdfDownloads.render = async () => { started(); await pending; return Buffer.from("%PDF-1.7\nlocal fixture"); };
  try {
    const request = api("/adaptive/me/report.pdf", "GET", undefined, a.body.token);
    await ready;
    assert.equal((await api(`/admin/participants/${p.id}/revoke`, "POST", undefined, adminToken)).status, 200);
    release(); assert.equal((await request).status, 401);
  } finally { release(); pdfDownloads.render = original; }
});
test("a failed deletion rolls back mirror anonymization", async () => {
  const s = await session(), a = await join(s.code, "SYNTH-Atomic"), p = await mirror(a.body.token);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION audit_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local failure'; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER audit_reject_delete BEFORE DELETE ON "AdaptiveInterview" FOR EACH ROW EXECUTE FUNCTION audit_reject_delete()`);
  try { assert.equal((await api(`/admin/adaptive/participants/${a.body.interviewId}`, "DELETE", undefined, adminToken)).status, 500); }
  finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER audit_reject_delete ON "AdaptiveInterview"');
    await prisma.$executeRawUnsafe('DROP FUNCTION audit_reject_delete()');
  }
  assert.deepEqual(await mirror(a.body.token), p);
  assert.equal((await api("/adaptive/me", "GET", undefined, a.body.token)).status, 200);
});
