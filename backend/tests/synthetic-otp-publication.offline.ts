import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { publishSyntheticOtp, syntheticOtpPublicationSchema } from "../src/services/synthetic-otp-publication.service.js";
import { encryptOtpPayload } from "../src/security/otp-payload.js";
import { emailSubjectHash } from "../src/services/email-limits.js";
import { stagingProof } from "../src/security/synthetic-staging.js";

// Dedicated offline suite, run with helpers/local-typescript-loader.mjs.
// Owned in-memory PostgreSQL only. No DSN, Prisma engine, provider HTTP or remote DB.
const pg = new PGlite();
const stagingId = randomUUID();
const keys = ['SKILLQUEST_STAGING_MODE', 'SKILLQUEST_DEPLOYMENT_PURPOSE', 'SKILLQUEST_STAGING_ACK',
  'SKILLQUEST_STAGING_ID', 'SKILLQUEST_STAGING_SECRET', 'JOIN_CODE_PEPPER', 'JOIN_CODE_PEPPER_PREVIOUS',
  'DATABASE_URL', 'VERCEL', 'NODE_ENV', 'SKILLQUEST_STAGING_VERCEL_PROJECT_ID', 'OTP_ENCRYPTION_KEYS', 'OTP_ENCRYPTION_ACTIVE_KEY_ID',
  'OTP_PAYLOAD_WRITE_VERSION', 'BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
  'SKILLQUEST_PROXY_HMAC_KEY', 'SKILLQUEST_EDGE_HMAC_KEY', 'SKILLQUEST_MAINTENANCE_SECRET', 'DOTENV_CONFIG_PATH'];
const saved = keys.map(k => process.env[k]);
const nativeFetch = globalThis.fetch;
let networkCalls = 0;

function adapter(connection: any): any {
  return {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => (await connection.query(sql, args)).rows,
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => (await connection.query(sql, args)).affectedRows ?? 0,
    $transaction: async (work: (tx: any) => Promise<unknown>) => pg.transaction(tx => work(adapter(tx))),
  };
}
const db = adapter(pg) as PrismaClient;

before(async () => {
  keys.forEach(k => delete process.env[k]);
  Object.assign(process.env, { SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId,
    SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 39).toString('base64url'), JOIN_CODE_PEPPER: 'local-otp-publication-fixture-pepper-0123456789' });
  globalThis.fetch = (async () => { networkCalls++; throw Error('ALL_HTTP_FORBIDDEN'); }) as typeof fetch;
  await pg.exec(`SET TIME ZONE 'UTC'`);
  const root = new URL('../prisma/migrations/', import.meta.url);
  for (const name of (await readdir(root)).filter(n => /^\d/.test(n)).sort()) {
    await pg.exec(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
  }
  await pg.query(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1,current_database())`, [stagingId]);
});
beforeEach(async () => {
  await pg.exec(`TRUNCATE "ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation",
    "SyntheticNotification","SyntheticProviderFault","JobPublicationIntent" CASCADE`);
});
after(async () => {
  globalThis.fetch = nativeFetch;
  keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]);
  await pg.close(); assert.equal(networkCalls, 0);
});

async function fixture(email = 'participant@example.test', fullName = 'SYNTH-Participant') {
  const jobId = randomUUID(), challengeId = randomUUID(), identity = emailSubjectHash('IDENTITY', email);
  const codeHash = 'a'.repeat(64);
  await pg.query(`INSERT INTO "EmailOtpChallenge" (id,"identityHash",purpose,"codeHash","expiresAt")
    VALUES ($1,$2,'INITIAL',$3,(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 minutes')`, [challengeId, identity, codeHash]);
  await pg.query(`INSERT INTO "ParticipantEmailDeliveryJob" (id,"challengeId","codeHash","encryptedPayload","expiresAt","nextAttemptAt")
    SELECT $1,$2,$3,$4,(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 minutes',(clock_timestamp() AT TIME ZONE 'UTC')`,
    [jobId, challengeId, codeHash, encryptOtpPayload({ recipient: email, recipientName: fullName, subject: 'Synthetic OTP', htmlContent: '<p>123456</p>' }, jobId)]);
  await pg.query(`INSERT INTO "ParticipantEmailGate" ("identityHash","challengeId","nextIssueAt") VALUES ($1,$2,now())`, [identity, challengeId]);
  const intent = (await pg.query<{ id: string }>(`SELECT id FROM "JobPublicationIntent" WHERE "jobId"=$1`, [jobId])).rows[0];
  return { jobId, challengeId, notificationId: intent.id, email, fullName: 'SYNTH-Participant' as const };
}
const state = async () => (await pg.query<{ id: string; state: string; attempts: number }>(`SELECT id,state,attempts FROM "JobPublicationIntent" ORDER BY id`)).rows;
const count = async () => (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM "SyntheticNotification"`)).rows[0].n;

test('authorized job: exactly one capture, untouched other participant and no OTP delivery', async () => {
  const target = await fixture(), other = await fixture('other@example.test', 'SYNTH-Other');
  const before = await state();
  assert.deepEqual(await publishSyntheticOtp(db, target), { simulated: true, published: 1,
    jobId: target.jobId, challengeId: target.challengeId, notificationId: target.notificationId });
  assert.equal(await count(), 1);
  assert.deepEqual((await state()).find((r: any) => r.id === other.notificationId), before.find((r: any) => r.id === other.notificationId));
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM "ParticipantEmailDeliveryJob" WHERE id=$1`, [target.jobId])).rows[0].status, 'PENDING');
  const notification = (await pg.query<{ payload: any }>(`SELECT payload FROM "SyntheticNotification"`)).rows[0].payload;
  assert.equal(notification.jobId, target.jobId); assert.equal(notification.notificationId, target.notificationId);
  assert.ok(!JSON.stringify(notification).includes('123456')); assert.ok(!JSON.stringify(notification).includes(target.email));
});

test('other participant: mismatched email, challenge, job and authenticated name are rejected', async () => {
  const target = await fixture(), other = await fixture('other@example.test', 'SYNTH-Other');
  for (const input of [{ ...other, email: target.email }, { ...other }, { ...target, challengeId: other.challengeId },
    { ...target, jobId: other.jobId }, { ...target, notificationId: other.notificationId }]) {
    await assert.rejects(publishSyntheticOtp(db, input));
  }
  assert.equal(await count(), 0); assert.ok((await state()).every((r: any) => r.state === 'PENDING' && r.attempts === 0));
});

test('already delivered job and consumed challenge cannot be published', async () => {
  const target = await fixture();
  await pg.query(`UPDATE "ParticipantEmailDeliveryJob" SET status='ACCEPTED',"encryptedPayload"=NULL,"nextAttemptAt"=NULL WHERE id=$1`, [target.jobId]);
  await assert.rejects(publishSyntheticOtp(db, target)); assert.equal(await count(), 0);
  const another = await fixture('new@example.test');
  await pg.query(`UPDATE "EmailOtpChallenge" SET "consumedAt"=now() WHERE id=$1`, [another.challengeId]);
  await assert.rejects(publishSyntheticOtp(db, another)); assert.equal(await count(), 0);
});

test('expired job or expired challenge is rejected using the database clock', async () => {
  const target = await fixture();
  await pg.query(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=now()-interval '20 minutes',"expiresAt"=now()-interval '1 minute' WHERE id=$1`, [target.jobId]);
  await assert.rejects(publishSyntheticOtp(db, target));
  const another = await fixture('new@example.test');
  await pg.query(`UPDATE "EmailOtpChallenge" SET "createdAt"=now()-interval '20 minutes',"expiresAt"=now()-interval '1 minute' WHERE id=$1`, [another.challengeId]);
  await assert.rejects(publishSyntheticOtp(db, another)); assert.equal(await count(), 0);
});

test('nonexistent notification does not create or reconcile an intent', async () => {
  const target = await fixture(), before = await state();
  await assert.rejects(publishSyntheticOtp(db, { ...target, notificationId: randomUUID() }));
  assert.deepEqual(await state(), before); assert.equal(await count(), 0);
});

test('multiple publication, arrays, lists and arbitrary kinds fail strict validation', async () => {
  const target = await fixture();
  for (const input of [[target, target], { ...target, limit: 2 }, { ...target, jobIds: [target.jobId] },
    { ...target, kind: 'REPORT' }, { ...target, fullName: 'SYNTH-Other' }, { ...target, email: 'real@outside.test' }]) {
    assert.equal(syntheticOtpPublicationSchema.safeParse(input).success, false);
    await assert.rejects(publishSyntheticOtp(db, input));
  }
  assert.equal(await count(), 0);
});

test('repeated and concurrent requests never publish the same intent twice', async () => {
  const target = await fixture();
  const results = await Promise.allSettled([publishSyntheticOtp(db, target), publishSyntheticOtp(db, target)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await count(), 1);
  await assert.rejects(publishSyntheticOtp(db, target));
  assert.equal((await state())[0].attempts, 1);
});

test('synthetic transport failure rolls back intent and capture atomically', async () => {
  const target = await fixture();
  await pg.query(`INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES ('QUEUE',$1,'ACCEPTED_RESPONSE_LOST',1)`, [target.notificationId]);
  const before = await state();
  await assert.rejects(publishSyntheticOtp(db, target));
  assert.deepEqual(await state(), before); assert.equal(await count(), 0);
});

test('disabled staging and real provider credentials fail closed', async () => {
  const target = await fixture();
  process.env.SKILLQUEST_STAGING_MODE = 'off';
  await assert.rejects(publishSyntheticOtp(db, target));
  process.env.SKILLQUEST_STAGING_MODE = 'synthetic-v1';
  process.env.BREVO_API_KEY = 'forbidden-fixture';
  try { await assert.rejects(publishSyntheticOtp(db, target)); }
  finally { delete process.env.BREVO_API_KEY; }
  assert.equal(await count(), 0);
});

test('HTTP route retains ADMIN, staging proof, anti-replay and strict single-target checks', async t => {
  // The test loader replaces the DB module: Prisma is never instantiated and
  // cannot auto-load a local .env. External HTTP remains forbidden.
  process.env.DATABASE_URL = 'postgresql://unused@127.0.0.1:1/never_connect';
  process.env.DOTENV_CONFIG_PATH = 'nonexistent-synthetic-test.env';
  const local = adapter(pg);
  const token = 'b'.repeat(64), tokenHash = createHash('sha256').update(token).digest('hex');
  let role = 'ADMIN';
  local.adminSession = { findUnique: async (args: any) => args.where.tokenHash === tokenHash ? {
    expiresAt: new Date(Date.now() + 60000), user: { id: randomUUID(), email: 'admin@example.test', role },
  } : null };
  (globalThis as any).__skillquestSyntheticTestPrisma = local;
  t.after(() => { delete (globalThis as any).__skillquestSyntheticTestPrisma; });
  const { syntheticStagingRouter } = await import('../src/routes/synthetic-staging.routes.js');
  const { default: express } = await import('express');
  const app = express(); app.use('/api/internal/synthetic', syntheticStagingRouter());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const path = '/api/internal/synthetic/notifications/publish-otp';
  const url = `http://127.0.0.1:${address.port}${path}`;
  const target = await fixture(), body = JSON.stringify(target);
  const request = (data: string, overrides: Record<string, string> = {}, nonce = randomUUID()) => {
    const timestamp = String(Date.now()), authorization = `Bearer ${token}`;
    return nativeFetch(url, { method: 'POST', body: data, headers: { 'content-type': 'application/json',
      authorization, 'x-skillquest-staging-id': nonce, 'x-skillquest-staging-time': timestamp,
      'x-skillquest-staging-proof': stagingProof('POST', path, Buffer.from(data), authorization, nonce, timestamp), ...overrides } });
  };
  try {
    assert.equal((await request(body, { authorization: '' })).status, 401);
    assert.equal((await request(body, { 'x-skillquest-staging-proof': 'invalid' })).status, 401);
    role = 'STUDENT'; assert.equal((await request(body)).status, 401); role = 'ADMIN';
    assert.equal((await request(JSON.stringify({ ...target, limit: 2 }))).status, 400);
    assert.equal((await request(JSON.stringify([target, target]))).status, 400);
    assert.equal(await count(), 0);
    const nonce = randomUUID(), result = await request(body, {}, nonce);
    assert.equal(result.status, 200); assert.equal((await result.json() as any).published, 1);
    assert.equal((await request(body, {}, nonce)).status, 409);
    assert.equal(await count(), 1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
