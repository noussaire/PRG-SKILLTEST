import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReceivePreview } from '../scripts/receive-preview-guard.mjs';
import { previewTransport } from '../scripts/receive-preview-transport.mjs';
import { ORIGIN } from '../scripts/synthetic-admin-launcher.mjs';
const fixture = () => ({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_fixture',
  SKILLQUEST_PREVIEW_PROJECT_ID: 'prj_fixture', SKILLQUEST_STAGING_VERCEL_PROJECT_ID: 'prj_fixture',
  SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DISPATCH_ENABLED: '0',
  SKILLQUEST_ALLOW_REAL_BREVO: '0', SKILLQUEST_ALLOW_REAL_GROQ: '0', SKILLQUEST_ALLOW_REAL_QSTASH: '0',
  SKILLQUEST_PREVIEW_DB_HOSTS: 'ep-fixture.neon.tech',
  DATABASE_URL: 'postgresql://skillquest_receive_preview@ep-fixture.neon.tech/skillquest_receive_preview?sslmode=require',
  DIRECT_URL: 'postgresql://skillquest_receive_preview@ep-fixture.neon.tech/skillquest_receive_preview?sslmode=require' });
test('guard accepts only configured isolated preview target', () => assertReceivePreview(fixture()));
for (const [name, changes] of [
  ['production deployment', { VERCEL_ENV: 'production' }], ['other Vercel project', { VERCEL_PROJECT_ID: 'prj_other' }],
  ['production database', { DATABASE_URL: 'postgresql://prod@ep-other.neon.tech/production?sslmode=require' }],
  ['automatic dispatcher', { SKILLQUEST_DISPATCH_ENABLED: '1' }], ['real provider key', { BREVO_API_KEY: 'public-fixture' }],
  ['real provider permission', { SKILLQUEST_ALLOW_REAL_GROQ: '1' }],
]) test(`guard refuses ${name}`, () => assert.throws(() => assertReceivePreview({ ...fixture(), ...changes })));
test('transport refuses production origin', () => assert.throws(() => previewTransport(ORIGIN, new URL(ORIGIN).hostname, 'fixture')));
test('transport maps only approved calls to exact Preview, preserving signed path/body', async () => {
  let calls = 0;
  const send = previewTransport('https://sq-diag-fixture.vercel.app', 'sq-diag-fixture.vercel.app', 'public-fixture', async (url, init) => {
    calls++; assert.equal(url, 'https://sq-diag-fixture.vercel.app/api/internal/synthetic/notifications/receive');
    assert.equal(init.redirect, 'error'); assert.equal(init.body, '{}');
    assert.equal(init.headers.get('x-vercel-protection-bypass'), 'public-fixture'); return new Response('{}');
  });
  await send(ORIGIN + '/api/internal/synthetic/notifications/receive', { method: 'POST', body: '{}' });
  await assert.rejects(send(ORIGIN + '/api/internal/synthetic/notifications/publish', { method: 'POST' }));
  await assert.rejects(send(ORIGIN + '/api/internal/synthetic/status?extra=1', { method: 'POST' }));
  assert.equal(calls, 1);
});
