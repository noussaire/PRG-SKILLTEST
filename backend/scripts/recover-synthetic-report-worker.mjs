import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { project, source, INTERVIEW_ID, validateSnapshot } from './recover-synthetic-report.mjs';

// All Node network transports are disabled. Playwright controls a fresh browser
// over local pipes; the original renderer also uses offline mode, CSP and aborts.
const deny = () => { throw Error('RECOVERY_NETWORK_FORBIDDEN'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();

let input = '';
for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length < 16 * 1024 * 1024, 'RECOVERY_INPUT_LIMIT'); }
const { directory, snapshot } = JSON.parse(input); input = '';
const row = validateSnapshot(snapshot);
const parent = path.join(project, 'output/recuperation-rapport', INTERVIEW_ID);
assert.equal(path.dirname(path.resolve(directory)), parent, 'RECOVERY_OUTPUT_DIRECTORY');
assert.match(path.basename(directory), /^export-[a-zA-Z0-9]+$/);
const saved = JSON.stringify(row);
const { interviewView } = await import(pathToFileURL(path.join(source, 'src/services/adaptive.service.ts')));
const { localizedAISummary } = await import(pathToFileURL(path.join(source, 'src/services/prepared-localization.ts')));
const { createReportPdfRenderer } = await import(pathToFileURL(path.join(source, 'src/services/report-pdf.service.ts')));
const { resolvePdfBrowser } = await import(pathToFileURL(path.join(source, 'src/services/report-browser.service.ts')));
const renderer = createReportPdfRenderer({ runtime: async () => {
  const runtime = await resolvePdfBrowser();
  return { ...runtime, options: { ...runtime.options, args: [...(runtime.options.args ?? []),
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'] } };
} });
const renderRow = { id: row.id, displayName: row.displayName, email: row.email,
  state: row.state, expiresAt: new Date(row.expiresAt) };
const job = { status: row.job.status, summary: row.job.summary, nextAttemptAt: new Date(row.job.nextAttemptAt) };
for (const lang of ['fr', 'ar']) {
  const view = interviewView(renderRow, job, lang);
  assert.equal(view.status, 'COMPLETED', 'SAVED_REPORT_REQUIRED');
  assert.equal(view.report?.skills.length, 31, '31_SKILLS_REQUIRED');
  assert.equal(view.report?.summarySource, 'ai', 'NO_FALLBACK_SUMMARY');
  assert.equal(view.report?.summary, localizedAISummary(job.summary, lang, row.state.language), 'SAVED_SUMMARY_REUSE');
  const pdf = await renderer.render(renderRow, job, lang);
  await fs.writeFile(path.join(directory, `SkillQuest-SYNTH-Participant-${lang}.pdf`), pdf, { flag: 'wx' });
}
assert.equal(JSON.stringify(row), saved, 'IN_MEMORY_SOURCE_CHANGED');
const rendererHashes = {};
for (const name of ['report-pdf.service.ts', 'report-email-template.ts', 'adaptive.service.ts', 'prepared-localization.ts']) {
  rendererHashes[name] = createHash('sha256').update(await fs.readFile(path.join(source, 'src/services', name))).digest('hex');
}
console.log(JSON.stringify({ rendererHashes }));
