import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { publishSyntheticOtp } from '../src/services/synthetic-otp-publication.service.js';
import { receiveSyntheticOtp } from '../src/services/synthetic-otp-receive.service.js';
import { encryptOtpPayload } from '../src/security/otp-payload.js';
import { emailSubjectHash } from '../src/services/email-limits.js';
import { stagingProof } from '../src/security/synthetic-staging.js';

// Never run without the dedicated launcher. No arbitrary DATABASE_URL fallback.
let a: PrismaClient, b: PrismaClient, root: string, pidA: number, pidB: number;
const nativeFetch = globalThis.fetch.bind(globalThis);
const evidence: Record<string, unknown> = {};
const stagingId = randomUUID();
let externalAttempts = 0;
before(async () => {
  assert.ok(process.env.SKILLQUEST_OTP_NATIVE_CONTEXT, 'Use qualify-synthetic-otp-native.mjs');
  const file = await realpath(process.env.SKILLQUEST_OTP_NATIVE_CONTEXT);
  const context = JSON.parse(await readFile(file, 'utf8'));
  root = await realpath(context.root);
  const output = await realpath('output/otp-native-qualification');
  assert.equal(path.dirname(file), root); assert.equal(path.dirname(root), output);
  const owner = JSON.parse(await readFile(path.join(root, 'owner.json'), 'utf8'));
  assert.equal(owner.purpose, 'skillquest-otp-native'); assert.equal(owner.nonce, context.nonce);
  assert.equal(await realpath(context.data), path.join(root, 'data')); assert.equal(context.schemaLoaded, true);
  assert.ok(Number.isInteger(context.port) && context.port > 1024 && context.port < 65536 && context.port !== 5432);
  // Explicit local URL plus disabled Prisma .env discovery. No production credentials.
  const url = `postgresql://otp_native@127.0.0.1:${context.port}/postgres?connection_limit=1&connect_timeout=3&pool_timeout=3&sslmode=disable`;
  const options = { datasourceUrl: url, log: [], __internal: { configOverride: (config: any) =>
    ({ ...config, relativeEnvPaths: { rootEnvPath: null, schemaEnvPath: null } }) } };
  a = new PrismaClient(options as any); b = new PrismaClient(options as any);
  for (const client of [a, b]) {
    const [row] = await client.$queryRawUnsafe<any[]>(`SELECT pg_backend_pid() AS pid,inet_server_port() AS port,
      inet_server_addr()::text AS address,current_setting('listen_addresses') AS listen,current_database() AS db,
      current_user AS username,current_setting('data_directory') AS directory,
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",version() AS version`);
    assert.equal(row.port, context.port); assert.ok(['127.0.0.1', '127.0.0.1/32'].includes(row.address)); assert.equal(row.listen, '127.0.0.1');
    assert.equal(row.username, 'otp_native'); assert.equal(row.db, 'postgres');
    assert.equal(await realpath(row.directory), await realpath(context.data)); assert.equal(row.systemId, context.systemId);
    if (client === a) { pidA = row.pid; evidence.version = row.version; } else pidB = row.pid;
  }
  assert.notEqual(pidA, pidB); evidence.backendPids = [pidA, pidB]; evidence.isolation = 'two independent single-connection Prisma pools on owned loopback cluster';
  for (const key of Object.keys(process.env)) if (/^(SKILLQUEST_|OTP_|JOIN_CODE_|BREVO_|GROQ_|QSTASH_|VERCEL|DATABASE_URL|DIRECT_URL)/.test(key)) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(root, 'absent.env'), DATABASE_URL: url,
    SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId,
    SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 67).toString('base64url'), JOIN_CODE_PEPPER: 'native-qualification-only-fixture-pepper-0123456789',
    EMAIL_ACCOUNT_DAILY_LIMIT: '300', EMAIL_OTHER_USAGE_MARGIN: '60', EMAIL_APP_DAILY_LIMIT: '240' });
  globalThis.fetch = (async () => { externalAttempts++; throw Error('HTTP_FORBIDDEN'); }) as typeof fetch;
  await a.$executeRawUnsafe(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,current_database())`, stagingId);
});
beforeEach(async () => {
  await a.$executeRawUnsafe(`TRUNCATE "User","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState",
    "SyntheticNotification","SyntheticMail","SyntheticInvocation","SyntheticProviderFault","JobPublicationIntent" CASCADE`);
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.allSettled([a?.$disconnect(), b?.$disconnect()]);
  evidence.externalHttpAttempts = externalAttempts;
  if (root) await writeFile(path.join(root, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
  assert.equal(externalAttempts, 0);
});
async function fixture(email = randomUUID() + '@example.test', name = 'SYNTH-Participant') {
  const jobId = randomUUID(), challengeId = randomUUID(), codeHash = 'a'.repeat(64), identity = emailSubjectHash('IDENTITY', email);
  await a.$executeRawUnsafe(`INSERT INTO "EmailOtpChallenge" (id,"identityHash",purpose,"codeHash","expiresAt","createdAt")
    SELECT $1::uuid,$2,'INITIAL',$3,(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 minutes',(clock_timestamp() AT TIME ZONE 'UTC')`, challengeId, identity, codeHash);
  await a.$executeRawUnsafe(`INSERT INTO "ParticipantEmailDeliveryJob" (id,"challengeId","codeHash","encryptedPayload","expiresAt","nextAttemptAt","createdAt")
    SELECT $1::uuid,$2::uuid,$3,$4,(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 minutes',
      (clock_timestamp() AT TIME ZONE 'UTC'),(clock_timestamp() AT TIME ZONE 'UTC')`, jobId, challengeId, codeHash,
    encryptOtpPayload({ recipient: email, recipientName: name, subject: 'Synthetic OTP', htmlContent: '<p>123456</p>' }, jobId));
  await a.$executeRawUnsafe(`INSERT INTO "ParticipantEmailGate" ("identityHash","challengeId","nextIssueAt") VALUES ($1,$2::uuid,(clock_timestamp() AT TIME ZONE 'UTC'))`, identity, challengeId);
  const [row] = await a.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "JobPublicationIntent" WHERE "jobId"=$1::uuid`, jobId);
  return { jobId, challengeId, notificationId: row.id, email, fullName: 'SYNTH-Participant' as const };
}
async function counts(client = a) {
  const [row] = await client.$queryRawUnsafe<{ captures: number; attempts: number }[]>(`SELECT
    (SELECT count(*)::int FROM "SyntheticNotification") AS captures,
    (SELECT COALESCE(sum(attempts),0)::int FROM "JobPublicationIntent") AS attempts`);
  return row;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
function wrap(client: PrismaClient, afterLock?: (tx: Prisma.TransactionClient) => Promise<void>, abortInsert = false, abortReceipt = false): PrismaClient {
  return {
    $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
    $transaction: (work: any, options: any) => client.$transaction(async tx => {
      const view = new Proxy(tx, { get(target, prop) {
        if (prop === '$queryRawUnsafe') return async (sql: string, ...args: unknown[]) => {
          const result = await tx.$queryRawUnsafe(sql, ...args);
          if (sql.includes('FOR UPDATE OF g,c,j,p') && afterLock) await afterLock(tx);
          return result;
        };
        if (prop === '$executeRawUnsafe' && (abortInsert || abortReceipt)) return async (sql: string, ...args: unknown[]) => {
          if (abortInsert && sql.startsWith('INSERT INTO "SyntheticNotification"') ||
              abortReceipt && sql.startsWith('UPDATE "SyntheticNotification" SET "receivedAt"')) await tx.$queryRawUnsafe(`SELECT 1/0 AS injected_failure`);
          return tx.$executeRawUnsafe(sql, ...args);
        };
        const value = (target as any)[prop]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      return work(view);
    }, options),
  } as unknown as PrismaClient;
}

test('two physical independent PostgreSQL connections retain distinct backend PIDs', async () => {
  const [x] = await a.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`);
  const [y] = await b.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`);
  assert.equal(x.pid, pidA); assert.equal(y.pid, pidB); assert.notEqual(x.pid, y.pid);
});

test('same OTP: second publication waits on first transaction lock; exactly one commits', async () => {
  const target = await fixture(), entered = deferred<Prisma.TransactionClient>(), release = deferred<void>();
  const first = publishSyntheticOtp(wrap(a, async tx => { entered.resolve(tx); await release.promise; }), target);
  first.catch(() => {});
  const tx = await entered.promise;
  const second = publishSyntheticOtp(b, target); second.catch(() => {});
  let blocked = false;
  try {
    for (let n = 0; n < 50; n++) {
      const [row] = await tx.$queryRawUnsafe<{ blocked: boolean }[]>(`SELECT wait_event_type='Lock'
        AND $2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1::int`, pidB, pidA);
      if (row?.blocked) { blocked = true; break; } await delay(20);
    }
  } finally { release.resolve(); }
  const results = await Promise.allSettled([first, second]);
  assert.equal(blocked, true); evidence.sameJobLockWaitObserved = true;
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.deepEqual(await counts(), { captures: 1, attempts: 1 });
});

test('different OTPs: job B commits while job A remains locked, without global batch effects', async () => {
  const x = await fixture(), y = await fixture(), untouched = await fixture();
  const entered = deferred<void>(), release = deferred<void>();
  const first = publishSyntheticOtp(wrap(a, async () => { entered.resolve(); await release.promise; }), x); first.catch(() => {});
  await entered.promise;
  try {
    const result = await publishSyntheticOtp(b, y); assert.equal(result.published, 1);
    assert.deepEqual(await counts(b), { captures: 1, attempts: 1 });
    const [row] = await b.$queryRawUnsafe<{ state: string; attempts: number }[]>(`SELECT state,attempts FROM "JobPublicationIntent" WHERE id=$1::uuid`, untouched.notificationId);
    assert.deepEqual(row, { state: 'PENDING', attempts: 0 }); evidence.independentJobsProgressWhileOtherLocked = true;
  } finally { release.resolve(); }
  await first; assert.deepEqual(await counts(), { captures: 2, attempts: 2 });
});

test('another participant, wrong challenge or wrong job cannot pass identity binding', async () => {
  const x = await fixture(), y = await fixture(undefined, 'SYNTH-Other');
  for (const input of [y, { ...y, email: x.email }, { ...x, challengeId: y.challengeId }, { ...x, jobId: y.jobId }, { ...x, notificationId: y.notificationId }]) {
    await assert.rejects(publishSyntheticOtp(b, input));
  }
  assert.deepEqual(await counts(), { captures: 0, attempts: 0 });
});

test('expired challenge and expired job are rejected on the PostgreSQL clock', async () => {
  const x = await fixture();
  await a.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',
    "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' WHERE id=$1::uuid`, x.challengeId);
  await assert.rejects(publishSyntheticOtp(b, x));
  const y = await fixture();
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',
    "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' WHERE id=$1::uuid`, y.jobId);
  await assert.rejects(publishSyntheticOtp(b, y)); assert.deepEqual(await counts(), { captures: 0, attempts: 0 });
});

test('already published, delivered or consumed OTP is refused without a second publication', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x); await assert.rejects(publishSyntheticOtp(b, x));
  const y = await fixture();
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET status='ACCEPTED',"encryptedPayload"=NULL,"nextAttemptAt"=NULL WHERE id=$1::uuid`, y.jobId);
  await assert.rejects(publishSyntheticOtp(b, y));
  const z = await fixture(); await a.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "consumedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=$1::uuid`, z.challengeId);
  await assert.rejects(publishSyntheticOtp(b, z)); assert.deepEqual(await counts(), { captures: 1, attempts: 1 });
});

test('nonexistent intention and multiple-publication bodies never create a capture', async () => {
  const x = await fixture();
  for (const input of [{ ...x, notificationId: randomUUID() }, [x, x], { ...x, limit: 2 }, { ...x, jobIds: [x.jobId, x.jobId] }]) {
    await assert.rejects(publishSyntheticOtp(b, input));
  }
  assert.deepEqual(await counts(), { captures: 0, attempts: 0 });
});

test('real SQL transaction failure after intent update rolls back; other connection can retry once', async () => {
  const x = await fixture();
  await assert.rejects(publishSyntheticOtp(wrap(a, undefined, true), x), (error: any) => {
    assert.equal(error.code, 'P2010'); assert.equal(error.meta?.code, '22012'); return true;
  });
  assert.deepEqual(await counts(b), { captures: 0, attempts: 0 });
  const [row] = await b.$queryRawUnsafe<{ state: string }[]>(`SELECT state FROM "JobPublicationIntent" WHERE id=$1::uuid`, x.notificationId);
  assert.equal(row.state, 'PENDING');
  await publishSyntheticOtp(b, x); await assert.rejects(publishSyntheticOtp(a, x));
  assert.deepEqual(await counts(), { captures: 1, attempts: 1 }); evidence.sqlRollbackAndRetry = true;
});

test('eight repeated two-connection races each produce exactly one capture and one charged attempt', async () => {
  for (let n = 0; n < 8; n++) {
    const x = await fixture();
    const results = await Promise.allSettled([publishSyntheticOtp(a, x), publishSyntheticOtp(b, x)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.deepEqual(await counts(), { captures: n + 1, attempts: n + 1 });
  }
  evidence.repeatedRaces = 8;
});

test('native HTTP route retains ADMIN, proof, identity, synthetic-only mode and anti-replay', async () => {
  (globalThis as any).__skillquestSyntheticTestPrisma = a;
  const { syntheticStagingRouter } = await import('../src/routes/synthetic-staging.routes.js');
  const { default: express } = await import('express');
  const token = 'c'.repeat(64), user = await a.user.create({ data: { email: 'admin@example.test', role: 'ADMIN' } });
  await a.adminSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
  const app = express(); app.use('/api/internal/synthetic', syntheticStagingRouter());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const endpoint = '/api/internal/synthetic/notifications/publish-otp', url = `http://127.0.0.1:${address.port}${endpoint}`;
  const x = await fixture();
  const request = (body = JSON.stringify(x), overrides: Record<string, string> = {}, nonce = randomUUID()) => {
    const timestamp = String(Date.now()), authorization = `Bearer ${token}`;
    return nativeFetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', authorization,
      'x-skillquest-staging-id': nonce, 'x-skillquest-staging-time': timestamp,
      'x-skillquest-staging-proof': stagingProof('POST', endpoint, Buffer.from(body), authorization, nonce, timestamp), ...overrides } });
  };
  try {
    assert.equal((await request(undefined, { authorization: '' })).status, 401);
    assert.equal((await request(undefined, { 'x-skillquest-staging-proof': 'wrong' })).status, 401);
    await a.user.update({ where: { id: user.id }, data: { role: 'STUDENT' } }); assert.equal((await request()).status, 401);
    await a.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    assert.equal((await request(JSON.stringify({ ...x, fullName: 'SYNTH-Other' })) ).status, 400);
    assert.equal((await request(JSON.stringify({ ...x, email: 'real@outside.test' })) ).status, 400);
    process.env.SKILLQUEST_STAGING_MODE = 'off';
    assert.equal((await nativeFetch(url, { method: 'POST', body: '{}' })).status, 404);
    process.env.SKILLQUEST_STAGING_MODE = 'synthetic-v1';
    assert.deepEqual(await counts(), { captures: 0, attempts: 0 });
    const nonce = randomUUID(); assert.equal((await request(undefined, {}, nonce)).status, 200);
    assert.equal((await request(undefined, {}, nonce)).status, 409);
    assert.deepEqual(await counts(), { captures: 1, attempts: 1 }); evidence.nativeRouteProtections = true;
    const receivePath = '/api/internal/synthetic/notifications/receive';
    const receive = (body = JSON.stringify(x), overrides: Record<string, string> = {}, nonce = randomUUID()) => {
      const timestamp = String(Date.now()), authorization = `Bearer ${token}`;
      return nativeFetch(`http://127.0.0.1:${address.port}${receivePath}`, { method: 'POST', body, headers: {
        'content-type': 'application/json', authorization, 'x-skillquest-staging-id': nonce, 'x-skillquest-staging-time': timestamp,
        'x-skillquest-staging-proof': stagingProof('POST', receivePath, Buffer.from(body), authorization, nonce, timestamp), ...overrides } });
    };
    assert.equal((await receive(JSON.stringify({ id: x.notificationId }))).status, 400);
    assert.equal((await receive(undefined, { authorization: '' })).status, 401);
    assert.equal((await receive(undefined, { 'x-skillquest-staging-proof': 'invalid' })).status, 401);
    await a.user.update({ where: { id: user.id }, data: { role: 'STUDENT' } }); assert.equal((await receive()).status, 401);
    await a.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    assert.equal((await receive(JSON.stringify({ ...x, fullName: 'SYNTH-Other' }))).status, 400);
    const receiptNonce = randomUUID(), receipt = await receive(undefined, {}, receiptNonce);
    assert.equal(receipt.status, 200); assert.equal((await receipt.json() as any).disposition, 'COMPLETE');
    assert.equal((await receive(undefined, {}, receiptNonce)).status, 409);
    evidence.nativeReceiveRouteProtections = true;
  } finally {
    process.env.SKILLQUEST_STAGING_MODE = 'synthetic-v1'; delete (globalThis as any).__skillquestSyntheticTestPrisma;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function receiptCounts(client = a) {
  const [row] = await client.$queryRawUnsafe<{ mail: number; received: number; accepted: number; attempts: number; consumed: number }[]>(`SELECT
    (SELECT count(*)::int FROM "SyntheticMail") AS mail,
    (SELECT count(*)::int FROM "SyntheticNotification" WHERE "receivedAt" IS NOT NULL) AS received,
    (SELECT count(*)::int FROM "EmailBudgetReservation" WHERE status='ACCEPTED') AS accepted,
    (SELECT COALESCE(sum(attempts),0)::int FROM "ParticipantEmailDeliveryJob") AS attempts,
    (SELECT count(*)::int FROM "EmailOtpChallenge" WHERE "consumedAt" IS NOT NULL) AS consumed`);
  return row;
}

test('receive valid target: normal queue, encrypted capture, quota reservation and no OTP verification bypass', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  assert.deepEqual(await receiveSyntheticOtp(b, x), { simulated: true, disposition: 'COMPLETE',
    jobId: x.jobId, challengeId: x.challengeId, notificationId: x.notificationId });
  assert.deepEqual(await receiptCounts(), { mail: 1, received: 1, accepted: 1, attempts: 1, consumed: 0 });
  await assert.rejects(receiveSyntheticOtp(a, x));
  assert.deepEqual(await receiptCounts(), { mail: 1, received: 1, accepted: 1, attempts: 1, consumed: 0 });
});

test('receive other participant, crossed challenge/job/notification, arrays and legacy id-only bodies are rejected', async () => {
  const x = await fixture(), y = await fixture(); await publishSyntheticOtp(a, x); await publishSyntheticOtp(a, y);
  for (const input of [{ ...x, email: y.email }, { ...x, challengeId: y.challengeId }, { ...x, jobId: y.jobId },
    { ...x, notificationId: y.notificationId }, { ...x, fullName: 'SYNTH-Other' }, [x], { id: x.notificationId }, { ...x, limit: 2 }]) {
    await assert.rejects(receiveSyntheticOtp(b, input));
  }
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
});

test('receive expired challenge or already processed job never produces mail', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  await a.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',
    "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' WHERE id=$1::uuid`, x.challengeId);
  await assert.rejects(receiveSyntheticOtp(b, x));
  const y = await fixture(); await publishSyntheticOtp(a, y);
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET status='ACCEPTED',"encryptedPayload"=NULL,"nextAttemptAt"=NULL WHERE id=$1::uuid`, y.jobId);
  await assert.rejects(receiveSyntheticOtp(b, y));
  const z = await fixture(); await publishSyntheticOtp(a, z);
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',
    "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' WHERE id=$1::uuid`, z.jobId);
  await assert.rejects(receiveSyntheticOtp(b, z));
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
});

test('receive cryptographic publication binding refuses a substituted envelope or unbound legacy capture', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  const [row] = await a.$queryRawUnsafe<{ payload: any }[]>(`SELECT payload FROM "SyntheticNotification" WHERE id=$1::uuid`, x.notificationId);
  for (const payload of [{ ...row.payload, jobId: randomUUID() }, { ...row.payload, otpTargetProof: 'x'.repeat(43) },
    Object.fromEntries(Object.entries(row.payload).filter(([k]) => k !== 'otpTargetProof'))]) {
    await a.$executeRawUnsafe(`UPDATE "SyntheticNotification" SET payload=$2::jsonb WHERE id=$1::uuid`, x.notificationId, JSON.stringify(payload));
    await assert.rejects(receiveSyntheticOtp(b, x));
  }
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
});

test('receive rechecks identity and active gate after publication, before doing any delivery', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "encryptedPayload"=$2 WHERE id=$1::uuid`, x.jobId,
    encryptOtpPayload({ recipient: 'other@example.test', recipientName: 'SYNTH-Participant', subject: 'Synthetic OTP', htmlContent: '<p>123456</p>' }, x.jobId));
  await assert.rejects(receiveSyntheticOtp(b, x));
  const y = await fixture(); await publishSyntheticOtp(a, y);
  await a.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "challengeId"=NULL WHERE "challengeId"=$1::uuid`, y.challengeId);
  await assert.rejects(receiveSyntheticOtp(b, y));
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
});

test('concurrent receive: held identity locks admit one delivery and reject second call after commit', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  const entered = deferred<Prisma.TransactionClient>(), release = deferred<void>();
  const first = receiveSyntheticOtp(wrap(a, async tx => { entered.resolve(tx); await release.promise; }), x); first.catch(() => {});
  const tx = await entered.promise;
  const second = receiveSyntheticOtp(b, x); second.catch(() => {});
  let blocked = false;
  try {
    for (let n = 0; n < 50; n++) {
      const [row] = await tx.$queryRawUnsafe<{ blocked: boolean }[]>(`SELECT wait_event_type='Lock'
        AND $2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1::int`, pidB, pidA);
      if (row?.blocked) { blocked = true; break; } await delay(20);
    }
  } finally { release.resolve(); }
  const results = await Promise.allSettled([first, second]);
  assert.equal(blocked, true); assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.deepEqual(await receiptCounts(), { mail: 1, received: 1, accepted: 1, attempts: 1, consumed: 0 });
  evidence.sameReceiveLockWaitObserved = true;
});

test('receipt write SQL failure rolls back delivery, reservation, counters and notification; retry succeeds once', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  await assert.rejects(receiveSyntheticOtp(wrap(a, undefined, false, true), x), (error: any) => error?.meta?.code === '22012');
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
  const [budget] = await b.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "EmailAbuseCounter"`); assert.equal(budget.n, 0);
  assert.equal((await receiveSyntheticOtp(b, x)).disposition, 'COMPLETE');
  assert.deepEqual(await receiptCounts(), { mail: 1, received: 1, accepted: 1, attempts: 1, consumed: 0 });
  evidence.atomicReceiveRollback = true;
});

test('receive preserves zero budget and synthetic rejection accounting without provider fallback', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = '0';
  try { assert.notEqual((await receiveSyntheticOtp(b, x)).disposition, 'COMPLETE'); }
  finally { process.env.EMAIL_ACCOUNT_DAILY_LIMIT = '300'; }
  const [mail] = await a.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "SyntheticMail"`); assert.equal(mail.n, 0);
  const y = await fixture(); await publishSyntheticOtp(a, y);
  await a.$executeRawUnsafe(`INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES ('EMAIL',$1::uuid,'REJECTED',1)`, y.jobId);
  assert.equal((await receiveSyntheticOtp(b, y)).disposition, 'REJECTED');
  const [charge] = await a.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS' AND count=1`);
  assert.equal(charge.n, 1);
});

test('receive refuses disabled staging and provider keys before any delivery mutation', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  process.env.SKILLQUEST_STAGING_MODE = 'off';
  try { await assert.rejects(receiveSyntheticOtp(b, x)); }
  finally { process.env.SKILLQUEST_STAGING_MODE = 'synthetic-v1'; }
  for (const key of ['BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY']) {
    process.env[key] = 'forbidden-test-fixture';
    try { await assert.rejects(receiveSyntheticOtp(b, x)); } finally { delete process.env[key]; }
  }
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
});

test('uncertain synthetic acceptance remains uncertain and cannot be resent by repeating receive', async () => {
  const x = await fixture(); await publishSyntheticOtp(a, x);
  await a.$executeRawUnsafe(`INSERT INTO "SyntheticProviderFault" (provider,id,outcome,remaining) VALUES ('EMAIL',$1::uuid,'ACCEPTED_RESPONSE_LOST',1)`, x.jobId);
  assert.equal((await receiveSyntheticOtp(b, x)).disposition, 'UNCERTAIN');
  const before = await receiptCounts();
  assert.deepEqual(before, { mail: 1, received: 1, accepted: 0, attempts: 1, consumed: 0 });
  await assert.rejects(receiveSyntheticOtp(a, x)); assert.deepEqual(await receiptCounts(), before);
});

test('cumulative client latency can exhaust the receive transaction without a SQL lock wait', { timeout: 30000 }, async () => {
  const target = await fixture(); await publishSyntheticOtp(a, target);
  const latencyMs = 100;
  function delayed(client: PrismaClient, budgetOverride?: number) {
    const measurement = { queries: 0, elapsedMs: 0, transactionBudgetMs: budgetOverride ?? 15000 };
    const db = {
      $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
      $transaction: (work: any, options: any) => client.$transaction(async tx => {
        const start = Date.now();
        const view = new Proxy(tx, { get(inner, property) {
          if (property === '$queryRawUnsafe' || property === '$executeRawUnsafe') return async (...args: any[]) => {
            measurement.queries++; await delay(latencyMs);
            return (inner as any)[property](...args);
          };
          const value = (inner as any)[property]; return typeof value === 'function' ? value.bind(inner) : value;
        } });
        try { return await work(view); } finally { measurement.elapsedMs = Date.now() - start; }
      }, budgetOverride ? { ...options, timeout: budgetOverride } : options),
    } as unknown as PrismaClient;
    return { db, measurement };
  }
  const original = delayed(a, 5000); // Preserve the pre-fix deadline as regression control.
  await assert.rejects(receiveSyntheticOtp(original.db, target), (error: any) => error?.code === 'P2028');
  assert.deepEqual(await receiptCounts(), { mail: 0, received: 0, accepted: 0, attempts: 0, consumed: 0 });
  const control = delayed(b); // Exercise the actual corrected service, no budget override.
  assert.equal((await receiveSyntheticOtp(control.db, target)).disposition, 'COMPLETE');
  assert.deepEqual(await receiptCounts(), { mail: 1, received: 1, accepted: 1, attempts: 1, consumed: 0 });
  assert.ok(control.measurement.queries * latencyMs > 5000);
  evidence.cumulativeLatency = { perQueryDelayMs: latencyMs, original: original.measurement, control: control.measurement,
    conclusion: 'Controlled client latency, real Prisma/PostgreSQL, no competing transaction and no HTTP provider' };
});
