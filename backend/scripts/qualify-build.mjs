// Local qualification only. Copies installed dependencies, never runs npm install,
// migrations or a provider. Both builds run in a NEW secret-free owned workspace.
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createBrotliDecompress } from 'node:zlib';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.versions.node.split('.')[0], '24', 'Qualification requires Node.js 24.x');
assert.ok(['win32', 'linux'].includes(process.platform) && process.arch === 'x64', 'This qualification targets Windows/Linux x64');
const output = join(root, 'output/build-qualification');
await fs.mkdir(output, { recursive: true });
const run = await fs.mkdtemp(join(output, 'run-'));
const workspace = join(run, 'workspace');
const nonce = randomUUID();
await fs.writeFile(join(run, 'owner.json'), JSON.stringify({ run, workspace, nonce }));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const write = (name, data) => fs.writeFile(join(run, name), JSON.stringify(data, null, 2));
const report = { node: process.version, platform: process.platform, arch: process.arch, run,
  linuxExecuted: process.platform === 'linux', vercelBuilderExecuted: false,
  dependencyInstallCacheTested: false, cycles: [] };
console.log(JSON.stringify({ run, step: 'copy-installed-dependencies' }));

try {
  // Use explicit source directories; never copy an .env, output or local runtime data.
  const copy = async (from, to, filter) => {
    await fs.mkdir(dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true, dereference: process.platform === 'win32', verbatimSymlinks: true, filter });
  };
  const noSecrets = path => !/^\.env(?:\.|$)/.test(path.split(/[\\/]/).at(-1));
  for (const name of ['src', 'prisma', 'assets']) await copy(join(root, 'backend', name), join(workspace, 'backend', name), noSecrets);
  for (const name of ['index.mjs', 'package.json', 'vercel.json', 'tsconfig.json']) await copy(join(root, 'backend', name), join(workspace, 'backend', name));
  for (const name of ['package.json', 'package-lock.json']) await copy(join(root, name), join(workspace, name));
  await copy(join(root, 'frontend/package.json'), join(workspace, 'frontend/package.json'));
  await copy(join(root, 'shared'), join(workspace, 'shared'), noSecrets);
  // Omit only the GENERATED client; all installed package versions are preserved.
  await copy(join(root, 'node_modules'), join(workspace, 'node_modules'), path => noSecrets(path) &&
    path !== join(root, 'node_modules/.prisma') && !/\.node\.tmp\d+$/.test(path));
  if (existsSync(join(root, 'backend/node_modules'))) await copy(join(root, 'backend/node_modules'), join(workspace, 'backend/node_modules'), noSecrets);
  assert.equal(existsSync(join(workspace, 'node_modules/.prisma/client')), false);
  const packages = await Promise.all(['', 'backend/', 'frontend/'].map(p => json(join(workspace, p, 'package.json'))));
  for (const p of packages) assert.equal(p.engines.node, '24.x');
  assert.equal(packages[1].scripts['build:vercel'], 'npm run db:generate && npm run build');
  assert.equal(packages[1].dependencies['@prisma/client'], '6.19.3');
  assert.equal(packages[1].devDependencies.prisma, '6.19.3');
  assert.equal((await json(join(workspace, 'backend/vercel.json'))).buildCommand, 'npm run build:vercel');

  const scratch = join(run, 'scratch'); await fs.mkdir(scratch);
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { TEMP: scratch, TMP: scratch, TMPDIR: scratch, NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic@127.0.0.1:9/never_connect', DIRECT_URL: 'postgresql://synthetic@127.0.0.1:9/never_connect',
    DOTENV_CONFIG_PATH: join(scratch, 'nonexistent.env'), JOIN_CODE_PEPPER: 'synthetic-build-only-pepper-0123456789abcdef',
    SKILLQUEST_PROXY_MODE: 'required', SKILLQUEST_PROXY_HMAC_KEY: Buffer.alloc(32, 97).toString('base64'),
    CACHE_DIR: join(run, 'cache'), XDG_CACHE_HOME: join(run, 'cache'),
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_GENERATE_NO_HINTS: '1', PRISMA_SKIP_POSTINSTALL_GENERATE: '1' });
  // HOME/USERPROFILE, provider credentials and DB settings are not inherited.
  const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert.ok(existsSync(npm), 'Invoke npm run qualify:build -w backend to locate npm');
  async function command(name, args, cwd = workspace) {
    const log = await fs.open(join(run, name + '.log'), 'wx');
    try {
      const started = Date.now();
      const result = await new Promise((done, reject) => {
        const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
        const timer = setTimeout(() => child.kill(), 180000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => { clearTimeout(timer); done({ code, signal, durationMs: Date.now() - started }); });
      });
      assert.equal(result.code, 0, name + ' failed; inspect its log');
      assert.equal(result.signal, null);
      return result;
    } finally { await log.close(); }
  }
  const requireWorkspace = createRequire(join(workspace, 'package.json'));
  const { nodeFileTrace } = requireWorkspace('next/dist/compiled/@vercel/nft');
  const generated = join(workspace, 'node_modules/.prisma/client');
  const linuxName = 'libquery_engine-rhel-openssl-3.0.x.so.node';
  for (const cycle of ['cold-client', 'warm-stale-client']) {
    if (cycle === 'warm-stale-client') await fs.appendFile(join(generated, 'index.d.ts'), '\n// SKILLQUEST_STALE_CACHE_SENTINEL\n');
    console.log(JSON.stringify({ run, step: cycle }));
    const build = await command(cycle + '-build', [npm, 'run', 'build:vercel', '--workspace', 'backend']);
    const buildLog = await fs.readFile(join(run, cycle + '-build.log'), 'utf8');
    assert.ok(buildLog.indexOf('Generated Prisma Client') >= 0 && buildLog.indexOf('Generated Prisma Client') < buildLog.indexOf('tsc -p'), 'Client generation must precede tsc');
    assert.equal((await fs.readFile(join(generated, 'index.d.ts'), 'utf8')).includes('SKILLQUEST_STALE_CACHE_SENTINEL'), false);
    const engine = await fs.readFile(join(generated, linuxName));
    assert.equal(engine.subarray(0, 4).toString('hex'), '7f454c46', 'Linux engine must be ELF');
    assert.equal(engine[4], 2, 'Expected ELF64');
    assert.equal(engine.readUInt16LE(18), 62, 'Expected x86_64 engine for the selected Vercel target');
    const trace = await nodeFileTrace([join(workspace, 'backend/index.mjs')], { base: workspace, processCwd: workspace,
      ignore: path => /(^|[\\/])\.env($|\.)/.test(path) || /\.node\.tmp\d+$/.test(path) });
    const files = new Set(trace.fileList);
    const walk = async dir => (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
    for (const dir of ['backend/assets', 'shared', 'node_modules/@sparticuz/chromium', 'node_modules/playwright-core-serverless']) {
      for (const path of await walk(join(workspace, dir))) files.add(relative(workspace, path));
    }
    for (const name of await fs.readdir(generated)) if (name.endsWith('.node') || name === 'schema.prisma') files.add(relative(workspace, join(generated, name)));
    const artifact = join(run, cycle + '-artifact');
    const manifest = [];
    for (const name of [...files].sort()) {
      const from = resolve(workspace, name), to = resolve(artifact, name);
      assert.ok(from.startsWith(workspace + sep) && to.startsWith(artifact + sep), 'Trace path escaped workspace');
      const content = await fs.readFile(from);
      await fs.mkdir(dirname(to), { recursive: true }); await fs.writeFile(to, content);
      manifest.push({ path: name.replaceAll('\\', '/'), bytes: content.length, sha256: sha(content) });
    }
    const required = ['backend/index.mjs', 'backend/dist/app.js', 'shared/network-proof.mjs',
      'backend/assets/skillquest-logo-white.png', 'backend/assets/fonts/NotoSansArabic.ttf', 'backend/assets/fonts/OFL.txt',
      'backend/assets/fonts/SkillQuestArabicPDF-Regular.ttf', 'backend/assets/fonts/SkillQuestArabicPDF-Bold.ttf', 'backend/assets/fonts/pdf-fonts-build.json',
      'node_modules/.prisma/client/' + linuxName,
      'node_modules/@sparticuz/chromium/bin/chromium.br', 'node_modules/@sparticuz/chromium/bin/al2023.tar.br',
      'node_modules/@sparticuz/chromium/bin/fonts.tar.br', 'node_modules/@sparticuz/chromium/bin/swiftshader.tar.br',
      'node_modules/playwright-core-serverless/browsers.json'];
    for (const file of required) assert.ok(existsSync(join(artifact, file)), 'Missing artifact file: ' + file);
    assert.equal(existsSync(join(artifact, 'backend/dist/server.js')), false, 'Local server must not be packaged');
    const probe = await command(cycle + '-import', [join(root, 'backend/scripts/serverless-import-probe.mjs'), join(artifact, 'backend/index.mjs')], artifact);
    // Loading Linux native code is explicitly NOT attempted on Windows.
    const artifactRequire = createRequire(join(artifact, 'backend/index.mjs'));
    const client = artifactRequire('@prisma/client');
    assert.equal(client.Prisma.prismaVersion.client, '6.19.3');
    const nativeName = process.platform === 'win32' ? 'query_engine-windows.dll.node' : linuxName;
    const native = artifactRequire(join(artifact, 'node_modules/.prisma/client', nativeName));
    assert.equal(typeof native.QueryEngine, 'function');
    const compressed = [];
    for (const name of ['chromium.br', 'al2023.tar.br', 'fonts.tar.br', 'swiftshader.tar.br']) {
      const input = createReadStream(join(artifact, 'node_modules/@sparticuz/chromium/bin', name));
      const stream = input.pipe(createBrotliDecompress()); input.on('error', error => stream.destroy(error));
      let bytes = 0, prefix = Buffer.alloc(0); const hash = createHash('sha256');
      for await (const chunk of stream) { bytes += chunk.length; hash.update(chunk); if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.length)]); }
      if (name === 'chromium.br') { assert.equal(prefix.subarray(0, 4).toString('hex'), '7f454c46'); assert.equal(prefix.readUInt16LE(18), 62); }
      compressed.push({ name, expandedBytes: bytes, expandedSHA256: hash.digest('hex') });
    }
    const sdk = await json(join(artifact, 'node_modules/@sparticuz/chromium/package.json'));
    const core = await json(join(artifact, 'node_modules/playwright-core-serverless/package.json'));
    const browsers = await json(join(artifact, 'node_modules/playwright-core-serverless/browsers.json'));
    assert.equal(sdk.version, '153.0.0'); assert.equal(core.version, '1.63.0');
    assert.equal(browsers.browsers.find(b => b.name === 'chromium').browserVersion.split('.')[0], '153');
    const bytes = manifest.reduce((n, f) => n + f.bytes, 0); assert.ok(bytes < 250000000, 'Standard Function bundle budget exceeded');
    const result = { cycle, artifact, build, probe, required, files: manifest.length,
      bytes, serverlessChromium: { package: sdk.version, playwrightCore: core.version, binaryExecuted: process.platform === 'linux' ? 'NOT_TESTED_BY_BUILD_CHECK' : false, compressed },
      linuxEngine: { name: linuxName, bytes: engine.length, sha256: sha(engine), elf64X86: true },
      nativeLoaded: nativeName, linuxNativeLoaded: process.platform === 'linux', staleClientReplaced: cycle === 'warm-stale-client',
      warnings: [...trace.warnings].map(e => e.message) };
    await write(cycle + '-manifest.json', manifest); report.cycles.push(result);
    await write('result.json', report);
  }
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.message; process.exitCode = 1;
} finally {
  await write('result.json', report); console.log(JSON.stringify(report));
}
