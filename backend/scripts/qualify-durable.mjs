// LOCAL ONLY. Never reads .env or accepts a database URL. Requires binaries
// already present; creates, verifies and finally stops its own loopback cluster.
import fs from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(project);
const args = process.argv.slice(2), index = args.indexOf('--pg-bin');
assert.ok(index >= 0 && args[index + 1], 'Provide existing --pg-bin directory');
const bin = path.resolve(args[index + 1]);
const tests = args.filter((_, n) => n !== index && n !== index + 1);
const selected = tests.length ? tests : ['backend/tests/provider-mode.test.ts', 'backend/tests/durable-dispatch-native.test.ts', 'backend/tests/qstash-adapter.test.ts', 'backend/tests/report-fallback-email.test.ts', 'backend/tests/final-email-pdf-validation.test.ts'];
for (const file of selected) assert.match(file, /^backend\/tests\/[a-z0-9-]+\.(test|cases)\.ts$/);
const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
for (const name of ['postgres', 'pg_ctl', 'initdb', 'psql']) assert.ok(existsSync(exe(name)), 'Existing binary required: ' + name);
const output = path.join(project, 'output/lot4-durable');
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, 'native-')), data = path.join(root, 'data'), nonce = randomUUID();
const write = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2));
await write('owner.json', { purpose: 'skillquest-lot4-native', nonce, root, data });
// Allowlist OS variables only; discard every inherited application credential.
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { TEMP: root, TMP: root, TMPDIR: root, DOTENV_CONFIG_PATH: '__no_environment_file_for_local_tests__' });
async function command(name, file, argv, extra = {}) {
  const log = openSync(path.join(root, name + '.log'), 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(file, argv, { cwd: project, env: { ...env, ...extra }, windowsHide: true, stdio: ['ignore', log, log] });
      child.once('error', reject); child.once('exit', resolve);
    });
    return { code, output: await fs.readFile(path.join(root, name + '.log'), 'utf8') };
  } finally { closeSync(log); }
}
async function must(name, file, argv) { const result = await command(name, file, argv); assert.equal(result.code, 0, name + ': ' + result.output); return result.output; }
let port, exitCode = 1;
try {
  await must('initdb', exe('initdb'), ['-D', data, '-U', 'lot4_synthetic', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); port = socket.address().port;
  await new Promise(r => socket.close(r)); assert.notEqual(port, 5432);
  await must('start', exe('pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c timezone=UTC`, '-w', 'start']);
  const sqlArgs = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'lot4_synthetic', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const identity = JSON.parse((await must('identity', exe('psql'), [...sqlArgs, '-At', '-c', `SELECT json_build_object('directory',current_setting('data_directory'),'systemId',(SELECT system_identifier::text FROM pg_control_system()),'port',inet_server_port(),'listen',current_setting('listen_addresses'),'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public'))`])).trim());
  assert.equal(await fs.realpath(identity.directory), await fs.realpath(data)); assert.equal(identity.port, port); assert.equal(identity.listen, '127.0.0.1'); assert.equal(identity.tables, 0);
  await write('identity-before-migrations.json', identity);
  const migrations = [];
  for (const folder of (await fs.readdir('backend/prisma/migrations', { withFileTypes: true })).filter(f => f.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.resolve('backend/prisma/migrations', folder.name, 'migration.sql');
    migrations.push({ name: folder.name, sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
    await must('migration-' + folder.name, exe('psql'), [...sqlArgs, '-f', file]);
  }
  await write('migrations.json', migrations);
  const context = path.join(root, 'context.json');
  await write('context.json', { root, data, port, systemId: identity.systemId, nonce, migrationsVerified: true });
  const guard = pathToFileURL(path.resolve('backend/tests/helpers/local-only-network.mjs')).href;
  const outcomes = [];
  for (const file of selected) {
    // A clean schema per suite, still in the same freshly owned cluster.
    await must('reset-' + path.basename(file), exe('psql'), [...sqlArgs, '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
    for (const migration of migrations) await must('reset-migration-' + migration.name, exe('psql'), [...sqlArgs, '-f', path.resolve('backend/prisma/migrations', migration.name, 'migration.sql')]);
    const result = await command(path.basename(file), process.execPath, ['--import', guard, '--import', 'tsx', '--test', '--test-concurrency=1', file], { NODE_ENV: 'test', LOT4_NATIVE_CONTEXT: context });
    const counts = Object.fromEntries(['tests','pass','fail','skipped'].map(key => [key, Number(result.output.match(new RegExp('(?:# |ℹ )' + key + ' (\\d+)'))?.[1] ?? 0)]));
    outcomes.push({ file, exitCode: result.code, ...counts }); console.log(JSON.stringify(outcomes.at(-1)));
  }
  exitCode = outcomes.every(r => r.exitCode === 0) ? 0 : 1;
  await write('results.json', { localOnly: true, realProvidersCalled: false, outcomes });
} catch (error) { console.error(error.message); await write('failure.json', { message: error.message }); }
finally {
  const owner = JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8'));
  assert.equal(owner.nonce, nonce); assert.equal(owner.data, data); assert.equal(path.dirname(await fs.realpath(root)), await fs.realpath(output));
  if (existsSync(path.join(data, 'postmaster.pid'))) await must('stop', exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  assert.equal(existsSync(path.join(data, 'postmaster.pid')), false);
  // Retain local data for inspection. No recursive deletion or borrowed server.
  await write('shutdown.json', { stopped: true, exitCode, retainedLocalData: true });
  console.log(JSON.stringify({ root, exitCode })); process.exitCode = exitCode;
}
