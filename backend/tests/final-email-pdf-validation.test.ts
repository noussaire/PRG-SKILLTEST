import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";

let db: PGlite | undefined, socket: PGLiteSocketServer | undefined, prisma: PrismaClient, server: Server, base: string;
const realFetch = globalThis.fetch;
let externalCalls = 0;
before(async () => {
  process.env.DOTENV_CONFIG_PATH = "__no_environment_file_for_local_tests__";
  if (process.env.LOT4_NATIVE_CONTEXT) {
    const { connectLot4NativeDatabase } = await import("./helpers/native-postgres.js");
    const owned = await connectLot4NativeDatabase(); await owned.client.$disconnect();
  } else {
  db = await PGlite.create();
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "local-summary-only-0123456789abcdef";
  for (const key of ["GROQ_API_KEY", "BREVO_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) process.env[key] = "";
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300";
  process.env.EMAIL_APP_DAILY_LIMIT = "50";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = randomUUID();
  // Fixed local fixture only; never written to a deployment or environment file.
  process.env.SKILLQUEST_STAGING_SECRET = Buffer.alloc(32, 87).toString("base64url");
  // Works against both the owned native cluster and the legacy in-memory fixture.
  const { prisma: markerDb } = await import("../src/db/prisma.js");
  await markerDb.$executeRawUnsafe('INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,current_database())', process.env.SKILLQUEST_STAGING_ID);
  ({ prisma } = await import("../src/db/prisma.js"));
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
async function api(path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw = await res.text();
  assert.ok(res.headers.get("content-type")?.includes("application/json"), `${path}: ${res.status} ${raw}`);
  return { status: res.status, body: JSON.parse(raw) };
}

for (const language of ["fr", "ar"] as const) test(`${language}: OTP, 31 HTTP answers, synthetic summary and actual email attachment match both downloads`, { timeout: 120000 }, async t => {
  const { processOtpDeliveries } = await import("../src/services/otp-delivery.service.js");
  const { processReportEmails } = await import("../src/services/report-email-queue.service.js");
  const { openSyntheticMail } = await import("../src/security/synthetic-staging.js");
  const profile = { fullName: `SYNTH-Validation-${language}`, email: `validation-${language}@example.test`, language, adult: true, consent: true, emailReport: true };
  const issued = await api("/student/start", profile);
  assert.equal(issued.status, 409, JSON.stringify(issued.body));
  assert.equal(issued.body.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(issued.body.token, undefined);
  await processOtpDeliveries();
  const mails = await prisma.$queryRawUnsafe<{ id: string; ciphertext: string }[]>('SELECT id,ciphertext FROM "SyntheticMail" WHERE purpose=\'OTP\'');
  const otpMail = mails.map(m => openSyntheticMail(m.id, m.ciphertext) as any).find(m => m.recipient === profile.email);
  assert.ok(otpMail?.simulated, JSON.stringify(await prisma.$queryRawUnsafe('SELECT status,"lastErrorCode" FROM "ParticipantEmailDeliveryJob"')));
  const verificationCode = otpMail.htmlContent.match(/>(\d{6})<\//)?.[1];
  assert.ok(verificationCode);
  const verified = await api("/student/start", { ...profile, challengeId: issued.body.challengeId, verificationCode });
  assert.equal(verified.status, 201, JSON.stringify(verified.body));
  const token = verified.body.token;
  let current = verified.body.interview;
  assert.equal(current.emailVerified, true);
  for (let i = 0; i < 31; i++) {
    const answer = await api("/student/answer", { questionId: current.currentQuestion.id, choiceId: current.currentQuestion.choices[i % 4].id }, token);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    current = answer.body;
    assert.equal(current.answeredCount, i + 1);
  }
  assert.equal(current.report.skills.length, 31);
  assert.equal((await api("/student/me/summary", {}, token)).status, 200);
  const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: current.id } });
  assert.equal(job.status, "COMPLETE");
  assert.match(JSON.parse(job.summary!).fr, /sans appel IA/);
  const captures: Buffer[] = [];
  const originalToString = Buffer.prototype.toString;
  // Observe the actual base64 attachment encoding; keep renderer and transport real (synthetic-v1).
  const spy = t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (args[0] === "base64" && this.length > 5 && originalToString.call(this, "ascii", 0, 5) === "%PDF-") captures.push(Buffer.from(this));
    return originalToString.apply(this, args);
  });
  try { await Promise.all([processReportEmails(job.id), processReportEmails(job.id)]); }
  finally { spy.mock.restore(); }
  assert.equal(captures.length, 1);
  const saved = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(saved.emailStatus, "SENT", saved.emailLastErrorCode ?? "");
  assert.equal(saved.emailAttempts, 1);
  const stored = await prisma.$queryRawUnsafe<{ ciphertext: string }[]>('SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid', job.id);
  assert.equal(stored.length, 1);
  const message = openSyntheticMail(job.id, stored[0].ciphertext) as any;
  assert.equal(message.simulated, true);
  assert.equal(message.attachments[0].bytes, captures[0].length);
  assert.ok(message.htmlContent.includes(JSON.parse(job.summary!)[language]));
  const buffers: Record<string, Buffer> = { email: captures[0] };
  for (const [kind, path, auth] of [
    ["student", `/student/me/report.pdf?lang=${language}`, token],
    ["admin", `/admin/participants/${current.id}/report.pdf?lang=${language}`, "a".repeat(64)],
  ]) {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${auth}` } });
    assert.equal(response.status, 200);
    buffers[kind] = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(buffers[kind], buffers.email);
  }
  const hashes = Object.fromEntries(Object.entries(buffers).map(([k, b]) => [k, createHash("sha256").update(b).digest("hex")]));
  const pages = (buffers.email.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(pages, 9);
  await processReportEmails(job.id);
  assert.equal((await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } })).emailAttempts, 1);
  assert.equal(externalCalls, 0);
  assert.equal(process.env.SKILLQUEST_STAGING_MODE, "synthetic-v1");
  const out = new URL("../../output/final-email-pdf-validation/", import.meta.url);
  await mkdir(out, { recursive: true });
  await writeFile(new URL(`${language}-evidence.json`, out), JSON.stringify({ language, answered: 31, pages, hashes, bytes: buffers.email.length, summaryStatus: saved.status, emailStatus: saved.emailStatus, simulated: true, emailAttempts: saved.emailAttempts, externalCalls }, null, 2));
  console.log(JSON.stringify({ language, pages, hashes, externalCalls }));
});


