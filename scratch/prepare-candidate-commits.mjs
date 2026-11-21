import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const backendRepo = path.resolve('output/prepublication/backend-candidate');
const frontendRepo = path.resolve('output/prepublication/frontend-candidate');
const manifestPath = path.resolve('output/otp-email-durable-candidates/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'noussben67-s',
  GIT_AUTHOR_EMAIL: 'noussben67-s@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'noussben67-s',
  GIT_COMMITTER_EMAIL: 'noussben67-s@users.noreply.github.com'
};

function runGit(repo, args) {
  return execSync(`git -c safe.directory=* ${args}`, { cwd: repo, env: gitEnv, encoding: 'utf8' }).trim();
}

console.log('--- PREPARATION DES COMMITS CANDIDATS SUR BRANCHES DEDIEES ---');

// 1. Backend repo
runGit(backendRepo, 'checkout -B candidate/durable-otp-20261108 main');
console.log('Backend branche: ' + runGit(backendRepo, 'branch --show-current'));

for (const group of manifest.groups) {
  const backendFiles = group.files.filter(f => !f.path.startsWith('frontend/'));
  if (backendFiles.length === 0) continue;

  console.log(`Backend staging: ${group.proposedCommitTitle} (${backendFiles.length} fichiers)`);
  for (const f of backendFiles) {
    const src = path.resolve('output/otp-email-durable-candidates', group.name, f.path);
    const dest = path.resolve(backendRepo, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    runGit(backendRepo, `add "${f.path}"`);
  }
  const status = runGit(backendRepo, 'status --porcelain');
  if (status) {
    runGit(backendRepo, `commit -m "${group.proposedCommitTitle.replace(/"/g, '\\"')}"`);
  }
}

console.log('\nBackend derniers commits:');
console.log(runGit(backendRepo, 'log -n 4 --format="%h %an <%ae> %s"'));

// 2. Frontend repo
runGit(frontendRepo, 'checkout -B candidate/durable-otp-20261108 main');
console.log('\nFrontend branche: ' + runGit(frontendRepo, 'branch --show-current'));

for (const group of manifest.groups) {
  const frontendFiles = group.files.filter(f => f.path.startsWith('frontend/'));
  if (frontendFiles.length === 0) continue;

  console.log(`Frontend staging: ${group.proposedCommitTitle} (${frontendFiles.length} fichiers)`);
  for (const f of frontendFiles) {
    const src = path.resolve('output/otp-email-durable-candidates', group.name, f.path);
    const dest = path.resolve(frontendRepo, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    runGit(frontendRepo, `add "${f.path}"`);
  }
  const status = runGit(frontendRepo, 'status --porcelain');
  if (status) {
    runGit(frontendRepo, `commit -m "${group.proposedCommitTitle.replace(/"/g, '\\"')}"`);
  }
}

console.log('\nFrontend derniers commits:');
console.log(runGit(frontendRepo, 'log -n 3 --format="%h %an <%ae> %s"'));

