// Browser integration test against the disposable localhost application only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export async function runLocalBrowserTest({ origin, chrome, root, password, operateOtp, rpc, frontRequire, setBrowser, blockedRequests }) {
  const { chromium } = frontRequire('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--disable-background-networking', '--disable-component-update'] });
  setBrowser(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    blockedRequests.push(url.hostname); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  await page.goto(origin + '/entretien/soft-skills', { waitUntil: 'domcontentloaded', timeout: 150000 });
  await page.getByRole('button', { name: 'Français', exact: true }).first().click();
  await page.locator('#interview-name').fill('SYNTH-Participant');
  await page.locator('#interview-email').fill('participant@example.test');
  for (const checkbox of await page.locator('form input[type=checkbox]').all()) {
    if (await checkbox.getAttribute('required') !== null) await checkbox.check(); else await checkbox.uncheck();
  }
  const enrollment = page.locator('form').filter({ has: page.locator('#interview-name') });
  const issuedPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/adaptive/start' && r.request().method() === 'POST');
  await enrollment.locator('button[type=submit]').click();
  const issuedResponse = await issuedPromise; assert.equal(issuedResponse.status(), 409);
  const issued = await issuedResponse.json(); assert.ok(issued.challengeId);
  const before = await rpc('check'); assert.equal(before.participant, null); assert.equal(before.challenges, 1); assert.equal(before.otpCaptures, 0);
  const otp = await operateOtp(issued.challengeId);
  await page.locator('#retake-code').fill(otp);
  const verifiedPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/adaptive/start' && r.request().method() === 'POST');
  await enrollment.locator('button[type=submit]').click();
  const verified = await verifiedPromise; assert.equal(verified.status(), 201);
  let state = await verified.json(); assert.equal(state.emailVerified, true); assert.equal(state.totalQuestions, 31);
  for (let index = 0; index < 31; index++) {
    assert.equal(state.answeredCount, index); assert.ok(state.currentQuestion?.choices?.length === 4);
    const choiceId = state.currentQuestion.choices[index % 4].id;
    await page.locator(`input[type=radio][value="${choiceId}"]`).check();
    const answered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/adaptive/answer' && r.request().method() === 'POST');
    await page.locator('form').filter({ has: page.locator('input[type=radio]') }).locator('button[type=submit]').click();
    const response = await answered; assert.equal(response.status(), 200); state = await response.json();
    assert.equal(state.answeredCount, index + 1);
  }
  assert.equal(state.status, 'COMPLETED'); assert.equal(state.report.skills.length, 31);
  const summary = await context.request.post(origin + '/api/adaptive/me/summary', { data: {}, headers: { Origin: origin } });
  assert.equal(summary.status(), 200); assert.equal((await summary.json()).report.aiStatus, 'COMPLETE');
  const resultDirectory = path.join(root, 'results'); await fs.mkdir(resultDirectory);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(resultDirectory, 'questionnaire-completed.png'), fullPage: true });
  const pdfs = [];
  for (const language of ['fr', 'ar']) {
    const response = await context.request.get(origin + '/api/adaptive/me/report?lang=' + language, { timeout: 90000 });
    assert.equal(response.status(), 200); assert.match(response.headers()['content-type'], /application\/pdf/);
    const bytes = await response.body(); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const structure = bytes.toString('latin1'); assert.ok(structure.includes('/FontFile2') || structure.includes('/FontFile3'));
    assert.ok(structure.includes('/Subtype /Image'));
    const file = path.join(resultDirectory, 'rapport-' + language + '.pdf'); await fs.writeFile(file, bytes);
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8', windowsHide: true });
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]); assert.ok(pages >= 3 && pages <= 20);
    const textFile = path.join(resultDirectory, 'rapport-' + language + '.txt');
    execFileSync('pdftotext', ['-layout', file, textFile], { windowsHide: true, stdio: 'ignore' });
    const text = await fs.readFile(textFile, 'utf8');
    assert.ok(language === 'ar' ? /[\u0600-\u06ff]/.test(text) : /compétence|rapport|compétences/i.test(text));
    pdfs.push({ language, pages, bytes: bytes.length, file });
  }
  const finalState = await rpc('check');
  assert.equal(finalState.challenges, 1); assert.equal(finalState.otpCaptures, 1); assert.equal(finalState.users, 1);
  assert.equal(finalState.participant.answers, 31); assert.equal(finalState.participant.verified, true);
  const adminContext = await browser.newContext();
  await adminContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const admin = await adminContext.newPage(); await admin.goto(origin + '/admin/login', { timeout: 90000 });
  await admin.locator('#email').fill('admin@example.test'); await admin.locator('#password').fill(password);
  await admin.locator('form button[type=submit]').click(); await admin.waitForURL('**/admin/dashboard', { timeout: 45000 });
  await admin.screenshot({ path: path.join(resultDirectory, 'admin-dashboard.png'), fullPage: true });
  await adminContext.close(); await context.close();
  return { outcome: 'PASS', migrations: 23, syntheticOnly: true, challenges: 1, otpCaptures: 1, answers: 31,
    adminLogin: true, reportStatus: finalState.participant.reportStatus, pdfs, blockedExternalBrowserHosts: [...new Set(blockedRequests)] };
}
