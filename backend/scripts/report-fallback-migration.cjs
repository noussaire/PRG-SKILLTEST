// No dotenv, client import, connection or child process in --check-local.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('./report-fallback-migration-manifest.json');
const root = path.resolve(__dirname, '../prisma/migrations');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(root, name, 'migration.sql'));

function validateUrl(value) {
  try {
    const u = new URL(value);
    assert.equal(u.protocol, 'postgresql:');
    assert.equal(u.hostname, manifest.expectedHost);
    assert.equal(u.pathname, '/' + manifest.database);
    assert.equal(decodeURIComponent(u.username), manifest.role);
    assert.ok(u.password && (!u.port || u.port === '5432') && !u.hash);
    assert.deepEqual(u.searchParams.getAll('sslmode'), ['verify-full']);
    for (const name of u.searchParams.keys()) {
      assert.ok(['sslmode', 'channel_binding', 'connect_timeout'].includes(name));
      assert.equal(u.searchParams.getAll(name).length, 1);
    }
    if (u.searchParams.has('channel_binding')) assert.equal(u.searchParams.get('channel_binding'), 'require');
    if (u.searchParams.has('connect_timeout')) assert.match(u.searchParams.get('connect_timeout'), /^(?:[1-9]|[12][0-9]|30)$/);
    return value;
  } catch { throw Error('NEON_URL_REFUSED'); }
}

function checkLocal() {
  assert.equal(manifest.baseline.length, 21);
  assert.equal(manifest.target, '20261105000100_report_fallback_email');
  const expected = [...manifest.baseline, manifest.migration];
  assert.deepEqual(fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(), expected.map(e => e.name).sort());
  for (const item of expected) assert.equal(hash(read(item.name)), item.sha256, 'LOCAL_MIGRATION_DRIFT');
  const original = read('20261031020000_job_publication_intents').toString().replace(/\r\n/g, '\n');
  const start = original.indexOf('CREATE VIEW "JobPublicationCandidate" AS');
  const end = original.indexOf('\n\nCREATE VIEW "JobPublicationReady"', start);
  assert.ok(start >= 0 && end > start);
  const expectedSQL = original.slice(start, end).replace('CREATE VIEW', 'CREATE OR REPLACE VIEW')
    .replace("AND j.status='COMPLETE' AND j.summary IS NOT NULL", "AND ((j.status='COMPLETE' AND j.summary IS NOT NULL) OR j.status='UNAVAILABLE')");
  const normalize = sql => sql.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(read(manifest.target).toString()), normalize(expectedSQL));
  const good = `postgresql://${manifest.role}:fixture@${manifest.expectedHost}/${manifest.database}?sslmode=verify-full`;
  validateUrl(good);
  const bad = [good.replace(manifest.expectedHost, 'other.neon.tech'), good.replace(manifest.expectedHost, manifest.expectedHost.replace('.c-', '-pooler.c-')),
    good.replace('neondb_owner', 'skillquest_runtime'), good.replace('/neondb?', '/skillquest-db?'), good.replace('verify-full', 'require'),
    good + '&sslmode=disable', good + '&host=other.neon.tech', good.replace('postgresql:', 'https:'), good + '#fragment', good.replace('/neondb?', ':5433/neondb?')];
  for (const value of bad) assert.throws(() => validateUrl(value), /NEON_URL_REFUSED/);
  return { target: manifest.target, baseline: 21, total: 22, checksum: manifest.migration.sha256, urlRejections: bad.length, networkCalls: 0, environmentChanges: 0 };
}

async function remote(mode, stagingId, projectId) {
  assert.match(stagingId ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  assert.match(projectId ?? '', /^prj_[a-zA-Z0-9]+$/);
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  const url = validateUrl(Buffer.concat(chunks).toString().trim());
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  async function verify(expectApplied = false) {
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5000ms'");
      const [identity] = await tx.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
      assert.equal(identity.db, manifest.database); assert.equal(identity.role, manifest.role);
      const rows = await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"');
      const applied = rows.some(r => r.migration_name === manifest.target);
      const wanted = [...manifest.baseline, ...(applied ? [manifest.migration] : [])];
      assert.equal(rows.length, wanted.length, 'REMOTE_HISTORY_UNEXPECTED');
      for (const item of wanted) {
        const r = rows.find(r => r.migration_name === item.name);
        assert.ok(r?.finished_at && !r.rolled_back_at, 'REMOTE_HISTORY_FAILED');
        assert.equal(r.checksum, item.sha256, 'REMOTE_CHECKSUM_DRIFT');
      }
      if (expectApplied) assert.ok(applied, 'TARGET_NOT_RECORDED');
      const markers = await tx.$queryRawUnsafe('SELECT "stagingId"::text AS id,"projectId" AS project,"databaseName" AS db FROM "SyntheticStagingInstallation" WHERE singleton=1');
      assert.equal(markers.length, 1); assert.equal(markers[0].id, stagingId); assert.equal(markers[0].project, projectId); assert.equal(markers[0].db, manifest.database);
      const [audit] = await tx.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM "User" WHERE role='ADMIN') AS admin,
        EXISTS(SELECT 1 FROM "User" WHERE email !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR
        EXISTS(SELECT 1 FROM "AdaptiveInterview" WHERE "displayName" NOT LIKE 'SYNTH-%' OR (email IS NOT NULL AND email !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$') OR ("emailIdentity" IS NOT NULL AND "emailIdentity" !~* '^[a-z0-9][a-z0-9._+-]{0,63}@example[.]test$')) OR
        EXISTS(SELECT 1 FROM "Participant" WHERE "displayName" NOT LIKE 'SYNTH-%') AS unsafe`);
      assert.ok(audit.admin && !audit.unsafe, 'SYNTHETIC_DATA_REQUIRED');
      const columns = await tx.$queryRawUnsafe(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='JobPublicationCandidate' ORDER BY ordinal_position`);
      assert.deepEqual(columns.map(c => c.column_name), ['kind', 'jobId', 'phase', 'generation', 'dueAt']);
      return applied;
    }, { timeout: 15000, maxWait: 3000 });
  }
  try {
    const applied = await verify();
    if (mode === '--apply' && !applied) {
      // Only the pinned target may be pending. Child environment is scoped to
      // this future explicit invocation; nothing is persisted to .env or Vercel.
      checkLocal();
      const { spawnSync } = require('node:child_process');
      const cli = require.resolve('prisma/build/index.js');
      const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 120000,
        env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      // Never echo Prisma errors: they may contain the private connection URL.
      assert.equal(result.status, 0, 'MIGRATE_DEPLOY_FAILED_REVIEW_REQUIRED');
      await verify(true);
    }
    console.log(JSON.stringify({ target: manifest.target, applied: mode === '--apply' || applied, mode }));
  } finally { await client.$disconnect(); }
}

if (require.main === module) (async () => {
  try {
    const mode = process.argv[2]; assert.ok(['--check-local', '--check-remote', '--apply'].includes(mode), 'EXPLICIT_MODE_REQUIRED');
    const result = checkLocal();
    if (mode === '--check-local') { console.log(JSON.stringify(result, null, 2)); return; }
    await remote(mode, process.argv[3], process.argv[4]);
  } catch { console.error('MIGRATION_REFUSED_OR_FAILED: no secret details logged; review required.'); process.exitCode = 1; }
})();
module.exports = { checkLocal, validateUrl };
