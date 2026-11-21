// Offline typechecks/builds and frontend unit tests, with a clean child env.
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/durable-local-checks'); await mkdir(output, { recursive: true });
const guard = pathToFileURL(path.join(root, 'backend/tests/helpers/local-only-network.mjs')).href;
const env = Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { NODE_OPTIONS: `--import=${guard}`, NEXT_TELEMETRY_DISABLED: '1', DOTENV_CONFIG_PATH: '__no_environment_file_for_local_tests__', NODE_ENV: 'test' });
const jobs = [
  ['backend-typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'backend/tsconfig.tests.json'], root],
  ['backend-build', ['node_modules/typescript/bin/tsc', '-p', 'backend/tsconfig.json'], root],
  ['frontend-tests', ['--import','tsx','--test','--test-concurrency=1', ...(await readdir(path.join(root,'frontend/tests'))).filter(n => n.endsWith('.test.ts')).map(n => 'tests/'+n)], path.join(root, 'frontend')],
  ['frontend-build', [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], path.join(root, 'frontend')],
  ['frontend-typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'frontend/tsconfig.json'], root],
];
const selected = process.argv.slice(2);
if (selected.some(name => !jobs.some(job => job[0] === name))) throw Error('UNKNOWN_LOCAL_CHECK');
const results = selected.length ? JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8').catch(() => '[]')) : [];
for (const [name, args, cwd] of jobs.filter(job => !selected.length || selected.includes(job[0]))) {
  const log = openSync(path.join(output, name + '.log'), 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd, env: { ...env, NODE_ENV: name.endsWith('build') ? 'production' : 'test' }, windowsHide: true, stdio: ['ignore', log, log] });
      child.once('error', reject); child.once('exit', resolve);
    });
    const old = results.findIndex(r => r.name === name); if (old >= 0) results.splice(old, 1);
    results.push({ name, exitCode: code }); console.log(JSON.stringify(results.at(-1)));
  } finally { closeSync(log); }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
process.exitCode = results.every(r => r.exitCode === 0) ? 0 : 1;
