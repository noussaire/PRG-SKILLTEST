// Preview package only. Run BEFORE importing the application or Prisma.
import assert from 'node:assert/strict';
export function assertReceivePreview(env) {
  assert.equal(env.VERCEL, '1', 'PREVIEW_VERCEL_REQUIRED');
  assert.equal(env.VERCEL_ENV, 'preview', 'PREVIEW_ENVIRONMENT_REQUIRED');
  assert.match(env.SKILLQUEST_PREVIEW_PROJECT_ID ?? '', /^prj_[a-zA-Z0-9]+$/);
  assert.equal(env.VERCEL_PROJECT_ID, env.SKILLQUEST_PREVIEW_PROJECT_ID, 'PREVIEW_PROJECT_MISMATCH');
  assert.equal(env.SKILLQUEST_STAGING_VERCEL_PROJECT_ID, env.SKILLQUEST_PREVIEW_PROJECT_ID, 'PREVIEW_MARKER_PROJECT');
  assert.equal(env.SKILLQUEST_STAGING_MODE, 'synthetic-v1', 'PREVIEW_SYNTHETIC_REQUIRED');
  assert.equal(env.SKILLQUEST_DISPATCH_ENABLED, '0', 'PREVIEW_DISPATCH_FORBIDDEN');
  for (const key of ['BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
    'SKILLQUEST_DISPATCH_SECRET', 'SKILLQUEST_MAINTENANCE_SECRET']) assert.ok(!env[key], 'PREVIEW_PROVIDER_OR_SCHEDULER_FORBIDDEN');
  for (const key of ['SKILLQUEST_ALLOW_REAL_BREVO', 'SKILLQUEST_ALLOW_REAL_GROQ', 'SKILLQUEST_ALLOW_REAL_QSTASH']) {
    assert.equal(env[key], '0', 'PREVIEW_REAL_PROVIDER_FORBIDDEN');
  }
  const hosts = (env.SKILLQUEST_PREVIEW_DB_HOSTS ?? '').split(',');
  assert.ok(hosts.length > 0 && hosts.every(host => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)), 'PREVIEW_HOST_ALLOWLIST');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    let url; try { url = new URL(env[key]); } catch { throw Error('PREVIEW_DB_CONFIGURATION'); }
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PREVIEW_DB_PROTOCOL');
    assert.ok(hosts.includes(url.hostname), 'PREVIEW_DB_HOST_MISMATCH');
    assert.equal(decodeURIComponent(url.pathname), '/skillquest_receive_preview', 'PREVIEW_DB_NAME_MISMATCH');
    assert.equal(decodeURIComponent(url.username), 'skillquest_receive_preview', 'PREVIEW_DB_ROLE_MISMATCH');
    assert.equal(url.searchParams.get('sslmode'), 'require', 'PREVIEW_DB_TLS_REQUIRED');
  }
}
