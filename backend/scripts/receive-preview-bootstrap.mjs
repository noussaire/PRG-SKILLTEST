// Future, explicitly authorized TEST database initialization. Never run by deploy.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { hidden } from './synthetic-admin-launcher.mjs';
import { assertReceivePreview } from './receive-preview-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [packagePath, projectId, stagingId, hosts, flag] = process.argv.slice(2);
assert.equal(flag, '--authorized-preview-database-writes');
const folder = path.resolve(packagePath);
assert.equal(path.dirname(folder), path.join(root, 'output/receive-preview'));
assert.match(path.basename(folder), /^package-[a-zA-Z0-9]+$/);
assert.match(projectId, /^prj_[a-zA-Z0-9]+$/);
assert.match(stagingId, /^[a-f0-9-]{36}$/i);
assert.equal(JSON.parse(await fs.readFile(path.join(folder, 'preview-manifest.json'), 'utf8')).base,
  '46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5');
const clean = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean, { NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(folder, 'absent.env'),
  SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
  SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId,
  SKILLQUEST_STAGING_VERCEL_PROJECT_ID: projectId, SKILLQUEST_PREVIEW_PROJECT_ID: projectId,
  SKILLQUEST_PREVIEW_DB_HOSTS: hosts, SKILLQUEST_DISPATCH_ENABLED: '0', SKILLQUEST_ALLOW_REAL_BREVO: '0',
  SKILLQUEST_ALLOW_REAL_GROQ: '0', SKILLQUEST_ALLOW_REAL_QSTASH: '0' });
process.env.DATABASE_URL = await hidden('DSN DIRECT de la base Preview vide (masqué) : ');
process.env.DIRECT_URL = process.env.DATABASE_URL;
assertReceivePreview({ ...process.env, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: projectId });
process.env.JOIN_CODE_PEPPER = await hidden('JOIN_CODE_PEPPER distinct du Preview (masqué) : ');
process.env.SKILLQUEST_STAGING_SECRET = await hidden('Secret staging distinct du Preview (masqué) : ');
const password = await hidden('Nouveau mot de passe ADMIN du Preview (masqué) : ');
assert.ok(password.length >= 12);
assert.equal(await hidden('Confirmer exclusivement la base de test : taper skillquest_receive_preview : '), 'skillquest_receive_preview');
const requirePackage = createRequire(path.join(folder, 'package.json'));
const prismaRuntime = requirePackage.resolve('@prisma/client');
assert.ok(prismaRuntime.startsWith(path.join(folder, 'node_modules') + path.sep), 'INSTALL_PACKAGE_DEPENDENCIES_FIRST');
const { PrismaClient } = requirePackage('@prisma/client');
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [], __internal: {
  configOverride: config => ({ ...config, relativeEnvPaths: { rootEnvPath: null, schemaEnvPath: null } }),
} });
try {
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS name,current_user AS role');
  assert.equal(identity.name, 'skillquest_receive_preview'); assert.equal(identity.role, 'skillquest_receive_preview');
  const [tables] = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  assert.equal(tables.n, 0, 'EMPTY_TEST_DATABASE_REQUIRED');
  const cli = requirePackage.resolve('prisma/build/index.js');
  const migration = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'],
    { cwd: folder, env: process.env, windowsHide: true, encoding: 'utf8' });
  assert.equal(migration.status, 0, 'PREVIEW_MIGRATIONS_FAILED'); // Never print DSN-bearing subprocess output.
  const { bootstrapSyntheticStaging } = await import(pathToFileURL(path.join(folder, 'backend/dist/services/synthetic-installation.service.js')));
  await bootstrapSyntheticStaging(db, { adminEmail: 'admin@example.test', password,
    explicitDatabaseName: 'skillquest_receive_preview', explicitProjectId: projectId });
  console.log('PREVIEW_DATABASE_BOOTSTRAPPED — 23 migrations, installation synthétique et ADMIN.');
} finally {
  await db.$disconnect();
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JOIN_CODE_PEPPER', 'SKILLQUEST_STAGING_SECRET']) delete process.env[key];
}
