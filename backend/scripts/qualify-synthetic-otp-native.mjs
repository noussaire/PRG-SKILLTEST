// LOCAL ONLY. Fresh owned cluster, explicit loopback identity, no inherited DSN/.env.
import fs from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(project);
assert.equal(process.versions.node.split('.')[0], '24');
assert.equal(process.argv[2], '--pg-bin'); assert.equal(process.argv.length, 4);
const bin = path.resolve(process.argv[3]), exe = n => path.join(bin, n + (process.platform === 'win32' ? '.exe' : ''));
for (const name of ['postgres', 'pg_ctl', 'initdb', 'psql']) assert.ok(existsSync(exe(name)), 'Existing native PostgreSQL binaries required');
const output = path.join(project, 'output/otp-native-qualification'); await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, 'run-')), data = path.join(root, 'data'), nonce = randomUUID();
const write = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2));
await write('owner.json', { purpose: 'skillquest-otp-native', nonce, root, data });
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { TEMP: root, TMP: root, TMPDIR: root });
let port, testExit = null, cleanupOK = false;
async function command(name, file, args, extraEnv = {}) {
  const out = openSync(path.join(root, name + '.stdout.log'), 'wx');
  const err = openSync(path.join(root, name + '.stderr.log'), 'wx');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd: project, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', out, err] });
      const timer = setTimeout(() => child.kill(), 60000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
  } finally { closeSync(out); closeSync(err); }
}
async function must(name, file, args) {
  assert.equal(await command(name, file, args), 0, name + ' failed; inspect local logs');
  return fs.readFile(path.join(root, name + '.stdout.log'), 'utf8');
}
const sql = (name, text) => must(name, exe('psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'otp_native', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text]);
const closed = p => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: p });
  socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', e => { socket.destroy(); resolve(e.code === 'ECONNREFUSED'); });
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
try {
  await must('version', exe('postgres'), ['--version']);
  await must('initdb', exe('initdb'), ['-D', data, '-U', 'otp_native', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  const server = net.createServer(); await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  port = server.address().port; await new Promise(r => server.close(r)); assert.notEqual(port, 5432);
  await must('start', exe('pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c timezone=UTC`, '-w', 'start']);
  const identity = JSON.parse((await sql('identity', `SELECT json_build_object('directory',current_setting('data_directory'),
    'systemId',(SELECT system_identifier::text FROM pg_control_system()),'port',inet_server_port(),
    'listen',current_setting('listen_addresses'),'user',current_user,'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public'))`)).trim());
  assert.equal(await fs.realpath(identity.directory), await fs.realpath(data));
  assert.equal(identity.port, port); assert.equal(identity.listen, '127.0.0.1'); assert.equal(identity.user, 'otp_native'); assert.equal(Number(identity.tables), 0);
  await write('identity.json', identity);
  for (const name of (await fs.readdir('backend/prisma/migrations')).filter(n => /^\d/.test(n)).sort()) {
    await must('schema-' + name, exe('psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'otp_native', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.resolve('backend/prisma/migrations', name, 'migration.sql')]);
  }
  const context = path.join(root, 'context.json');
  await write('context.json', { purpose: 'skillquest-otp-native', nonce, root, data, port, systemId: identity.systemId, schemaLoaded: true });
  testExit = await command('tests', process.execPath, ['--loader', './backend/tests/helpers/local-typescript-loader.mjs', '--test', '--test-concurrency=1', 'backend/tests/synthetic-otp-publication.native.cases.ts'],
    { NODE_ENV: 'test', SKILLQUEST_OTP_NATIVE_CONTEXT: context, DOTENV_CONFIG_PATH: path.join(root, 'absent.env') });
  assert.equal(testExit, 0, 'Native qualification failed; inspect tests logs');
} catch (error) {
  process.exitCode = 1; await write('failure.json', { message: error.message }); console.error(error.message);
} finally {
  try {
    const owner = JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8'));
    assert.equal(owner.nonce, nonce); assert.equal(owner.data, data); assert.equal(owner.root, root);
    assert.equal(path.dirname(await fs.realpath(root)), await fs.realpath(output));
    if (existsSync(path.join(data, 'postmaster.pid'))) {
      const lines = (await fs.readFile(path.join(data, 'postmaster.pid'), 'utf8')).split(/\r?\n/);
      assert.equal(await fs.realpath(lines[1]), await fs.realpath(data));
      await must('stop', exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
    }
    if (existsSync(path.join(data, 'PG_VERSION'))) assert.equal(await command('status', exe('pg_ctl'), ['-D', data, 'status']), 3);
    assert.equal(existsSync(path.join(data, 'postmaster.pid')), false);
    if (port) assert.equal(await closed(port), true);
    if (existsSync(data)) {
      const target = await fs.realpath(data);
      assert.equal(target, path.join(await fs.realpath(root), 'data'));
      assert.ok(target.startsWith((await fs.realpath(output)) + path.sep));
      await fs.rm(target, { recursive: true });
    }
    cleanupOK = true;
    await write('shutdown.json', { testExit, stopped: true, portClosed: true, dataRemoved: !existsSync(data) });
  } catch (error) { process.exitCode = 1; await write('cleanup-failed.json', { message: error.message }); }
  console.log(JSON.stringify({ root, testExit, cleanupOK }));
}
