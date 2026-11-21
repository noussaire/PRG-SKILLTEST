// Deterministic public fixtures, no real secret, database, provider or .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = path.join(project, 'output/receive-otp-final-candidate');
assert.equal(execFileSync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  '46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5');
const retained = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']);
for (const key of Object.keys(process.env)) if (!retained.has(key)) delete process.env[key];
globalThis.fetch = () => { throw Error('OFFLINE_ROTATION_NETWORK_FORBIDDEN'); };
const load = name => import(pathToFileURL(path.join(candidate, 'backend/src', name)));
const staging = await load('security/synthetic-staging.ts');
const payloads = await load('security/otp-payload.ts');
const providers = await load('security/provider-mode.ts');
const { emailSubjectHash } = await load('services/email-limits.ts');
const stagingId = '9ca8e522-2f42-45a4-831e-a070d7ac7cc7';
const A = Buffer.alloc(32, 17).toString('base64url');
const B = Buffer.alloc(32, 34).toString('base64url');
const target = { jobId: '00000000-0000-4000-8000-000000000001',
  challengeId: '00000000-0000-4000-8000-000000000002', notificationId: '00000000-0000-4000-8000-000000000003',
  fullName: 'SYNTH-Participant', email: 'participant@example.test' };
function configure(secret) {
  Object.assign(process.env, { NODE_ENV: 'test', JOIN_CODE_PEPPER: 'public-fixture-pepper-independent-of-staging-0123456789',
    SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId,
    SKILLQUEST_STAGING_SECRET: secret });
}
const proof = () => staging.stagingProof('POST', '/api/internal/synthetic/status', Buffer.from('{}'),
  'Bearer ' + 'a'.repeat(64), target.notificationId, '1794268800000');

test('new staging secret preserves staging installation identity', () => {
  configure(A); const before = staging.stagingConfiguration();
  configure(B); const after = staging.stagingConfiguration();
  assert.equal(after.id, before.id); assert.equal(after.project, before.project);
  assert.notDeepEqual(after.material, before.material);
});
test('HTTP proofs signed with the old fixture are refused after rotation', () => {
  configure(A); const old = proof(); configure(B);
  assert.equal(staging.validStagingProof(old, proof()), false);
  assert.equal(staging.validStagingProof(proof(), proof()), true);
});
test('old OTP target binding is refused; newly signed exact binding succeeds', () => {
  configure(A); const old = staging.syntheticOtpTargetProof(target); configure(B);
  assert.equal(staging.validStagingProof(old, staging.syntheticOtpTargetProof(target)), false);
  assert.equal(staging.validStagingProof(staging.syntheticOtpTargetProof(target), staging.syntheticOtpTargetProof(target)), true);
  assert.equal(staging.validStagingProof(staging.syntheticOtpTargetProof(target),
    staging.syntheticOtpTargetProof({ ...target, challengeId: target.jobId })), false);
});
test('old captured mail cannot be decrypted; new captured mail can', () => {
  configure(A); const old = staging.sealSyntheticMail(target.jobId, { simulated: true });
  configure(B); assert.throws(() => staging.openSyntheticMail(target.jobId, old), /SYNTHETIC_MAIL_INVALID/);
  const current = staging.sealSyntheticMail(target.jobId, { simulated: true });
  assert.deepEqual(staging.openSyntheticMail(target.jobId, current), { simulated: true });
});
test('rollback to old deployment environment restores old captures and proofs only', () => {
  configure(A); const old = staging.sealSyntheticMail(target.jobId, { generation: 'old-fixture' });
  const oldProof = proof(), oldTarget = staging.syntheticOtpTargetProof(target);
  configure(B); const current = staging.sealSyntheticMail(target.jobId, { generation: 'new-fixture' });
  configure(A);
  assert.deepEqual(staging.openSyntheticMail(target.jobId, old), { generation: 'old-fixture' });
  assert.equal(staging.validStagingProof(oldProof, proof()), true);
  assert.equal(staging.validStagingProof(oldTarget, staging.syntheticOtpTargetProof(target)), true);
  assert.throws(() => staging.openSyntheticMail(target.jobId, current), /SYNTHETIC_MAIL_INVALID/);
});
test('OTP job encryption and identity hashes are independent of staging rotation', () => {
  configure(A);
  const saved = payloads.encryptOtpPayload({ recipient: target.email, localFixture: true }, target.jobId);
  const identity = emailSubjectHash('IDENTITY', target.email);
  configure(B);
  assert.deepEqual(payloads.decryptOtpPayload(saved, target.jobId), { recipient: target.email, localFixture: true });
  assert.equal(emailSubjectHash('IDENTITY', target.email), identity);
});
test('installation marker remains valid across rotation, with SELECT-only fake database', async () => {
  const db = { async $queryRawUnsafe(sql, id, projectId) {
    assert.match(sql.trim(), /^SELECT\b/i);
    if (sql.includes('current_database() AS name')) return [{ name: 'local_synthetic_fixture' }];
    if (sql.includes('SyntheticStagingInstallation')) return [{ valid: id === stagingId && projectId === null }];
    if (sql.includes(' AS unsafe')) return [{ unsafe: false }];
    throw Error('UNEXPECTED_FIXTURE_QUERY');
  } };
  configure(A); await staging.assertSyntheticDatabase(db);
  configure(B); await staging.assertSyntheticDatabase(db);
});
test('real providers remain disabled even if their permission flags are set', () => {
  for (const secret of [A, B]) {
    configure(secret);
    for (const provider of ['BREVO', 'GROQ', 'QSTASH']) {
      process.env['SKILLQUEST_ALLOW_REAL_' + provider] = '1';
      assert.equal(providers.realProviderAllowed(provider), false);
      assert.throws(() => providers.providerFetch(provider, 'https://example.test', {}), /REAL_TRANSPORT_DISABLED/);
    }
  }
});
