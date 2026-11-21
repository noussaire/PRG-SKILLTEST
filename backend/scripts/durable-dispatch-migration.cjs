// Durable Dispatch Migration Runner & Pre-checks
// Safe, read-only by default; applies only on explicit --apply with stdin-supplied URL.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('./durable-dispatch-migration-manifest.json');
const root = path.resolve(__dirname, '../prisma/migrations');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(root, name, 'migration.sql'));

function sanitizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function validateUrl(raw) {
  const value = sanitizeUrl(raw);
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error('NEON_URL_REFUSED: INVALID_URL_SYNTAX (impossible de parser l\'URL)');
  }

  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
    throw new Error(`NEON_URL_REFUSED: PROTOCOL_INVALID (attendu: postgresql://, reçu: ${u.protocol}//)`);
  }
  u.protocol = 'postgresql:';

  if (u.hostname !== manifest.expectedHost) {
    if (u.hostname.includes('-pooler.')) {
      throw new Error(`NEON_URL_REFUSED: POOLER_ENDPOINT_FORBIDDEN (utilisez l'endpoint direct, pas le pooler: ${manifest.expectedHost})`);
    }
    throw new Error(`NEON_URL_REFUSED: HOST_MISMATCH (hôte attendu: ${manifest.expectedHost}, reçu: ${u.hostname})`);
  }

  const dbName = u.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (dbName !== manifest.database) {
    throw new Error(`NEON_URL_REFUSED: DATABASE_MISMATCH (base attendue: ${manifest.database}, reçue: ${dbName})`);
  }

  const user = decodeURIComponent(u.username || '');
  if (user !== manifest.role) {
    throw new Error(`NEON_URL_REFUSED: ROLE_MISMATCH (rôle attendu: ${manifest.role}, reçu: ${user})`);
  }

  if (!u.password) {
    throw new Error('NEON_URL_REFUSED: PASSWORD_MISSING (mot de passe manquant dans l\'URL)');
  }

  if (u.port && u.port !== '5432') {
    throw new Error(`NEON_URL_REFUSED: PORT_INVALID (port attendu: 5432 ou par défaut, reçu: ${u.port})`);
  }

  if (u.hash) {
    throw new Error('NEON_URL_REFUSED: HASH_FRAGMENT_FORBIDDEN (fragment # interdit)');
  }

  const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase();
  if (sslmode !== 'verify-full') {
    throw new Error(`NEON_URL_REFUSED: SSL_MODE_INVALID (sslmode doit être "verify-full", reçu: "${sslmode || 'aucun'}". Remplacez sslmode=require par sslmode=verify-full)`);
  }

  const allowedParams = new Set(['sslmode', 'channel_binding', 'connect_timeout']);
  for (const key of u.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      throw new Error(`NEON_URL_REFUSED: UNEXPECTED_QUERY_PARAM ("${key}" non autorisé. Paramètres permis: sslmode, channel_binding, connect_timeout)`);
    }
    if (u.searchParams.getAll(key).length > 1) {
      throw new Error(`NEON_URL_REFUSED: DUPLICATE_QUERY_PARAM ("${key}" présent plusieurs fois)`);
    }
  }

  if (u.searchParams.has('channel_binding')) {
    const cb = u.searchParams.get('channel_binding');
    if (cb !== 'require') {
      throw new Error(`NEON_URL_REFUSED: CHANNEL_BINDING_INVALID (channel_binding doit être "require", reçu: "${cb}")`);
    }
  }

  if (u.searchParams.has('connect_timeout')) {
    const ct = u.searchParams.get('connect_timeout');
    if (!/^(?:[1-9]|[12][0-9]|30)$/.test(ct)) {
      throw new Error(`NEON_URL_REFUSED: CONNECT_TIMEOUT_INVALID (connect_timeout doit être entre 1 et 30, reçu: "${ct}")`);
    }
  }

  return u.toString();
}

function checkLocal() {
  assert.equal(manifest.baseline.length, 22);
  assert.equal(manifest.target, '20261107000100_durable_dispatch');
  const expected = [...manifest.baseline, manifest.migration];
  assert.deepEqual(
    fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(),
    expected.map(e => e.name).sort()
  );
  for (const item of expected) {
    assert.equal(hash(read(item.name)), item.sha256, 'LOCAL_MIGRATION_DRIFT: ' + item.name);
  }
  return {
    target: manifest.target,
    baseline: 22,
    total: 23,
    checksum: manifest.migration.sha256,
    networkCalls: 0,
    environmentChanges: 0
  };
}

async function remote(mode) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const rawInput = Buffer.concat(chunks).toString().trim();
  if (!rawInput) throw Error('NO_URL_PROVIDED_ON_STDIN');
  const url = validateUrl(rawInput);
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: url, log: [] });

  async function verify(expectApplied = false) {
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5000ms'");

      const [identity] = await tx.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
      assert.equal(identity.db, manifest.database);
      assert.equal(identity.role, manifest.role);

      const rows = await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"');
      const applied = rows.some(r => r.migration_name === manifest.target);
      const wanted = [...manifest.baseline, ...(applied ? [manifest.migration] : [])];

      assert.equal(rows.length, wanted.length, 'REMOTE_HISTORY_UNEXPECTED: count=' + rows.length + ', wanted=' + wanted.length);
      for (const item of wanted) {
        const r = rows.find(r => r.migration_name === item.name);
        assert.ok(r?.finished_at && !r.rolled_back_at, 'REMOTE_HISTORY_FAILED: ' + item.name);
        assert.equal(r.checksum, item.sha256, 'REMOTE_CHECKSUM_DRIFT: ' + item.name);
      }

      if (expectApplied) {
        assert.ok(applied, 'TARGET_NOT_RECORDED');
        // Vérification des objets créés par durable_dispatch
        const tables = await tx.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('JobDispatchState','JobDispatchUsage')`);
        assert.equal(tables.length, 2, 'DURABLE_DISPATCH_TABLES_MISSING');
        const views = await tx.$queryRawUnsafe(`SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname IN ('JobLifetime','JobPublicationReady')`);
        assert.equal(views.length, 2, 'DURABLE_DISPATCH_VIEWS_MISSING');
        const [state] = await tx.$queryRawUnsafe(`SELECT singleton, cursor FROM "JobDispatchState" WHERE singleton=1`);
        assert.ok(state, 'JOB_DISPATCH_STATE_NOT_INITIALIZED');
      } else {
        assert.ok(!applied, 'TARGET_ALREADY_APPLIED');
      }
      return applied;
    }, { timeout: 15000, maxWait: 5000 });
  }

  try {
    const isApplied = await verify(false);
    if (mode === '--apply' && !isApplied) {
      checkLocal();
      const { spawnSync } = require('node:child_process');
      const cli = require.resolve('prisma/build/index.js');
      const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
        cwd: path.resolve(__dirname, '..'),
        windowsHide: true,
        encoding: 'utf8',
        timeout: 120000,
        env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      assert.equal(result.status, 0, 'MIGRATE_DEPLOY_FAILED_REVIEW_REQUIRED');
      await verify(true);
    }
    console.log(JSON.stringify({
      target: manifest.target,
      status: mode === '--apply' ? 'APPLIED_SUCCESSFULLY' : 'READY_NOT_YET_APPLIED',
      mode
    }));
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) (async () => {
  try {
    const mode = process.argv[2];
    assert.ok(['--check-local', '--check-remote', '--apply'].includes(mode), 'EXPLICIT_MODE_REQUIRED (--check-local | --check-remote | --apply)');
    const result = checkLocal();
    if (mode === '--check-local') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    await remote(mode);
  } catch (err) {
    console.error('MIGRATION_REFUSED_OR_FAILED: no secret details logged; review required.', err.message);
    process.exitCode = 1;
  }
})();

module.exports = { checkLocal, validateUrl };

