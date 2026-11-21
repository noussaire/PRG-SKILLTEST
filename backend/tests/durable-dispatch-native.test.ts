import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile, readFile } from "node:fs/promises";
import express from "express";
import type { Server } from "node:http";
import type { PrismaClient, Prisma } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { JobPublications } from "../src/services/job-publication.service.js";
import { dispatchJobs, configuredDispatch } from "../src/services/job-dispatch.service.js";
import { SyntheticQstashPublisher } from "../src/services/synthetic-providers.service.js";
import { openSyntheticMail } from "../src/security/synthetic-staging.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { consumeQstash } from "../src/services/qstash-consumer.service.js";
import { jobDispatchRouter } from "../src/routes/job-dispatch.routes.js";
import { DISPATCH_PATH } from "../src/security/dispatch-auth.js";

const options = { skip: !process.env.LOT4_NATIVE_CONTEXT, timeout: 60000 };
let db: PrismaClient, verifier: PrismaClient;
let entry: typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let processJob: typeof import("../src/services/job-processing.service.js").processJob;
const evidence: unknown[] = [];
// Synthetic tables are SQL-managed, absent from schema.prisma. Do not rely on
// delegates accidentally left in a previously generated Prisma client.
async function mailCount(id?: string) {
  return (await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "SyntheticMail" WHERE $1::uuid IS NULL OR id=$1::uuid`, id ?? null))[0].count;
}
async function notificationCount() {
  return (await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "SyntheticNotification"`))[0].count;
}
before(async () => {
  if (options.skip) return;
  verifier = (await connectLot4NativeDatabase()).client;
  Object.assign(process.env, { JOIN_CODE_PEPPER: "durable-local-only-pepper-0123456789abcdef", SKILLQUEST_STAGING_MODE: "synthetic-v1", SKILLQUEST_DEPLOYMENT_PURPOSE: "synthetic-staging", SKILLQUEST_STAGING_ACK: "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS", SKILLQUEST_STAGING_ID: randomUUID(), SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 82).toString("base64url"), SKILLQUEST_DISPATCH_ENABLED: "1", SKILLQUEST_DISPATCH_SECRET: Buffer.alloc(32, 83).toString("base64url"), EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_APP_DAILY_LIMIT: "240" });
  ({ prisma: db } = await import("../src/db/prisma.js"));
  await db.$executeRawUnsafe(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,current_database())`, process.env.SKILLQUEST_STAGING_ID);
  ({ startEmailVerifiedParticipant: entry } = await import("../src/services/participant-email.service.js"));
  ({ processJob } = await import("../src/services/job-processing.service.js"));
});
beforeEach(async () => {
  if (options.skip) return;
  await db.$executeRawUnsafe(`TRUNCATE "AdaptiveInterview","EmailOtpChallenge","ParticipantEmailGate","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","JobPublicationIntent","SyntheticMail","SyntheticNotification","SyntheticProviderFault","JobDispatchUsage" CASCADE`);
  await db.$executeRawUnsafe(`UPDATE "JobDispatchState" SET cursor=0,"attemptToken"=NULL,"leaseUntil"=NULL,"nextAllowedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
});
after(async () => { if (!options.skip) await writeFile(resolve(JSON.parse(await (await import("node:fs/promises")).readFile(process.env.LOT4_NATIVE_CONTEXT!, "utf8")).root, "durable-evidence.json"), JSON.stringify(evidence, null, 2)); await db?.$disconnect(); await verifier?.$disconnect(); });
async function otp() {
  const profile = { fullName: "SYNTH-Durable", email: `${randomUUID()}@example.test`, language: "fr" as const, emailReport: false };
  const result = await entry(profile); assert.equal(result.status, 409);
  const job = await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { challengeId: result.body.challengeId as string } });
  return { profile, job, request: { kind: "OTP_INITIAL", jobId: job.id, phase: "DELIVER" } };
}
async function report(language: "fr" | "ar" = "fr") {
  let state = createPreparedInterview(language); while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const i = await db.adaptiveInterview.create({ data: { displayName: "SYNTH-Report", email: `${randomUUID()}@example.test`, reportEmailRequested: true, state: state as unknown as Prisma.InputJsonValue, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), expiresAt: new Date(Date.now() + 86400000) } });
  return db.adaptiveReportJob.create({ data: { interviewId: i.id, status: "UNAVAILABLE", emailStatus: "PENDING" } });
}
function child(action: string, id = "") {
  const guard = pathToFileURL(resolve("backend/tests/helpers/local-only-network.mjs")).href;
  return spawn(process.execPath, ["--import", guard, "--import", "tsx", resolve("backend/tests/helpers/durable-worker.ts"), action, id], { env: { ...process.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
}
async function runChild(action: string, id = "") {
  const proc = child(action, id); let out = "", err = "";
  proc.stdout!.on("data", b => { out += b; }); proc.stderr!.on("data", b => { err += b; });
  const [code] = await once(proc, "exit"); assert.equal(code, 0, err); return { pid: proc.pid, result: JSON.parse(out.trim()) };
}
test("committed OTP survives publisher process exit and duplicate delivery in another process sends once", options, async () => {
  const f = await otp(); const published = await runChild("dispatch"); assert.equal(published.result.published, 1);
  const [n] = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "SyntheticNotification"`);
  const received = await runChild("receive", n.id); const repeated = await runChild("receive", n.id);
  assert.equal(received.result.disposition, "COMPLETE"); assert.notEqual(published.pid, received.pid);
  assert.equal(repeated.result.disposition, "COMPLETE");
  assert.equal(await mailCount(), 1); assert.equal(await db.emailBudgetReservation.count(), 1);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: f.job.id } })).attempts, 1);
  evidence.push({ scenario: "restart-and-duplicate", published, received, repeated, mailbox: 1, reservations: 1 });
});
for (const boundary of ["before", "after"]) test(`killed worker ${boundary} reservation recovers without blind resend`, options, async () => {
  const f = await otp(), proc = child(`crash-${boundary}`, f.job.id);
  let err = ""; proc.stderr!.on("data", b => { err += b; });
  try {
    const ready = await Promise.race([once(proc, "message"), once(proc, "exit").then(() => { throw Error(err || "Worker exited before boundary"); })]);
    assert.equal(ready[0].ready, true);
  } finally { const stopped = once(proc, "exit"); proc.kill(); await stopped; }
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, f.job.id);
  await db.$executeRawUnsafe(`UPDATE "EmailBudgetReservation" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE "logicalKey"=$1`, f.job.id);
  await processJob(f.request);
  const job = await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: f.job.id } });
  assert.equal(job.status, boundary === "before" ? "ACCEPTED" : "UNCERTAIN");
  assert.equal(await mailCount(), boundary === "before" ? 1 : 0);
  evidence.push({ scenario: `kill-${boundary}-reservation`, pid: proc.pid, status: job.status, mailbox: await mailCount() });
});
test("lost confirmed notification rearms with another notification UUID and the same OTP UUID", options, async () => {
  const f = await otp(); await configuredDispatch();
  const [old] = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "SyntheticNotification"`);
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '3 minutes'`);
  await new JobPublications(db).reconcile(); await new JobPublications(db).publishBatch(new SyntheticQstashPublisher(db));
  const notes = await db.$queryRawUnsafe<{ id: string; payload: any }[]>(`SELECT id,payload FROM "SyntheticNotification" WHERE id<>$1::uuid`, old.id);
  assert.equal(notes.length, 1); assert.equal(notes[0].payload.jobId, f.job.id);
  await Promise.all(Array.from({ length: 8 }, () => consumeQstash(db, notes[0].payload)));
  assert.equal(await mailCount(), 1);
  evidence.push({ scenario: "lost-notification", oldId: old.id, newId: notes[0].id, jobId: f.job.id, mailbox: 1 });
});

test("persisted provider acceptance reconciles a lost worker completion without a second mail", options, async () => {
  const f = await otp(); await processJob(f.request);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET status='UNCERTAIN',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second',"attemptToken"=NULL,"leaseUntil"=NULL WHERE id=$1::uuid`, f.job.id);
  await processJob(f.request);
  const job = await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: f.job.id } });
  assert.equal(job.status, "ACCEPTED"); assert.equal(job.attempts, 1); assert.equal(await mailCount(), 1);
  assert.equal(await db.emailBudgetReservation.count(), 1);
  evidence.push({ scenario: "persisted-acceptance-reconciliation", jobId: job.id, mailbox: 1, attempts: 1 });
});
test("weighted cursor gives reports a slot across separate one-item publishers", options, async () => {
  for (let n = 0; n < 5; n++) await otp(); const r = await report();
  const order: string[] = [];
  for (let n = 0; n < 3; n++) await new JobPublications(db).publishBatch({ async publish(n) { order.push(n.kind); } }, 1);
  assert.deepEqual(order, ["OTP_INITIAL", "OTP_INITIAL", "REPORT"]);
  assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT * FROM "JobPublicationIntent" WHERE "jobId"=$1::uuid`, r.id))[0].state, "PUBLISHED");
});
test("dispatch lease serializes concurrent triggers and daily publication limit survives recreation", options, async () => {
  await otp(); const results = await Promise.allSettled([configuredDispatch(), configuredDispatch()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await notificationCount(), 1);
  await otp(); await new JobPublications(db, undefined, 4).publishBatch(new SyntheticQstashPublisher(db), 1);
  await otp(); await assert.rejects(new JobPublications(db, undefined, 4).publishBatch(new SyntheticQstashPublisher(db), 1), /DISPATCH_DAILY_LIMIT/);
});
test("publication attempts remain bounded across rearmed UUIDs and reports stop after crashes or age", options, async () => {
  const f = await otp(); await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET attempts=24 WHERE "jobId"=$1::uuid`, f.job.id);
  const result = await new JobPublications(db).publishBatch(new SyntheticQstashPublisher(db)); assert.equal(result.published, 0);
  const r = await report(); await db.adaptiveReportJob.update({ where: { id: r.id }, data: { emailAttempts: 6 } });
  await processJob({ kind: "REPORT", jobId: r.id, phase: "EMAIL" });
  assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({ where: { id: r.id } })).emailStatus, "FAILED");
  const old = await report(); await db.adaptiveReportJob.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
  await new JobPublications(db).retire(); assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({ where: { id: old.id } })).emailStatus, "FAILED");
  const crashed = await report(); await db.adaptiveReportJob.update({ where: { id: crashed.id }, data: { status: "PROCESSING", attempts: 3, leaseUntil: new Date(Date.now() - 1000) } });
  await new JobPublications(db).retire(); assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({ where: { id: crashed.id } })).status, "UNAVAILABLE");
  assert.equal(await mailCount(), 0);
});
test("delayed 429 retries immutable OTP once; an uncertain response never automatically resends", options, async () => {
  const f = await otp(); await db.$executeRawUnsafe(`INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES ('EMAIL',$1::uuid,'RATE_LIMIT',1)`, f.job.id);
  await processJob(f.request); assert.equal(await mailCount(), 0);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: f.job.id } })).status, "PENDING");
  await db.$executeRawUnsafe(`UPDATE "EmailProviderState" SET "blockedUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, f.job.id);
  await processJob(f.request); await processJob(f.request); assert.equal(await mailCount(), 1); assert.equal(await db.emailBudgetReservation.count(), 1);
  const g = await otp(); await db.$executeRawUnsafe(`INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES ('EMAIL',$1::uuid,'ACCEPTED_RESPONSE_LOST',1)`, g.job.id);
  await processJob(g.request); for (let n = 0; n < 3; n++) await processJob(g.request);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: g.job.id } })).status, "UNCERTAIN");
  assert.equal(await mailCount(), 2);
});
test("OTP expires, renewal preserves cumulative failures, correct code consumes only once", options, async () => {
  const f = await otp(); await processJob(f.request);
  const [mail] = await db.$queryRawUnsafe<{ ciphertext: string }[]>(`SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid`, f.job.id);
  const code = (openSyntheticMail(f.job.id, mail.ciphertext) as any).htmlContent.match(/>(\d{6})<\//)[1];
  for (let n = 0; n < 5; n++) assert.equal((await entry({ ...f.profile, verificationCode: code === "111111" ? "222222" : "111111", challengeId: f.job.challengeId })).status, 400);
  assert.equal((await entry({ ...f.profile, verificationCode: code, challengeId: f.job.challengeId })).status, 429);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "nextIssueAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  const fresh = await entry({ ...f.profile, requestNewCode: true }); assert.notEqual(fresh.body.challengeId, f.job.challengeId);
  const [failures] = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT count FROM "EmailAbuseCounter" WHERE metric='OTP_FAILURE' AND scope='IDENTITY'`); assert.equal(failures.count, 5);
  const g = await otp(); await processJob(g.request);
  const [m] = await db.$queryRawUnsafe<{ ciphertext: string }[]>(`SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid`, g.job.id);
  const valid = (openSyntheticMail(g.job.id, m.ciphertext) as any).htmlContent.match(/>(\d{6})<\//)[1];
  const input = { ...g.profile, verificationCode: valid, challengeId: g.job.challengeId };
  const results = await Promise.all([entry(input), entry(input)]); assert.equal(results.filter(r => r.status === 201).length, 1);
  const expired = await otp();
  await db.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, expired.job.challengeId);
  assert.equal((await entry({ ...expired.profile, verificationCode: "111111", challengeId: expired.job.challengeId })).body.code, "EMAIL_CODE_EXPIRED");
  await processJob(expired.request); assert.equal(await mailCount(expired.job.id), 0);
});
test("dispatch HTTP rejects missing auth, bodies, queries and disabled mode before execution", options, async () => {
  let calls = 0; const app = express(); app.use(jobDispatchRouter(async () => { calls++; return { published: 0, deferred: 0, stale: 0, stop: "COMPLETE" }; }));
  const server: Server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const addr = server.address(); assert.ok(addr && typeof addr !== "string"); const base = `http://127.0.0.1:${addr.port}`;
  const headers = { Authorization: `Bearer ${process.env.SKILLQUEST_DISPATCH_SECRET}` };
  try {
    assert.equal((await fetch(base + DISPATCH_PATH)).status, 401);
    assert.equal((await fetch(base + DISPATCH_PATH + "?limit=100", { headers })).status, 400);
    assert.equal((await fetch(base + DISPATCH_PATH, { method: "POST", headers, body: "{}" })).status, 400);
    assert.equal((await fetch(base + DISPATCH_PATH, { headers })).status, 200); assert.equal(calls, 1);
    process.env.SKILLQUEST_DISPATCH_ENABLED = "0";
    assert.equal((await fetch(base + DISPATCH_PATH, { headers })).status, 503); assert.equal(calls, 1);
  } finally { process.env.SKILLQUEST_DISPATCH_ENABLED = "1"; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test("required entry consent cannot be omitted, and authenticated withdrawal prevents report transmission", options, async () => {
  const { adaptiveRouter } = await import("../src/routes/adaptive.routes.js");
  const { hashGuestToken } = await import("../src/security/tokens.js");
  const r = await report(), token = "b".repeat(64);
  await db.adaptiveInterview.update({ where: { id: r.interviewId }, data: { tokenHash: hashGuestToken(token) } });
  const app = express(); app.use(express.json()); app.use("/student", adaptiveRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}/student`;
  try {
    const invalid = await fetch(base + "/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "SYNTH-NoConsent", email: "no-consent@example.test", language: "fr", adult: true }) });
    assert.equal(invalid.status, 400); assert.equal(await db.participantEmailDeliveryJob.count(), 0);
    assert.equal((await fetch(base + "/me/report-email/withdraw", { method: "POST" })).status, 401);
    for (let n = 0; n < 2; n++) assert.equal((await fetch(base + "/me/report-email/withdraw", { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await processJob({ kind: "REPORT", jobId: r.id, phase: "EMAIL" });
    assert.equal(await mailCount(), 0); assert.equal(await db.emailBudgetReservation.count(), 0);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

for (const language of ["fr", "ar"] as const) test(`${language}: nine-page PDF has the same SHA-256 after renderer process restart`, options, async () => {
  const job = await report(language), interview = await db.adaptiveInterview.findUniqueOrThrow({ where: { id: job.interviewId } });
  const { reportPdfRenderer } = await import("../src/services/report-pdf.service.js");
  const pdf = await reportPdfRenderer.render(interview, job);
  const restarted = await runChild("pdf", job.id);
  const context = JSON.parse(await readFile(process.env.LOT4_NATIVE_CONTEXT!, "utf8"));
  const next = await readFile(resolve(context.root, `pdf-${job.id}.pdf`));
  assert.deepEqual(next, pdf); assert.equal((next.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 9);
  assert.equal(restarted.result.sha256, createHash("sha256").update(pdf).digest("hex"));
  evidence.push({ scenario: "pdf-renderer-restart", language, pid: restarted.pid, ...restarted.result, pages: 9 });
});
