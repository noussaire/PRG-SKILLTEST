import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { INTERVIEW_ID, project, validateSnapshot, snapshotSQL, cleanEnvironment } from '../scripts/recover-synthetic-report.mjs';

function fixture() {
  return { database: 'postgres', user: 'skillquest_local', address: '127.0.0.1/32', port: 55439, readonly: 'on',
    dataDirectory: path.join(project, 'output/local-synthetic/run-nBEqzk/data-recuperation'), syntheticInstallation: true,
    rows: [{ id: INTERVIEW_ID, displayName: 'SYNTH-Participant', email: 'participant@example.test',
      emailVerifiedAt: '2026-11-09T00:00:00Z', sessionId: null,
      state: { answers: Array.from({ length: 31 }, () => ({})), currentQuestion: null, summary: 'Sauvegardée' },
      job: { interviewId: INTERVIEW_ID, status: 'COMPLETE', summary: JSON.stringify({ fr: 'Sauvegardée', ar: 'خلاصة محفوظة' }) } }] };
}
test('accepts the exact saved synthetic report', () => assert.equal(validateSnapshot(fixture()).id, INTERVIEW_ID));
for (const [name, mutate] of [
  ['another port', value => { value.port = 5432; }],
  ['remote host', value => { value.address = '192.0.2.1'; }],
  ['writable transaction', value => { value.readonly = 'off'; }],
  ['original data directory', value => { value.dataDirectory = value.dataDirectory.replace('data-recuperation', 'data'); }],
  ['missing synthetic installation', value => { value.syntheticInstallation = false; }],
  ['another participant', value => { value.rows[0].displayName = 'SYNTH-Other'; }],
  ['another interview', value => { value.rows[0].id = '00000000-0000-4000-8000-000000000000'; }],
  ['real email', value => { value.rows[0].email = 'user@example.com'; }],
  ['unverified OTP', value => { value.rows[0].emailVerifiedAt = null; }],
  ['unfinished questions', value => { value.rows[0].state.answers.pop(); }],
  ['active question', value => { value.rows[0].state.currentQuestion = {}; }],
  ['unrelated report job', value => { value.rows[0].job.interviewId = 'other'; }],
  ['unfinished summary', value => { value.rows[0].job.status = 'PENDING'; }],
  ['missing saved Arabic summary', value => { value.rows[0].job.summary = JSON.stringify({ fr: 'Seulement français' }); }],
  ['multiple targets', value => { value.rows.push(structuredClone(value.rows[0])); }],
]) test(`rejects ${name}`, () => { const value = fixture(); mutate(value); assert.throws(() => validateSnapshot(value)); });

test('SQL uses read-only snapshot and excludes credential columns', () => {
  assert.match(snapshotSQL, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(snapshotSQL, /ROLLBACK;$/);
  assert.doesNotMatch(snapshotSQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|tokenHash|retakeCodeHash|passwordHash)\b/i);
  assert.equal(snapshotSQL.match(new RegExp(INTERVIEW_ID, 'g')).length, 1);
});
test('child environment excludes inherited provider and authentication credentials', () => {
  const env = cleanEnvironment('C:/local-recovery-test');
  for (const key of ['DATABASE_URL', 'NODE_OPTIONS', 'PGPASSWORD', 'BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'JOIN_CODE_PEPPER']) {
    assert.equal(env[key], undefined);
  }
  assert.equal(env.SKILLQUEST_STAGING_SECRET, Buffer.alloc(32).toString('base64url'));
  assert.ok(env.PGPASSFILE.endsWith('absent.pgpass'));
});
