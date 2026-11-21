// Security and diagnostic verification test suite for receive route instrumentation
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AUTHORIZED_RECEIVE_STEPS,
  AUTHORIZED_ERROR_CATEGORIES,
  extractDbCode,
  sanitizeCorrelationId,
  extractCorrelationId,
  categorizeReceiveError,
  formatReceiveDiagnosticLog,
} from '../src/security/synthetic-receive-diagnostic.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = path.join(project, 'output/receive-otp-final-candidate');

for (const name of Object.keys(process.env)) {
  if (!['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP'].includes(name)) delete process.env[name];
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://offline@127.0.0.1:1/offline',
  DOTENV_CONFIG_PATH: path.join(project, 'backend/tests/absent-receive-503.env'),
  JOIN_CODE_PEPPER: 'public-offline-fixture-pepper-only-0123456789',
  SKILLQUEST_STAGING_MODE: 'synthetic-v1',
  SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS',
  SKILLQUEST_STAGING_ID: '11111111-1111-4111-8111-111111111111',
  SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 37).toString('base64url'),
  EMAIL_ACCOUNT_DAILY_LIMIT: '0'
});
globalThis.fetch = () => { throw Error('OFFLINE_NETWORK_FORBIDDEN'); };

const load = name => import(pathToFileURL(path.join(candidate, 'backend/src', name)));
const security = await load('security/synthetic-staging.ts');
const { encryptOtpPayload } = await load('security/otp-payload.ts');
let activeDb;
globalThis.__skillquestSyntheticTestPrisma = new Proxy({}, {
  get(_target, property) {
    const value = activeDb[property];
    return typeof value === 'function' ? value.bind(activeDb) : value;
  }
});
const { syntheticStagingRouter } = await load('routes/synthetic-staging.routes.ts');

const target = {
  jobId: '22222222-2222-4222-8222-222222222222',
  challengeId: '33333333-3333-4333-8333-333333333333',
  notificationId: '44444444-4444-4444-8444-444444444444',
  email: 'participant@example.test',
  fullName: 'SYNTH-Participant'
};
const sqlError = code => Object.assign(new Error('OFFLINE_INJECTED_FAILURE'), { code });

function database(mode) {
  let state = { attempts: 0, status: 'PENDING', received: false };
  const savepoints = new Map();
  const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  const encrypted = encryptOtpPayload({
    recipient: target.email,
    recipientName: target.fullName,
    subject: 'Local fixture',
    htmlContent: '<p>Message fictif sans code.</p>'
  }, target.jobId);

  return {
    get state() { return state; },
    adminSession: { async findUnique() { return { expiresAt, user: { role: 'ADMIN', email: 'admin@example.test' } }; } },
    async $transaction(work) {
      const before = structuredClone(state);
      try { return await work(this); } catch (error) { state = before; throw error; }
    },
    async $queryRawUnsafe(sql) {
      if (mode === 'connection' && sql.includes('current_database() AS name')) throw sqlError('P1001');
      if (sql.includes('current_database() AS name')) return [{ name: 'offline_fixture' }];
      if (sql.includes('SyntheticStagingInstallation')) return [{ valid: mode !== 'marker' }];
      if (sql.includes(' AS unsafe')) return [{ unsafe: false }];
      if (sql.includes('pg_advisory_xact_lock')) {
        if (mode === 'admission-lock') throw sqlError('57014');
        return [{}];
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
        return [{
          encryptedPayload: mode === 'payload-decryption' ? 'invalid-public-fixture' : encrypted,
          generation: 0,
          dueAt: now,
          payload: {
            version: 1,
            notificationId: target.notificationId,
            kind: 'OTP_INITIAL',
            jobId: target.jobId,
            phase: 'DELIVER',
            generation: 0,
            dueAt: now.toISOString(),
            otpTargetProof: mode === 'wrong-proof' ? 'x'.repeat(43) : security.syntheticOtpTargetProof(target)
          }
        }];
      }
      if (sql.includes('SELECT clock_timestamp() AS now')) return [{ now }];
      if (sql.includes('SELECT * FROM "ParticipantEmailDeliveryJob"')) return [{
        id: target.jobId,
        challengeId: target.challengeId,
        codeHash: 'public-fixture',
        encryptedPayload: encrypted,
        status: state.status,
        attempts: state.attempts,
        expiresAt,
        attemptToken: null
      }];
      if (sql.includes('SELECT j.status,c."expiresAt"')) return [{ status: state.status, valid: true, captured: false, accepted: false }];
      if (sql.includes('FROM "EmailBudgetReservation"')) return [];
      if (sql.includes('SELECT c.id FROM "EmailOtpChallenge"') || sql.includes('SELECT j.id FROM "ParticipantEmailDeliveryJob"')) return [{ id: target.jobId }];
      throw Error('UNEXPECTED_OFFLINE_QUERY');
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('SAVEPOINT ')) savepoints.set(sql.slice(10), structuredClone(state));
      if (sql.startsWith('ROLLBACK TO SAVEPOINT ')) state = structuredClone(savepoints.get(sql.slice(22)));
      if (sql.includes("SET status='UNCERTAIN',attempts=attempts+1")) {
        state.status = 'UNCERTAIN'; state.attempts++;
        if (mode === 'sql-after-claim') throw sqlError('57014');
      }
      if (sql.includes('SET status=$3')) state.status = args[2];
      if (sql.includes('UPDATE "SyntheticNotification" SET "receivedAt"')) state.received = true;
      return 1;
    },
  };
}

async function executeReceiveRequest(mode, customHeaders = {}) {
  activeDb = database(mode);
  const router = syntheticStagingRouter();
  const body = Buffer.from(JSON.stringify(target));
  const url = '/api/internal/synthetic/notifications/receive';
  const authorization = 'Bearer ' + 'a'.repeat(64);
  const id = '55555555-5555-4555-8555-555555555555';
  const timestamp = String(Date.now());
  const stagingProof = security.stagingProof('POST', url, body, authorization, id, timestamp);

  const headers = {
    authorization,
    'x-skillquest-staging-id': id,
    'x-skillquest-staging-time': timestamp,
    'x-skillquest-staging-proof': stagingProof,
    ...customHeaders
  };

  const req = {
    method: 'POST',
    url: '/notifications/receive',
    originalUrl: url,
    body,
    headers,
    rawHeaders: Object.entries(headers).flat()
  };

  const res = {
    statusCode: 200,
    data: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.data = value; return this; },
    sendStatus(value) { this.statusCode = value; return this; }
  };

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await router.stack.at(-1).handle(req, res);
  } finally {
    console.error = originalError;
  }

  return { res, logs };
}

// 1. Correlation ID extraction and sanitization tests
test('extractCorrelationId prefers x-vercel-id from Vercel runtime', () => {
  const req = {
    headers: {
      'x-vercel-id': '2ts7h-1794264280593-bcc389f503b1',
      'x-request-id': 'req-fallback-id',
      'x-skillquest-staging-id': '55555555-5555-4555-8555-555555555555'
    }
  };
  assert.equal(extractCorrelationId(req), '2ts7h-1794264280593-bcc389f503b1');
});

test('extractCorrelationId falls back to x-request-id then valid staging UUID', () => {
  const req1 = {
    headers: {
      'x-request-id': 'custom-trace-id-1234',
      'x-skillquest-staging-id': '55555555-5555-4555-8555-555555555555'
    }
  };
  assert.equal(extractCorrelationId(req1), 'custom-trace-id-1234');

  const req2 = {
    headers: {
      'x-skillquest-staging-id': '55555555-5555-4555-8555-555555555555'
    }
  };
  assert.equal(extractCorrelationId(req2), '55555555-5555-4555-8555-555555555555');
});

test('sanitizeCorrelationId rejects non-alphanumeric and dangerous tokens', () => {
  assert.equal(sanitizeCorrelationId('<script>'), 'UNKNOWN_CORRELATION_ID');
  assert.equal(sanitizeCorrelationId('Bearer token1234'), 'UNKNOWN_CORRELATION_ID');
  assert.equal(sanitizeCorrelationId('with space'), 'UNKNOWN_CORRELATION_ID');
  assert.equal(sanitizeCorrelationId('a'.repeat(65)), 'UNKNOWN_CORRELATION_ID');
  assert.equal(sanitizeCorrelationId('2ts7h-1794264280593-bcc389f503b1'), '2ts7h-1794264280593-bcc389f503b1');
});

// 2. Prisma code and SQLSTATE extraction tests
test('extractDbCode extracts valid Prisma codes and 5-char SQLSTATE only', () => {
  assert.equal(extractDbCode({ code: 'P1001' }), 'P1001');
  assert.equal(extractDbCode({ code: 'P2028' }), 'P2028');
  assert.equal(extractDbCode({ code: '57014' }), '57014');
  assert.equal(extractDbCode({ code: '40P01' }), '40P01');
  assert.equal(extractDbCode({ meta: { code: '22012' } }), '22012');
  assert.equal(extractDbCode({ cause: { code: '08006' } }), '08006');
  assert.equal(extractDbCode({ code: 'SELECT * FROM secret' }), null);
  assert.equal(extractDbCode(new Error('no code')), null);
});

// 3. Category validation
test('categorizeReceiveError adheres to strictly authorized categories', () => {
  const timeout = categorizeReceiveError('RECEIVE_PROVIDER_LOCK', { code: '57014' });
  assert.equal(timeout.category, 'DATABASE_TIMEOUT');
  assert.equal(timeout.dbCode, '57014');
  assert.ok(AUTHORIZED_ERROR_CATEGORIES.has(timeout.category));

  const deadlock = categorizeReceiveError('RECEIVE_PROVIDER_LOCK', { code: '40P01' });
  assert.equal(deadlock.category, 'DATABASE_LOCK_CONFLICT');
  assert.equal(deadlock.dbCode, '40P01');
  assert.ok(AUTHORIZED_ERROR_CATEGORIES.has(deadlock.category));

  const conn = categorizeReceiveError('ADMISSION_DB_ASSERTION', { code: 'P1001' });
  assert.equal(conn.category, 'DATABASE_CONNECTION');
  assert.equal(conn.dbCode, 'P1001');
  assert.ok(AUTHORIZED_ERROR_CATEGORIES.has(conn.category));

  const expired = categorizeReceiveError('RECEIVE_TARGET_FETCH_AND_LOCK', { code: 'P2028' });
  assert.equal(expired.category, 'DATABASE_TRANSACTION_EXPIRED');
  assert.equal(expired.dbCode, 'P2028');
  assert.ok(AUTHORIZED_ERROR_CATEGORIES.has(expired.category));
});

// 4. End-to-end route diagnostic tests with Vercel request ID
test('route logs exactly the Vercel request ID on timeout 57014 during provider lock', async () => {
  const vercelId = '2ts7h-1794264280593-bcc389f503b1';
  const { res, logs } = await executeReceiveRequest('provider-lock', { 'x-vercel-id': vercelId });

  assert.equal(res.statusCode, 503);
  assert.equal(res.data.code, 'SYNTHETIC_OPERATION_UNAVAILABLE');
  assert.equal(logs.length, 1);

  const log = logs[0];
  assert.match(log, /^\[RECEIVE_DIAGNOSTIC\] step=RECEIVE_PROVIDER_LOCK category=DATABASE_TIMEOUT dbCode=57014 correlationId=2ts7h-1794264280593-bcc389f503b1$/);
});

test('route logs exactly deadlock 40P01 with Vercel request ID', async () => {
  const vercelId = '2ts7h-1794264280593-bcc389f503b1';
  const { res, logs } = await executeReceiveRequest('deadlock', { 'x-vercel-id': vercelId });

  assert.equal(res.statusCode, 503);
  assert.equal(res.data.code, 'SYNTHETIC_OPERATION_UNAVAILABLE');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[RECEIVE_DIAGNOSTIC\] step=RECEIVE_PROVIDER_LOCK category=DATABASE_LOCK_CONFLICT dbCode=40P01 correlationId=2ts7h-1794264280593-bcc389f503b1$/);
});

test('route logs connection failure P1001 during admission assertion', async () => {
  const vercelId = '2ts7h-1794264280593-bcc389f503b1';
  const { res, logs } = await executeReceiveRequest('connection', { 'x-vercel-id': vercelId });

  assert.equal(res.statusCode, 503);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[RECEIVE_DIAGNOSTIC\] step=ADMISSION_DB_ASSERTION category=DATABASE_CONNECTION dbCode=P1001 correlationId=2ts7h-1794264280593-bcc389f503b1$/);
});

test('route logs transaction expired P2028 during target fetch', async () => {
  const vercelId = '2ts7h-1794264280593-bcc389f503b1';
  const { res, logs } = await executeReceiveRequest('transaction-expired', { 'x-vercel-id': vercelId });

  assert.equal(res.statusCode, 503);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[RECEIVE_DIAGNOSTIC\] step=RECEIVE_TARGET_FETCH_AND_LOCK category=DATABASE_TRANSACTION_EXPIRED dbCode=P2028 correlationId=2ts7h-1794264280593-bcc389f503b1$/);
});

test('route logs target proof invalid when proof does not match', async () => {
  const vercelId = '2ts7h-1794264280593-bcc389f503b1';
  const { res, logs } = await executeReceiveRequest('wrong-proof', { 'x-vercel-id': vercelId });

  assert.equal(res.statusCode, 503);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[RECEIVE_DIAGNOSTIC\] step=RECEIVE_TARGET_PROOF_VERIFY category=TARGET_PROOF_INVALID dbCode=NONE correlationId=2ts7h-1794264280593-bcc389f503b1$/);
});

// 5. Absolute redaction and non-leakage guarantee
test('diagnostic logs NEVER contain secrets, OTP, HMAC proofs, tokens, cookies, ciphertext, or PII', async () => {
  const sensitiveTokens = [
    process.env.SKILLQUEST_STAGING_SECRET,
    process.env.JOIN_CODE_PEPPER,
    target.email,
    target.fullName,
    'a'.repeat(64), // Bearer token
    'invalid-public-fixture',
    'password',
    'secret'
  ];

  for (const mode of ['connection', 'marker', 'admission-lock', 'provider-lock', 'deadlock', 'transaction-expired', 'target-refused', 'wrong-proof', 'payload-decryption', 'sql-after-claim']) {
    const { logs } = await executeReceiveRequest(mode, { 'x-vercel-id': '2ts7h-1794264280593-bcc389f503b1' });
    for (const logLine of logs) {
      for (const sensitive of sensitiveTokens) {
        if (sensitive) {
          assert.equal(logLine.includes(sensitive), false, `Sensitive token ${sensitive} found in log: ${logLine}`);
        }
      }
      // Ensure only authorized steps and categories appear
      assert.match(logLine, /^\[RECEIVE_DIAGNOSTIC\] step=([A-Z_]+) category=([A-Z_]+) dbCode=([A-Z0-9]+) correlationId=([a-zA-Z0-9_.-]+)$/);
      const parts = logLine.match(/^\[RECEIVE_DIAGNOSTIC\] step=([A-Z_]+) category=([A-Z_]+) dbCode=([A-Z0-9]+) correlationId=([a-zA-Z0-9_.-]+)$/);
      assert.ok(AUTHORIZED_RECEIVE_STEPS.has(parts[1]), `Unauthorized step: ${parts[1]}`);
      assert.ok(AUTHORIZED_ERROR_CATEGORIES.has(parts[2]), `Unauthorized category: ${parts[2]}`);
    }
  }
});

