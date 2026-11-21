// Fully local disposable SkillQuest. No .env, cloud API, provider or Git mutation.
import fs from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { ORIGIN, hidden, configuration, material, authenticate, session, privateOtpView } from './synthetic-admin-launcher.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auto = process.argv.includes('--self-test');
assert.ok(process.argv.slice(2).every(a => a === '--self-test'), 'Use no arguments or --self-test');
assert.equal(process.versions.node.split('.')[0], '24');
const source = path.join(project, 'output/receive-otp-final-candidate');
assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), '46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5');
assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
const frontRequire = createRequire(path.join(project, 'frontend/package.json'));
const backRequire = createRequire(path.join(project, 'backend/package.json'));
const bin = path.join(project, 'output/pg-native-ef583905f4cd/portable/pgsql/bin');
const exe = n => path.join(bin, n + '.exe');
for (const n of ['initdb', 'postgres', 'pg_ctl', 'psql']) assert.ok(existsSync(exe(n)), 'Existing PostgreSQL portable binaries required');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(chrome, 'Existing Chrome or Edge required');
let password = auto ? randomBytes(24).toString('base64url') : await hidden('Choisir un mot de passe ADMIN purement LOCAL (12 caractères minimum, saisie masquée) : ');
assert.ok(password.length >= 12);
let secret = randomBytes(32).toString('base64url'), pepper = randomBytes(48).toString('base64url');
const output = path.join(project, 'output/local-synthetic'); await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, 'run-')), data = path.join(root, 'data'), workspace = path.join(root, 'workspace');
const nonce = randomUUID(), stagingId = randomUUID();
const save = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2));
await save('owner.json', { purpose: 'skillquest-local-e2e', nonce, root, data });
const systemEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(systemEnv, { TEMP: root, TMP: root, TMPDIR: root, NEXT_TELEMETRY_DISABLED: '1', DOTENV_CONFIG_PATH: path.join(root, 'absent.env') });
let port, backendPort, frontendPort, backend, frontend, browser, cleanupPromise;
let rpcSequence = 0, otpAttempted = false, otpCache, targetCache;
const pending = new Map();
const blockedRequests = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function command(name, file, args, env = systemEnv) {
  const out = openSync(path.join(root, name + '.stdout.log'), 'w'), err = openSync(path.join(root, name + '.stderr.log'), 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(file, args, { env, cwd: workspace, windowsHide: true, stdio: ['ignore', out, err] });
      const timer = setTimeout(() => child.kill(), 90000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, name + ' failed; inspect local setup log');
    return fs.readFile(path.join(root, name + '.stdout.log'), 'utf8');
  } finally { closeSync(out); closeSync(err); }
}
async function freePort() {
  const server = net.createServer(); await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const selected = server.address().port; await new Promise(r => server.close(r)); assert.notEqual(selected, 5432); return selected;
}
const sql = (name, text) => command(name, exe('psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'skillquest_local', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text]);
const blockedCopy = new Set(['node_modules', '.git', '.next', 'dist', 'output', '.vercel', '.synthetic-private']);
const copyFilter = file => !blockedCopy.has(path.basename(file)) && !path.basename(file).startsWith('.env') && !file.endsWith('.tsbuildinfo');
function rpc(action, extra = {}) {
  const id = ++rpcSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('LOCAL_RPC_TIMEOUT')); }, 20000);
    pending.set(id, { resolve, reject, timer });
    backend.stdin.write(JSON.stringify({ id, action, ...extra }) + '\n');
  });
}
async function waitReady(url, child) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error('LOCAL_APPLICATION_EXITED');
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; } catch {}
    await delay(300);
  }
  throw Error('LOCAL_APPLICATION_NOT_READY');
}
function localTransport(input, init) {
  const url = new URL(String(input));
  const allowed = new Set(['/api/v1/admin/auth/login', '/api/v1/admin/auth/logout', '/api/internal/synthetic/status',
    '/api/internal/synthetic/notifications/publish-otp', '/api/internal/synthetic/notifications/receive', '/api/internal/synthetic/mail/read']);
  // Official launcher uses a pinned production origin. Translate only its exact
  // approved paths to this owned local backend; NEVER send the original URL.
  if (url.origin !== ORIGIN || !allowed.has(url.pathname) || url.search || url.hash) throw Error('LOCAL_OPERATOR_PATH_FORBIDDEN');
  return fetch(`http://127.0.0.1:${backendPort}${url.pathname}`, { ...init, redirect: 'error' });
}
async function operateOtp(expectedChallenge) {
  assert.equal(otpAttempted, false, 'Un seul OTP par environnement : relancer un sandbox neuf si nécessaire');
  const target = await rpc('target');
  if (expectedChallenge) assert.equal(target.challengeId, expectedChallenge);
  otpAttempted = true; targetCache = target;
  let token = await authenticate(localTransport, password);
  const env = { SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId };
  try {
    for (const action of ['publish-otp', 'receive', 'mail']) {
      const config = configuration(env, action, target.email, target.jobId, target.notificationId, target.challengeId);
      const client = session(localTransport, config, material(secret), token);
      try {
        const result = await client.run();
        if (action === 'mail') { assert.match(result.otp, /^[0-9]{6}$/); otpCache = result.otp; }
        console.log('LOCAL ' + result.state);
      } finally { client.dispose(); }
    }
    return otpCache;
  } finally {
    await localTransport(ORIGIN + '/api/v1/admin/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    token = '';
  }
}
async function showCode() {
  assert.ok(otpCache && Date.parse(targetCache.expiresAt) > Date.now(), 'Code absent ou expiré');
  await privateOtpView(otpCache, url => console.log('Consulter personnellement le code, une fois : ' + url));
}
async function killOwned(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else child.kill('SIGTERM');
  for (let n = 0; n < 50 && child.exitCode === null; n++) await delay(50);
  assert.notEqual(child.exitCode, null, 'Owned application must stop');
}
async function portClosed(number) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: number });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', e => { socket.destroy(); resolve(e.code === 'ECONNREFUSED'); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}
function cleanup() {
  return cleanupPromise ??= (async () => {
    await browser?.close().catch(() => {});
    await killOwned(frontend);
    if (backend?.exitCode === null) { try { await rpc('stop'); } catch {} await killOwned(backend); }
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('LOCAL_STOPPED')); } pending.clear();
    const owner = JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8'));
    assert.equal(owner.nonce, nonce); assert.equal(owner.root, root); assert.equal(owner.data, data);
    assert.equal(path.dirname(await fs.realpath(root)), await fs.realpath(output));
    if (existsSync(path.join(data, 'postmaster.pid'))) {
      const lines = (await fs.readFile(path.join(data, 'postmaster.pid'), 'utf8')).split(/\r?\n/);
      assert.equal(await fs.realpath(lines[1]), await fs.realpath(data));
      await command('stop-postgres', exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
    }
    if (port) assert.equal(await portClosed(port), true);
    if (backendPort) assert.equal(await portClosed(backendPort), true);
    if (frontendPort) assert.equal(await portClosed(frontendPort), true);
    if (existsSync(data)) {
      const target = await fs.realpath(data); assert.equal(target, path.join(await fs.realpath(root), 'data'));
      assert.ok(target.startsWith((await fs.realpath(output)) + path.sep)); await fs.rm(target, { recursive: true });
    }
    secret = ''; pepper = ''; password = ''; otpCache = undefined;
    await save('shutdown.json', { postgresStopped: true, applicationPortsClosed: true, dataRemoved: !existsSync(data) });
  })();
}
process.once('SIGINT', () => { cleanup().then(() => process.exit(0), () => process.exit(1)); });
process.once('SIGTERM', () => { cleanup().then(() => process.exit(0), () => process.exit(1)); });

try {
  await fs.mkdir(workspace);
  await fs.cp(path.join(source, 'backend'), path.join(workspace, 'backend'), { recursive: true, filter: copyFilter });
  await fs.cp(path.join(source, 'shared'), path.join(workspace, 'shared'), { recursive: true, filter: copyFilter });
  await fs.cp(path.join(project, 'frontend'), path.join(workspace, 'frontend'), { recursive: true, filter: copyFilter });
  for (const name of ['local-synthetic-loader.mjs', 'local-synthetic-app.ts']) await fs.copyFile(path.join(project, 'backend/scripts', name), path.join(workspace, 'backend/scripts', name));
  const zod = path.dirname(backRequire.resolve('zod/package.json'));
  await fs.cp(zod, path.join(workspace, 'backend/node_modules/zod'), { recursive: true });
  // Prisma's generated module can discover env paths at import time. Relocate
  // its unmodified runtime and generated client beside the copied application,
  // where all .env files are absent, rather than loading the original client.
  await fs.cp(path.dirname(backRequire.resolve('@prisma/client/package.json')), path.join(workspace, 'node_modules/@prisma/client'), { recursive: true });
  await fs.cp(path.join(project, 'node_modules/.prisma/client'), path.join(workspace, 'node_modules/.prisma/client'), { recursive: true });
  await command('initdb', exe('initdb'), ['-D', data, '-U', 'skillquest_local', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  port = await freePort(); backendPort = await freePort(); frontendPort = await freePort();
  assert.equal(new Set([port, backendPort, frontendPort]).size, 3);
  await command('start-postgres', exe('pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c timezone=UTC`, '-w', 'start']);
  const identity = JSON.parse((await sql('identity', `SELECT json_build_object('directory',current_setting('data_directory'),
    'systemId',(SELECT system_identifier::text FROM pg_control_system()),'port',inet_server_port(),'listen',current_setting('listen_addresses'),
    'user',current_user,'tables',(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public'))`)).trim());
  assert.equal(await fs.realpath(identity.directory), await fs.realpath(data)); assert.equal(identity.listen, '127.0.0.1');
  assert.equal(identity.port, port); assert.equal(identity.user, 'skillquest_local'); assert.equal(identity.tables, 0);
  const migrations = (await fs.readdir(path.join(workspace, 'backend/prisma/migrations'))).filter(n => /^\d/.test(n)).sort();
  assert.equal(migrations.length, 23);
  for (const name of migrations) await command('schema-' + name, exe('psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'skillquest_local', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.join(workspace, 'backend/prisma/migrations', name, 'migration.sql')]);
  await save('context.json', { purpose: 'skillquest-local-e2e', nonce, root, data, port, backendPort, frontendPort, systemId: identity.systemId, migrations });
  const backendEnv = { ...systemEnv, NODE_ENV: 'development', PORT: String(backendPort),
    DATABASE_URL: `postgresql://skillquest_local@127.0.0.1:${port}/postgres?connection_limit=4&connect_timeout=3&pool_timeout=3&sslmode=disable`,
    JOIN_CODE_PEPPER: pepper, SKILLQUEST_PROXY_MODE: 'local', CORS_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS', SKILLQUEST_STAGING_ID: stagingId,
    SKILLQUEST_STAGING_SECRET: secret, EMAIL_ACCOUNT_DAILY_LIMIT: '300', EMAIL_OTHER_USAGE_MARGIN: '60', EMAIL_APP_DAILY_LIMIT: '240',
    REPORT_PDF_BROWSER_MODE: 'local', REPORT_CHROMIUM_EXECUTABLE: chrome, SKILLQUEST_LOCAL_RUN_CONTEXT: path.join(root, 'context.json') };
  const err = openSync(path.join(root, 'backend.stderr.log'), 'w'), appLog = openSync(path.join(root, 'backend.stdout.log'), 'w');
  backend = spawn(process.execPath, ['--loader', './backend/scripts/local-synthetic-loader.mjs', 'backend/scripts/local-synthetic-app.ts'],
    { cwd: workspace, env: backendEnv, windowsHide: true, stdio: ['pipe', 'pipe', err] }); closeSync(err);
  backend.once('exit', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('LOCAL_BACKEND_EXITED')); }
    pending.clear();
  });
  const rpcLines = createInterface({ input: backend.stdout });
  rpcLines.on('line', line => {
    if (!line.startsWith('LOCAL_RPC ')) { fs.appendFile(path.join(root, 'backend.stdout.log'), line + '\n').catch(() => {}); return; }
    const response = JSON.parse(line.slice(10)), request = pending.get(response.id); if (!request) return;
    pending.delete(response.id); clearTimeout(request.timer);
    response.ok ? request.resolve(response.result) : request.reject(Error('LOCAL_COMMAND_FAILED'));
  }); closeSync(appLog);
  await rpc('bootstrap', { password });
  const frontOut = openSync(path.join(root, 'frontend.log'), 'w');
  frontend = spawn(process.execPath, [frontRequire.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '-p', String(frontendPort)],
    { cwd: path.join(workspace, 'frontend'), env: { ...systemEnv, NODE_ENV: 'development', API_INTERNAL_URL: `http://127.0.0.1:${backendPort}`,
      PUBLIC_APP_ORIGIN: `http://127.0.0.1:${frontendPort}`, SKILLQUEST_PROXY_MODE: 'local' }, windowsHide: true, stdio: ['ignore', frontOut, frontOut] }); closeSync(frontOut);
  const origin = `http://127.0.0.1:${frontendPort}`;
  await waitReady(origin + '/api/adaptive/config?lang=fr', frontend);
  console.log(`LOCAL READY — 23 migrations, base isolée, aucun worker automatique.\n${origin}/entretien/soft-skills\nAdmin : ${origin}/admin/login — admin@example.test\nRésultats : ${root}`);
  if (auto) {
    const { runLocalBrowserTest } = await import('./local-synthetic-browser.mjs');
    const result = await runLocalBrowserTest({ origin, chrome, root, password, operateOtp, rpc, frontRequire, setBrowser: b => { browser = b; }, blockedRequests });
    await save('results.json', result); console.log(JSON.stringify(result));
  } else {
    console.log('Dans une fenêtre privée : SYNTH-Participant / participant@example.test, majorité et consentement, sans option e-mail rapport.\nAprès demande du code, tapez otp ici. Commandes : otp, code, check, stop.');
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    for await (const line of terminal) {
      try {
        if (line.trim() === 'stop') { terminal.close(); break; }
        if (line.trim() === 'otp') { await operateOtp(); await showCode(); }
        else if (line.trim() === 'code') await showCode();
        else if (line.trim() === 'check') {
          console.log(JSON.stringify(await rpc('check')));
          console.log(`PDF FR : ${origin}/api/adaptive/me/report?lang=fr\nPDF AR : ${origin}/api/adaptive/me/report?lang=ar`);
        } else console.log('Commandes : otp, code, check, stop.');
      } catch { console.log('LOCAL STOP : vérifier le formulaire et les prérequis. Aucune reprise OTP automatique.'); }
    }
  }
} catch (error) {
  await save('failure.json', { code: 'LOCAL_TEST_FAILED', message: String(error.message).replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{40,}/g, '[REDACTED]') });
  console.error('LOCAL TEST FAILED — voir les journaux locaux de préparation : ' + root); process.exitCode = 1;
} finally {
  try { await cleanup(); console.log('LOCAL STOPPED — applications arrêtées, base jetable supprimée.'); }
  catch { console.error('LOCAL CLEANUP INCOMPLETE — conserver le dossier pour vérification : ' + root); process.exitCode = 1; }
}
