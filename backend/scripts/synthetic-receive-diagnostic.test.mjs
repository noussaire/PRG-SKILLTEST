import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, session, material, post, failureSummary } from './synthetic-admin-launcher.mjs';
import { emailLimits } from '../../output/receive-otp-final-candidate/backend/src/services/email-limits.ts';
import { rateLimit } from '../../output/receive-otp-final-candidate/backend/src/security/http-rate-limit.ts';

const fixture = { stagingId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222',
  notificationId: '33333333-3333-4333-8333-333333333333', challengeId: '44444444-4444-4444-8444-444444444444' };
const env = { SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: fixture.stagingId };
const config = () => configuration(env, 'receive', 'participant@example.test', fixture.jobId, fixture.notificationId, fixture.challengeId);
const status = () => ({ simulated: true, mail: [], notifications: [{ id: fixture.notificationId, receivedAt: null,
  payload: { notificationId: fixture.notificationId, jobId: fixture.jobId, kind: 'OTP_INITIAL', phase: 'DELIVER',
    version: 1, otpTargetProof: 'b'.repeat(43) } }] });
async function outcome(replies) {
  let calls = 0;
  const client = session(async () => { calls++; return replies.shift(); }, config(), Buffer.alloc(32, 37), 'a'.repeat(64));
  try { return { result: await client.run(), calls }; }
  catch (error) { return { error, summary: failureSummary(error), calls }; }
  finally { client.dispose(); }
}
const json = data => new Response(JSON.stringify(data));

test('missing notification stops locally before receive', async () => {
  const data = status(); data.notifications = [];
  const result = await outcome([json(data)]);
  assert.equal(result.calls, 1); assert.match(result.summary, /code=TARGET_NOTIFICATION_NOT_CONFIRMED/);
});
test('missing target proof stops locally before receive', async () => {
  const data = status(); delete data.notifications[0].payload.otpTargetProof;
  const result = await outcome([json(data)]);
  assert.equal(result.calls, 1); assert.match(result.summary, /TARGET_NOTIFICATION_NOT_CONFIRMED/);
});
test('unconfirmed challenge is rejected before any network call', () => {
  assert.throws(() => configuration(env, 'receive', 'participant@example.test', fixture.jobId, fixture.notificationId), error => {
    assert.match(failureSummary(error), /code=TARGET_INVALID/); return true;
  });
});
test('backend refusal is distinguished from missing notification without reading its body', async () => {
  const result = await outcome([json(status()), new Response('private-body-not-to-be-revealed', { status: 503 })]);
  assert.equal(result.calls, 2); assert.match(result.summary, /code=REQUEST_FAILED_NO_RETRY stage=RECEIVE http=503/);
  assert.doesNotMatch(result.summary, /private-body/);
});
test('DEFERRED stops without retry or mail access', async () => {
  const result = await outcome([json(status()), json({ simulated: true, disposition: 'DEFERRED', ...fixture })]);
  assert.equal(result.calls, 2); assert.match(result.summary, /code=DELIVERY_NOT_COMPLETE_NO_RETRY/);
});
test('complete exact delivery remains successful', async () => {
  const result = await outcome([json(status()), json({ simulated: true, disposition: 'COMPLETE', ...fixture })]);
  assert.equal(result.calls, 2); assert.equal(result.result.state, 'TARGET_DELIVERY_COMPLETE');
});
test('default email budget is zero; synthetic transport still uses the budget', () => {
  assert.equal(emailLimits({}).dailyBudget, 0);
  assert.equal(emailLimits({ EMAIL_ACCOUNT_DAILY_LIMIT: '300' }).dailyBudget, 240);
});
test('transport failure records only stage, and arbitrary errors are never printed', async () => {
  await assert.rejects(post(async () => { throw Error('private-network-error'); }, '/api/internal/synthetic/status', '{}'), error => {
    assert.match(failureSummary(error), /stage=STATUS http=UNAVAILABLE/);
    assert.doesNotMatch(failureSummary(error), /private-network-error/); return true;
  });
  assert.doesNotMatch(failureSummary(new Error('private-token-value')), /private-token-value/);
  const key = material(Buffer.alloc(32, 37).toString('base64url')); key.fill(0);
});

test('unexpected forwarded header logs a validation warning but still calls next below the limit', async () => {
  const logged = [], originalError = console.error;
  console.error = error => { logged.push(error?.code); };
  try {
    const middleware = rateLimit({ windowMs: 60000, limit: 5, standardHeaders: false, legacyHeaders: false });
    const request = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.1' }, method: 'POST',
      app: { get: name => name === 'trust proxy' ? false : undefined } };
    const response = { on() {}, setHeader() {}, status() { throw Error('UNEXPECTED_RATE_LIMIT_BLOCK'); } };
    await new Promise((resolve, reject) => {
      middleware(request, response, error => error ? reject(error) : resolve());
    });
    assert.ok(logged.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR'));
  } finally { console.error = originalError; }
});
