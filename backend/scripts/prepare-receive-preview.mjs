// Local packaging only. No network, credentials, secret generation or deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'output/receive-otp-final-candidate');
assert.equal(process.argv.length, 2, 'NO_ARGUMENTS_ACCEPTED');
const git = args => execFileSync('git', ['-C', source, ...args], { maxBuffer: 32 * 1024 * 1024 });
const base = git(['rev-parse', 'HEAD']).toString().trim();
assert.equal(base, '46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5');
const overlays = ['backend/src/routes/synthetic-staging.routes.ts', 'backend/src/services/synthetic-otp-receive.service.ts',
  'backend/src/security/synthetic-receive-diagnostic.ts'];
const changes = git(['diff', 'HEAD', '--name-only']).toString().trim().split(/\r?\n/).filter(Boolean);
assert.ok(changes.every(file => overlays.includes(file)), 'UNEXPECTED_CANDIDATE_CHANGE');
const output = path.join(root, 'output/receive-preview'); await fs.mkdir(output, { recursive: true });
const folder = await fs.mkdtemp(path.join(output, 'package-'));
const hashes = {};
const put = async (name, content) => {
  assert.ok(!name.split('/').includes('..'));
  await fs.mkdir(path.dirname(path.join(folder, name)), { recursive: true });
  await fs.writeFile(path.join(folder, name), content, { flag: 'wx' });
  hashes[name] = createHash('sha256').update(content).digest('hex');
};
const tracked = git(['ls-tree', '-r', '--name-only', 'HEAD']).toString().trim().split(/\r?\n/);
for (const name of tracked) {
  if (!(name.startsWith('backend/') || name.startsWith('shared/') ||
    ['package.json', 'package-lock.json', '.npmrc', '.node-version', '.gitignore', 'SHARED.sha256'].includes(name))) continue;
  if (/\/(?:tests|scripts)\//.test(name) || /(?:^|\/)\.env/.test(name) || name === 'backend/index.mjs' || overlays.includes(name)) continue;
  await put(name, git(['show', `HEAD:${name}`]));
}
for (const name of overlays) await put(name, await fs.readFile(path.join(source, name)));
await put('backend/receive-preview-guard.mjs', await fs.readFile(path.join(root, 'backend/scripts/receive-preview-guard.mjs')));
await put('backend/index.mjs', Buffer.from(`import express from 'express';
import { assertReceivePreview } from './receive-preview-guard.mjs';
assertReceivePreview(process.env);
const { app } = await import('./dist/app.js');
const { assertProxyConfiguration } = await import('./dist/security/proxy-network.js');
assertProxyConfiguration();
export default app;
`));
await put('.vercelignore', Buffer.from('.git\n.env*\n**/.env*\n**/node_modules\n**/dist\n**/tests\n**/scripts\npreview-manifest.json\n'));
assert.equal(Object.keys(hashes).filter(name => /^backend\/prisma\/migrations\/[^/]+\/migration.sql$/.test(name)).length, 23);
await fs.writeFile(path.join(folder, 'preview-manifest.json'), JSON.stringify({ base, diagnosticFiles: overlays,
  previewOnlyGuard: true, noCredentials: true, sha256: hashes }, null, 2), { flag: 'wx' });
console.log('PREVIEW_PACKAGE_READY ' + folder);
