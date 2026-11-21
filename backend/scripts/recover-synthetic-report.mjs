// Offline recovery only. No HTTP server, Prisma client, token, session or worker.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const INTERVIEW_ID = '7cd650d3-9028-4439-b9a4-e24247be04e3';
export const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const source = path.join(project, 'output/local-synthetic/run-nBEqzk/workspace/backend');
const dataDirectory = path.join(project, 'output/local-synthetic/run-nBEqzk/data-recuperation');
const psql = path.join(project, 'output/pg-native-ef583905f4cd/portable/pgsql/bin/psql.exe');
const connection = 'host=127.0.0.1 port=55439 dbname=postgres user=skillquest_local connect_timeout=5 options=-cdefault_transaction_read_only=on';

// An explicit projection: never select tokenHash, retakeCodeHash, User or OTP payloads.
export const snapshotSQL = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT json_build_object(
  'database', current_database(), 'user', current_user,
  'address', inet_server_addr()::text, 'port', inet_server_port(),
  'readonly', current_setting('transaction_read_only'),
  'dataDirectory', current_setting('data_directory'),
  'syntheticInstallation', EXISTS(SELECT 1 FROM "SyntheticStagingInstallation"
    WHERE singleton=1 AND "databaseName"=current_database()),
  'rows', (SELECT json_agg(json_build_object(
    'id', i.id, 'displayName', i."displayName", 'email', i.email,
    'emailVerifiedAt', i."emailVerifiedAt", 'state', i.state,
    'expiresAt', i."expiresAt", 'sessionId', i."sessionId",
    'revision', i.revision, 'updatedAt', i."updatedAt",
    'job', json_build_object('interviewId', j."interviewId", 'status', j.status,
      'summary', j.summary, 'nextAttemptAt', j."nextAttemptAt", 'updatedAt', j."updatedAt")))
    FROM "AdaptiveInterview" i JOIN "AdaptiveReportJob" j ON j."interviewId"=i.id
    WHERE i.id='${INTERVIEW_ID}'::uuid)
);
ROLLBACK;`;

export function validateSnapshot(value) {
  assert.equal(value.database, 'postgres', 'RECOVERY_DATABASE');
  assert.equal(value.user, 'skillquest_local', 'RECOVERY_USER');
  assert.ok(['127.0.0.1', '127.0.0.1/32'].includes(value.address), 'RECOVERY_HOST');
  assert.equal(value.port, 55439, 'RECOVERY_PORT');
  assert.equal(value.readonly, 'on', 'READ_ONLY_REQUIRED');
  assert.equal(path.resolve(value.dataDirectory).toLowerCase(), dataDirectory.toLowerCase(), 'RECOVERY_CLUSTER');
  assert.equal(value.syntheticInstallation, true, 'SYNTHETIC_INSTALLATION_REQUIRED');
  assert.equal(value.rows?.length, 1, 'EXACTLY_ONE_REPORT_REQUIRED');
  const row = value.rows[0];
  assert.equal(row.id, INTERVIEW_ID, 'RECOVERY_ID');
  assert.equal(row.displayName, 'SYNTH-Participant', 'RECOVERY_IDENTITY');
  assert.match(row.email ?? '', /^[a-z0-9][a-z0-9._+-]{0,63}@example\.test$/i, 'SYNTHETIC_EMAIL_REQUIRED');
  assert.ok(row.emailVerifiedAt && Number.isFinite(Date.parse(row.emailVerifiedAt)), 'OTP_VERIFIED_REQUIRED');
  assert.equal(row.sessionId, null, 'RECOVERY_SESSION');
  assert.ok(Array.isArray(row.state?.answers), 'SAVED_ANSWERS_REQUIRED');
  assert.equal(row.state.answers.length, 31, '31_ANSWERS_REQUIRED');
  assert.equal(row.state.currentQuestion, null, 'FINISHED_REPORT_REQUIRED');
  assert.ok(typeof row.state.summary === 'string' && row.state.summary.trim(), 'SAVED_STATE_SUMMARY_REQUIRED');
  assert.equal(row.job.interviewId, INTERVIEW_ID, 'REPORT_RELATION');
  assert.equal(row.job.status, 'COMPLETE', 'COMPLETE_REPORT_REQUIRED');
  assert.ok(typeof row.job.summary === 'string' && row.job.summary.trim(), 'SAVED_SUMMARY_REQUIRED');
  // Refuse a silent fallback/translation: both summaries must already be saved.
  let summaries;
  try { summaries = JSON.parse(row.job.summary); } catch { throw Error('SAVED_BILINGUAL_SUMMARY_REQUIRED'); }
  assert.ok(typeof summaries.fr === 'string' && summaries.fr.trim(), 'SAVED_FR_SUMMARY_REQUIRED');
  assert.ok(typeof summaries.ar === 'string' && /[\u0600-\u06ff]/u.test(summaries.ar), 'SAVED_AR_SUMMARY_REQUIRED');
  return row;
}

export function cleanEnvironment(directory) {
  const result = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return { ...result, TEMP: directory, TMP: directory, TMPDIR: directory,
    PGCLIENTENCODING: 'UTF8', PGAPPNAME: 'skillquest-readonly-pdf-recovery',
    PGPASSFILE: path.join(directory, 'absent.pgpass'), PGSERVICEFILE: path.join(directory, 'absent.pg_service.conf'),
    NODE_ENV: 'test', REPORT_PDF_BROWSER_MODE: 'local',
    // Public zero-byte fixture used ONLY by render-time configuration checks.
    // It is not installed anywhere, signs nothing, and never reaches PostgreSQL.
    SKILLQUEST_STAGING_MODE: 'synthetic-v1', SKILLQUEST_STAGING_ID: INTERVIEW_ID,
    SKILLQUEST_STAGING_SECRET: Buffer.alloc(32).toString('base64url'),
    SKILLQUEST_DEPLOYMENT_PURPOSE: 'synthetic-staging',
    SKILLQUEST_STAGING_ACK: 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS' };
}

export async function command(file, args, environment, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: project, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('RECOVERY_COMMAND_TIMEOUT')); }, 180000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      // Never dump child output: the SQL result contains the saved report.
      if (code !== 0) {
        const diagnostic = stderr.split(/\r?\n/).find(line => /^(?:Error|AssertionError|TypeError|SyntaxError|ReferenceError)\b/.test(line));
        reject(Error('RECOVERY_COMMAND_FAILED: ' + path.basename(file) + ' (exit ' + code + ')' +
          (diagnostic ? ' — ' + diagnostic.slice(0, 240) : '')));
      }
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function snapshot(env) {
  const output = await command(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', connection], env, snapshotSQL);
  const value = JSON.parse(output.trim());
  validateSnapshot(value);
  return value;
}

async function main() {
  assert.equal(process.argv.length, 2, 'NO_ARGUMENTS_ACCEPTED');
  const tools = path.join(process.env.LOCALAPPDATA, 'Programs/MiKTeX/miktex/bin/x64');
  for (const file of [psql, path.join(source, 'src/services/report-pdf.service.ts'),
    ...['pdfinfo', 'pdftotext', 'pdftoppm'].map(name => path.join(tools, name + '.exe'))]) await fs.access(file);
  const directory = path.join(project, 'output/recuperation-rapport', INTERVIEW_ID);
  await fs.mkdir(directory, { recursive: true });
  const run = await fs.mkdtemp(path.join(directory, 'export-'));
  const env = cleanEnvironment(run);
  const before = await snapshot(env);
  // No report JSON on disk or on the command line: stdin only.
  const rendered = JSON.parse(await command(process.execPath,
    ['--no-warnings', '--loader', pathToFileURL(path.join(project, 'backend/scripts/recover-synthetic-report-loader.mjs')).href,
      path.join(project, 'backend/scripts/recover-synthetic-report-worker.mjs')], env,
    JSON.stringify({ directory: run, snapshot: before })));
  const after = await snapshot(env);
  assert.equal(JSON.stringify(after), JSON.stringify(before), 'SAVED_REPORT_CHANGED_DURING_EXPORT');
  const results = [];
  for (const lang of ['fr', 'ar']) {
    const pdf = path.join(run, `SkillQuest-SYNTH-Participant-${lang}.pdf`);
    const info = await command(path.join(tools, 'pdfinfo.exe'), [pdf], env);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    assert.ok(pages > 0 && pages <= 100, 'PDF_PAGE_COUNT');
    const text = await command(path.join(tools, 'pdftotext.exe'), ['-enc', 'UTF-8', pdf, '-'], env);
    assert.ok(text.includes('SYNTH-Participant') && !text.includes('\ufffd'), 'PDF_TEXT_INVALID');
    assert.ok(lang === 'ar' ? /[\u0600-\u06ff]/u.test(text) : /[éèêàç]/u.test(text), 'PDF_LANGUAGE_INVALID');
    const checks = path.join(run, 'verification'); await fs.mkdir(checks, { recursive: true });
    await command(path.join(tools, 'pdftoppm.exe'), ['-r', '70', '-png', pdf, path.join(checks, lang)], env);
    const images = (await fs.readdir(checks)).filter(name => new RegExp(`^${lang}-[0-9]+\\.png$`).test(name));
    assert.equal(images.length, pages, 'PDF_PAGES_RENDERED');
    results.push({ language: lang, pages, file: pdf, bytes: (await fs.stat(pdf)).size });
  }
  const verification = { interviewId: INTERVIEW_ID, readonly: true, savedReportUnchanged: true,
    savedBilingualSummaryReused: true, renderingSource: source, rendererHashes: rendered.rendererHashes,
    verifiedAt: new Date().toISOString(), reports: results };
  await fs.writeFile(path.join(run, 'verification.json'), JSON.stringify(verification, null, 2), { flag: 'wx' });
  for (const report of results) console.log(`PASS ${report.language.toUpperCase()} : ${report.pages} pages — ${report.file}`);
  console.log('PASS : base en lecture seule ; données sauvegardées inchangées.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('EXPORT REFUSÉ : ' + error.message); process.exitCode = 1; });
}
