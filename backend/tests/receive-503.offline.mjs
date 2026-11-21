// Exact 46b1dde router/service, injected in-memory DB. No database or OTP created.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = path.join(project, 'output/receive-otp-final-candidate');
assert.equal(execFileSync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  '46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5');
for (const name of Object.keys(process.env)) {
  if (!['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP'].includes(name)) delete process.env[name];
}
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://offline@127.0.0.1:1/offline',
  DOTENV_CONFIG_PATH: path.join(project, 'backend/tests/absent-receive-503.env'),
  JOIN_CODE_PEPPER: 'public-offline-fixture-pepper-only-0123456789',
  SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS',
  SKILLQUEST_STAGING_ID: '11111111-1111-4111-8111-111111111111',
  SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 37).toString('base64url'), EMAIL_ACCOUNT_DAILY_LIMIT: '0' });
globalThis.fetch = () => { throw Error('OFFLINE_NETWORK_FORBIDDEN'); };
const load = name => import(pathToFileURL(path.join(candidate, 'backend/src', name)));
const security = await load('security/synthetic-staging.ts');
const { encryptOtpPayload } = await load('security/otp-payload.ts');
let activeDb;
globalThis.__skillquestSyntheticTestPrisma = new Proxy({}, { get(_target, property) {
  const value = activeDb[property]; return typeof value === 'function' ? value.bind(activeDb) : value;
} });
const { syntheticStagingRouter } = await load('routes/synthetic-staging.routes.ts');
const target = { jobId: '22222222-2222-4222-8222-222222222222', challengeId: '33333333-3333-4333-8333-333333333333',
  notificationId: '44444444-4444-4444-8444-444444444444', email: 'participant@example.test', fullName: 'SYNTH-Participant' };
const sqlError = code => Object.assign(new Error('OFFLINE_INJECTED_FAILURE'), { code });

function database(mode) {
  let state = { attempts: 0, status: 'PENDING', received: false }, attemptedIncrement = false, lastError;
  const savepoints = new Map();
  const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  // Contains no OTP; exercises only the existing payload envelope validation.
  const encrypted = encryptOtpPayload({ recipient: target.email, recipientName: target.fullName,
    subject: 'Local fixture', htmlContent: '<p>Message fictif sans code.</p>' }, target.jobId);
  return {
    get state() { return state; }, get attemptedIncrement() { return attemptedIncrement; }, get lastError() { return lastError; },
    adminSession: { async findUnique() { return { expiresAt, user: { role: 'ADMIN', email: 'admin@example.test' } }; } },
    async $transaction(work) {
      const before = structuredClone(state);
      try { return await work(this); } catch (error) { lastError = error; state = before; throw error; }
    },
    async $queryRawUnsafe(sql) {
      if (mode === 'connection' && sql.includes('current_database() AS name')) throw sqlError('P1001');
      if (sql.includes('current_database() AS name')) return [{ name: 'offline_fixture' }];
      if (sql.includes('SyntheticStagingInstallation')) return [{ valid: mode !== 'marker' }];
      if (sql.includes(' AS unsafe')) return [{ unsafe: false }];
      if (sql.includes('pg_advisory_xact_lock')) {
        if (mode === 'admission-lock') throw sqlError('57014'); return [{}];
      }
      if (sql.includes('count(*)::int AS count')) return [{ count: 0 }];
      if (sql.includes("provider='BREVO' FOR UPDATE")) {
        if (mode === 'provider-lock') throw sqlError('57014');
        if (mode === 'deadlock') throw sqlError('40P01');
        return [{ provider: 'BREVO' }];
      }
      if (sql.includes('SELECT j."encryptedPayload",n.payload')) {
        if (mode === 'transaction-expired') throw sqlError('P2028');
        if (mode === 'target-refused') return [];
        return [{ encryptedPayload: mode === 'payload-decryption' ? 'invalid-public-fixture' : encrypted, generation: 0, dueAt: now, payload: {
          version: 1, notificationId: target.notificationId, kind: 'OTP_INITIAL', jobId: target.jobId,
          phase: 'DELIVER', generation: 0, dueAt: now.toISOString(),
          otpTargetProof: mode === 'wrong-proof' ? 'x'.repeat(43) : security.syntheticOtpTargetProof(target) } }];
      }
      if (sql.includes('SELECT clock_timestamp() AS now')) return [{ now }];
      if (sql.includes('SELECT * FROM "ParticipantEmailDeliveryJob"')) return [{ id: target.jobId,
        challengeId: target.challengeId, codeHash: 'public-fixture', encryptedPayload: encrypted,
        status: state.status, attempts: state.attempts, expiresAt, attemptToken: null }];
      if (sql.includes('SELECT j.status,c."expiresAt"')) return [{ status: state.status, valid: true, captured: false, accepted: false }];
      if (sql.includes('FROM "EmailBudgetReservation"')) return [];
      if (sql.includes('SELECT c.id FROM "EmailOtpChallenge"') || sql.includes('SELECT j.id FROM "ParticipantEmailDeliveryJob"')) return [{ id: target.jobId }];
      throw Error('UNEXPECTED_OFFLINE_QUERY');
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('SAVEPOINT ')) savepoints.set(sql.slice(10), structuredClone(state));
      if (sql.startsWith('ROLLBACK TO SAVEPOINT ')) state = structuredClone(savepoints.get(sql.slice(22)));
      if (sql.includes("SET status='UNCERTAIN',attempts=attempts+1")) {
        state.status = 'UNCERTAIN'; state.attempts++; attemptedIncrement = true;
        if (mode === 'sql-after-claim') throw sqlError('57014');
      }
      if (sql.includes('SET status=$3')) state.status = args[2];
      if (sql.includes('UPDATE "SyntheticNotification" SET "receivedAt"')) state.received = true;
      return 1;
    },
  };
}

async function request(mode, data = target) {
  activeDb = database(mode);
  const router = syntheticStagingRouter();
  const body = Buffer.from(JSON.stringify(data)), url = '/api/internal/synthetic/notifications/receive';
  const authorization = 'Bearer ' + 'a'.repeat(64), id = '55555555-5555-4555-8555-555555555555', timestamp = String(Date.now());
  const headers = { authorization, 'x-skillquest-staging-id': id, 'x-skillquest-staging-time': timestamp,
    'x-skillquest-staging-proof': security.stagingProof('POST', url, body, authorization, id, timestamp) };
  const req = { method: 'POST', url: '/notifications/receive', originalUrl: url, body, headers,
    rawHeaders: Object.entries(headers).flat() };
  const res = { statusCode: 200, data: null, status(value) { this.statusCode = value; return this; },
    json(value) { this.data = value; return this; }, sendStatus(value) { this.statusCode = value; return this; } };
  // Invoke the exact final handler with already-buffered body and signed fixture.
  await router.stack.at(-1).handle(req, res);
  return { db: activeDb, res };
}

for (const mode of ['connection', 'marker', 'admission-lock', 'provider-lock', 'deadlock', 'transaction-expired', 'target-refused', 'wrong-proof', 'payload-decryption']) {
  test(`exact router maps ${mode} to generic 503 without committed delivery`, async () => {
    const { res, db } = await request(mode);
    assert.equal(res.statusCode, 503); assert.equal(res.data.code, 'SYNTHETIC_OPERATION_UNAVAILABLE');
    assert.equal(db.state.attempts, 0); assert.equal(db.state.received, false);
  });
}
test('SQL failure after an attempt increment yields 503 and outer rollback restores zero attempts', async () => {
  const { res, db } = await request('sql-after-claim');
  assert.equal(res.statusCode, 503); assert.equal(db.attemptedIncrement, true);
  assert.deepEqual(db.state, { status: 'PENDING', attempts: 0, received: false });
});
test('normal zero budget refusal commits a receipt and returns 200 rather than generic 503', async () => {
  const { res, db } = await request('zero-budget');
  assert.equal(res.statusCode, 200, db.lastError?.stack); assert.equal(res.data.disposition, 'REJECTED');
  assert.equal(db.state.attempts, 1); assert.equal(db.state.received, true);
});
test('malformed target is 400 rather than 503 after valid authentication', async () => {
  const { res } = await request('valid', { ...target, challengeId: 'invalid' });
  assert.equal(res.statusCode, 400);
});
test('invalid explicit staging configuration yields a separate 503 before database access', () => {
  const router = syntheticStagingRouter(), saved = process.env.SKILLQUEST_STAGING_SECRET;
  const res = { statusCode: 200, data: null, setHeader() {}, status(value) { this.statusCode = value; return this; },
    json(value) { this.data = value; return this; } };
  try {
    process.env.SKILLQUEST_STAGING_SECRET = 'invalid-public-fixture';
    router.stack[0].handle({}, res, () => { throw Error('UNEXPECTED_NEXT'); });
    assert.equal(res.statusCode, 503); assert.equal(res.data.code, 'SYNTHETIC_STAGING_UNAVAILABLE');
  } finally { process.env.SKILLQUEST_STAGING_SECRET = saved; }
});
