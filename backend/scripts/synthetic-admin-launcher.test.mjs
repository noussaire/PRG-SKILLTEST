import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { configuration, material, proof, authenticate, session, hidden, post, privateOtpView, ORIGIN } from './synthetic-admin-launcher.mjs';
import { stagingProof } from '../src/security/synthetic-staging.ts';

const id = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const notification = '33333333-3333-4333-8333-333333333333';
const env = { SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: id };
const secret = Buffer.alloc(32, 37).toString('base64url'); // Test fixture only.
const token = 'a'.repeat(64);
const config = action => configuration(env, action, 'participant@example.test', job, notification, id);
const status = { simulated: true, notifications: [{ id: notification, receivedAt: null,
  payload: { notificationId: notification, jobId: job, kind: 'OTP_INITIAL', phase: 'DELIVER', version: 1, otpTargetProof: 'b'.repeat(43) } }],
  mail: [{ id: job, purpose: 'OTP', expiresAt: new Date(Date.now() + 60000).toISOString() }] };
const response = data => new Response(JSON.stringify(data));
function mocked(results) {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    calls.push({ url, options });
    assert.ok(url.startsWith(ORIGIN + '/')); assert.equal(options.redirect, 'error');
    if (!results.length) throw Error('unexpected network request');
    return response(results.shift());
  } };
}

test('refuses non-synthetic mode, real identities, provider keys and global publication', () => {
  for (const bad of [{ SKILLQUEST_STAGING_MODE: 'off' }, { BREVO_API_KEY: 'fixture' }, { GROQ_API_KEY: 'fixture' },
    { QSTASH_TOKEN: 'fixture' }, { QSTASH_CURRENT_SIGNING_KEY: 'fixture' }, { QSTASH_NEXT_SIGNING_KEY: 'fixture' },
    { SKILLQUEST_STAGING_ID: 'invalid' }, { SKILLQUEST_STAGING_ACK: '' }]) {
    assert.throws(() => configuration({ ...env, ...bad }, 'receive', 'participant@example.test', job, notification));
  }
  assert.throws(() => configuration(env, 'receive', 'person@real.test', job, notification));
  assert.throws(() => configuration(env, 'publish', 'participant@example.test', job, notification), /GLOBAL_PUBLICATION_FORBIDDEN/);
  for (const action of ['job', 'cleanup', 'receive/../publish']) assert.throws(() => config(action));
});

test('requires canonical existing 32-byte secret', () => {
  assert.equal(material(secret).length, 32);
  for (const value of ['', secret + '=', 'short']) assert.throws(() => material(value));
});

test('signature matches official implementation and binds body, path and bearer', () => {
  const names = [...Object.keys(env), 'SKILLQUEST_STAGING_SECRET', 'VERCEL', 'NODE_ENV',
    'SKILLQUEST_STAGING_VERCEL_PROJECT_ID', 'OTP_ENCRYPTION_KEYS', 'JOIN_CODE_PEPPER', 'JOIN_CODE_PEPPER_PREVIOUS',
    'SKILLQUEST_PROXY_HMAC_KEY', 'SKILLQUEST_EDGE_HMAC_KEY', 'SKILLQUEST_MAINTENANCE_SECRET',
    'BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];
  const saved = names.map(k => process.env[k]);
  try {
    names.forEach(k => delete process.env[k]); Object.assign(process.env, env, { SKILLQUEST_STAGING_SECRET: secret });
    const path = '/api/internal/synthetic/status', body = '{}', auth = `Bearer ${token}`, timestamp = '1794000000000';
    const signed = proof(material(secret), id, path, body, auth, notification, timestamp);
    assert.equal(signed, stagingProof('POST', path, Buffer.from(body), auth, notification, timestamp));
    assert.notEqual(signed, proof(material(secret), id, path, '{ }', auth, notification, timestamp));
    assert.notEqual(signed, proof(material(secret), id, path + '/', body, auth, notification, timestamp));
    assert.notEqual(signed, proof(material(secret), id, path, body, 'Bearer ' + 'b'.repeat(64), notification, timestamp));
  } finally { names.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
});

test('uses normal login with fixed synthetic admin and rejects non-ADMIN response', async () => {
  const mock = mocked([{ token, admin: { email: 'admin@example.test', role: 'ADMIN' } }]);
  assert.equal(await authenticate(mock.fetcher, 'known-fixture-password'), token);
  assert.equal(mock.calls[0].url, ORIGIN + '/api/v1/admin/auth/login');
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), { email: 'admin@example.test', password: 'known-fixture-password' });
  await assert.rejects(authenticate(mocked([{ token, admin: { email: 'admin@example.test', role: 'STUDENT' } }]).fetcher, 'fixture'));
});

test('redacts transport/upstream errors, bounds responses and never retries', async () => {
  let count = 0;
  await assert.rejects(post(async () => { count++; throw Error('secret-should-not-escape'); }, '/test', '{}'), /^Error: REQUEST_FAILED_NO_RETRY$/);
  assert.equal(count, 1);
  await assert.rejects(post(async () => new Response('secret-body', { status: 401 }), '/test', '{}'), /^Error: REQUEST_FAILED_NO_RETRY$/);
  await assert.rejects(post(async () => new Response('x'.repeat(140000)), '/test', '{}'), /REQUEST_FAILED_NO_RETRY/);
});

test('receives exactly the confirmed OTP_INITIAL notification after signed status', async () => {
  const mock = mocked([structuredClone(status), { simulated: true, disposition: 'COMPLETE', jobId: job, challengeId: id, notificationId: notification }]);
  const key = material(secret), client = session(mock.fetcher, config('receive'), key, token);
  assert.deepEqual(await client.run(), { state: 'TARGET_DELIVERY_COMPLETE' });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[1].url, ORIGIN + '/api/internal/synthetic/notifications/receive');
  assert.deepEqual(JSON.parse(mock.calls[1].options.body), { notificationId: notification, jobId: job,
    challengeId: id, email: 'participant@example.test', fullName: 'SYNTH-Participant' });
  assert.notEqual(mock.calls[0].options.headers['x-skillquest-staging-id'], mock.calls[1].options.headers['x-skillquest-staging-id']);
  client.dispose(); assert.ok(key.every(b => b === 0));
});

test('wrong job, report, retake, received notification or missing simulation never reaches receive', async () => {
  for (const change of [s => s.notifications[0].payload.jobId = id,
    s => s.notifications[0].payload.kind = 'REPORT', s => s.notifications[0].payload.kind = 'OTP_RETAKE',
    s => s.notifications[0].receivedAt = '2026-01-01', s => s.simulated = false, s => s.notifications = [],
    s => delete s.notifications[0].payload.otpTargetProof]) {
    const data = structuredClone(status); change(data); const mock = mocked([data]);
    await assert.rejects(session(mock.fetcher, config('receive'), material(secret), token).run());
    assert.equal(mock.calls.length, 1);
  }
});

test('receive requires challenge and rejects substituted response IDs without fallback', async () => {
  assert.throws(() => configuration(env, 'receive', 'participant@example.test', job, notification), /TARGET_INVALID/);
  for (const change of [{ jobId: id }, { challengeId: job }, { notificationId: job }]) {
    const mock = mocked([status, { simulated: true, disposition: 'COMPLETE', jobId: job,
      challengeId: id, notificationId: notification, ...change }]);
    await assert.rejects(session(mock.fetcher, config('receive'), material(secret), token).run(), /DELIVERY_NOT_COMPLETE/);
    assert.equal(mock.calls.length, 2);
  }
  let calls = 0;
  await assert.rejects(session(async () => { calls++; return response(status); },
    config('receive'), material(secret), token).run());
  assert.equal(calls, 2);
});

test('UNCERTAIN delivery stops without retry or mail access', async () => {
  const mock = mocked([status, { simulated: true, disposition: 'UNCERTAIN' }]);
  await assert.rejects(session(mock.fetcher, config('receive'), material(secret), token).run(), /DELIVERY_NOT_COMPLETE/);
  assert.equal(mock.calls.length, 2);
});

test('normal logout invalidates launcher session and disposed sessions cannot send requests', async () => {
  const mock = mocked([{ success: true }]); const key = material(secret);
  const client = session(mock.fetcher, config('status'), key, token);
  await client.close();
  assert.equal(mock.calls[0].url, ORIGIN + '/api/v1/admin/auth/logout');
  assert.equal(mock.calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.ok(key.every(b => b === 0));
  await assert.rejects(client.run(), /SESSION_DISPOSED/);
  assert.equal(mock.calls.length, 1);
});

test('targeted publication uses one strict request with challenge identity and no global action', async () => {
  const cfg = configuration(env, 'publish-otp', 'participant@example.test', job, notification, id);
  const mock = mocked([{ simulated: true, published: 1, jobId: job, challengeId: id, notificationId: notification }]);
  assert.deepEqual(await session(mock.fetcher, cfg, material(secret), token).run(), { state: 'TARGET_OTP_PUBLISHED' });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, ORIGIN + '/api/internal/synthetic/notifications/publish-otp');
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), { jobId: job, challengeId: id,
    notificationId: notification, email: 'participant@example.test', fullName: 'SYNTH-Participant' });
  assert.throws(() => configuration(env, 'publish-otp', 'participant@example.test', job, notification));
});

test('missing targeted route and mismatched publication responses never fall back to batch or execution', async () => {
  const cfg = configuration(env, 'publish-otp', 'participant@example.test', job, notification, id);
  let calls = 0;
  await assert.rejects(session(async () => { calls++; return new Response(null, { status: 404 }); }, cfg, material(secret), token).run());
  assert.equal(calls, 1);
  for (const bad of [{ simulated: false, published: 1, jobId: job, challengeId: id, notificationId: notification },
    { simulated: true, published: 2, jobId: job, challengeId: id, notificationId: notification },
    { simulated: true, published: 1, jobId: id, challengeId: id, notificationId: notification }]) {
    const mock = mocked([bad]);
    await assert.rejects(session(mock.fetcher, cfg, material(secret), token).run(), /TARGET_PUBLICATION_UNCONFIRMED/);
    assert.equal(mock.calls.length, 1);
  }
});

test('mail verifies purpose, expiration, recipient and simulation; HTML is never rendered', async () => {
  const message = { simulated: true, recipient: 'participant@example.test', htmlContent: '<script>bad()</script><p>123456</p>' };
  assert.deepEqual(await session(mocked([status, message]).fetcher, config('mail'), material(secret), token).run(),
    { state: 'PRIVATE_OTP_READY', otp: '123456' });
  for (const bad of [{ ...message, recipient: 'other@example.test' }, { ...message, simulated: false },
    { ...message, htmlContent: '123456 654321' }]) {
    await assert.rejects(session(mocked([status, bad]).fetcher, config('mail'), material(secret), token).run());
  }
  for (const mail of [{ id: job, purpose: 'REPORT', expiresAt: new Date(Date.now() + 60000).toISOString() },
    { id: job, purpose: 'OTP', expiresAt: '2020-01-01' }]) {
    const mock = mocked([{ ...status, mail: [mail] }]);
    await assert.rejects(session(mock.fetcher, config('mail'), material(secret), token).run());
    assert.equal(mock.calls.length, 1);
  }
});

test('masked input emits no characters and restores raw mode on return/cancel', async () => {
  for (const cancel of [false, true]) {
    const input = new EventEmitter(); input.isTTY = true; input.isRaw = false;
    input.setRawMode = v => input.isRaw = v; input.resume = () => {}; input.pause = () => {};
    let output = ''; const pending = hidden('Prompt: ', input, { isTTY: true, write: s => output += s });
    input.emit('keypress', 'sensitive', {});
    input.emit('keypress', '', cancel ? { ctrl: true, name: 'c' } : { name: 'return' });
    if (cancel) await assert.rejects(pending, /CANCELLED/); else assert.equal(await pending, 'sensitive');
    assert.equal(output, 'Prompt: \n'); assert.equal(input.isRaw, false); assert.equal(input.listenerCount('keypress'), 0);
  }
  assert.throws(() => hidden('Prompt', { isTTY: false }, { isTTY: true }), /PRIVATE_TTY_REQUIRED/);
});

test('private OTP view rejects cross-site requests and serves once without disk', async () => {
  let announce; const ready = new Promise(resolve => announce = resolve);
  const closed = privateOtpView('123456', announce, 5000);
  const url = await ready;
  assert.equal((await fetch(url, { headers: { origin: 'https://foreign.test' } })).status, 403);
  const result = await fetch(url);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.match(result.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await result.text(), /123456/);
  await closed;
  await assert.rejects(fetch(url));
});
