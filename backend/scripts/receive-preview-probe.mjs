// Explicit future Preview-only probe. No real provider and no automatic retry.
import assert from 'node:assert/strict';
import { hidden, material, authenticate, configuration, session, ORIGIN, post, failureSummary } from './synthetic-admin-launcher.mjs';
import { previewTransport } from './receive-preview-transport.mjs';
import { signProof } from '../../shared/network-proof.mjs';
const [origin, stagingId, flag] = process.argv.slice(2);
assert.equal(flag, '--authorized-preview-otp');
const hostname = new URL(origin).hostname;
const env = { SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId };
const email = 'receive-diagnostic@example.test';
// Validate all public configuration before asking for credentials.
configuration(env, 'status', email, stagingId);
previewTransport(origin, hostname, 'public-validation-fixture', () => { throw Error('NO_REQUEST'); });
let key, proxyKey = '', token = '', primary;
let fetcher;
try {
  assert.equal(await hidden(`Confirmer Preview ${hostname} uniquement : taper PREVIEW : `), 'PREVIEW');
  const bypass = await hidden('Secret Vercel Automation du projet Preview (masqué) : ');
  fetcher = previewTransport(origin, hostname, bypass);
  key = material(await hidden('Secret staging du Preview (masqué) : '));
  proxyKey = await hidden('Clé proxy HMAC base64 du Preview (masqué) : ');
  token = await authenticate(fetcher, await hidden('Mot de passe ADMIN du Preview (masqué) : '));
  const run = async (action, jobId = stagingId, notificationId, challengeId) => {
    const client = session(fetcher, configuration(env, action, email, jobId, notificationId, challengeId), Buffer.from(key), token);
    try { return await client.run(); } finally { client.dispose(); }
  };
  assert.equal((await run('status')).state, 'SYNTHETIC_STATUS_OK');
  const path = '/api/v1/adaptive/start', body = JSON.stringify({ fullName: 'SYNTH-Participant', email,
    language: 'fr', consent: true, adult: true, emailReport: false });
  const proof = signProof(proxyKey, 'skillquest-api', 'POST', path, body, '', '127.0.0.1/32');
  const response = await fetcher(ORIGIN + path, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', 'x-skillquest-proxy-proof': proof }, body });
  const data = await response.json();
  assert.equal(response.status, 409, 'EXPECTED_NEW_PREVIEW_CHALLENGE');
  assert.equal(data.code, 'EMAIL_VERIFICATION_REQUIRED', 'PREVIEW_CHALLENGE_NOT_CONFIRMED');
  assert.match(data.challengeId ?? '', /^[a-f0-9-]{36}$/i);
  console.log('PREVIEW_CHALLENGE_ID ' + data.challengeId);
  console.log('Dans la base Preview uniquement, relever les UUID job/notification avec la requête du guide.');
  const jobId = await hidden('jobId du nouveau challenge Preview : ');
  const notificationId = await hidden('notificationId de cette publication Preview : ');
  console.log((await run('publish-otp', jobId, notificationId, data.challengeId)).state);
  console.log((await run('receive', jobId, notificationId, data.challengeId)).state);
} catch (error) { primary = error; }
finally {
  proxyKey = '';
  try { if (token && fetcher) await post(fetcher, '/api/v1/admin/auth/logout', '{}', { authorization: `Bearer ${token}` }); }
  catch (error) { primary ??= error; }
  token = ''; key?.fill(0);
}
if (primary) { console.error(failureSummary(primary)); process.exitCode = 1; }
