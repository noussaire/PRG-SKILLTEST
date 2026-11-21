// Local production-build browser checks. Run with node --import tsx; all API replies are fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { getAdaptiveCatalog } from '../../backend/src/services/adaptive-catalog.ts';
import { pdfDownloadCopy } from '../src/lib/pdf-download.ts';

const base = process.env.PDF_TEST_BASE_URL;
assert.ok(base && new URL(base).hostname === '127.0.0.1', 'Only an explicitly supplied loopback URL is allowed');
const out = resolve(process.env.PDF_TEST_OUTPUT ?? 'output/pdf-auto-retry/browser'); await mkdir(out, { recursive: true });
const fixturePdf = Buffer.from('%PDF-1.7\nSynthetic transport fixture, engine tested separately.');
const cases = [
  { name: '200', statuses: [200], calls: 1, success: true },
  { name: '503-200', statuses: [503, 200], header: '1', calls: 2, success: true },
  { name: '503-503', statuses: [503, 503], header: '1', calls: 2 },
  { name: '401', statuses: [401], header: '1', calls: 1, auth: true },
  { name: '403', statuses: [403], header: '1', calls: 1, auth: true },
  { name: 'absent', statuses: [503], calls: 1 },
  { name: 'invalid', statuses: [503], header: 'invalid', calls: 1 },
  { name: 'excessive', statuses: [503], header: '60', calls: 1 },
  { name: 'permanent', statuses: [503], header: '1', permanent: true, calls: 1 },
];
const results = [], failures = [], external = [];
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
try {
  for (const width of [390, 768, 1440]) for (const role of ['student', 'admin']) for (const lang of ['fr', 'ar']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    let spec, calls, times, downloads, manual;
    const jsErrors = []; page.on('pageerror', e => jsErrors.push(e.message));
    page.on('download', d => downloads.push(d));
    const id = '11111111-1111-4111-8111-111111111111';
    const skills = getAdaptiveCatalog(lang);
    const interview = { id, displayName: 'SYNTH-PDF', language: lang, mode: 'prepared-v2', status: 'COMPLETED', answeredCount: 31, totalQuestions: 31, currentQuestion: null, skills, transcript: [], expiresAt: '2099-01-01T00:00:00Z', report: {
      summary: lang === 'fr' ? 'Synthèse simulée pour la validation locale.' : 'خلاصة محاكاة للتحقق المحلي.', summarySource: 'ai', aiStatus: 'COMPLETE', emailStatus: 'NOT_REQUESTED', disclaimer: 'SYNTHETIC',
      skills: skills.map(s => ({ ...s, level: 2, evidenceQuote: 'SYNTH', rationale: 'SYNTH', advice: 'SYNTH', question: 'SYNTH', answer: 'SYNTH' })),
    } };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) { external.push(url.origin); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname.endsWith('/report') || url.pathname.endsWith('/report.pdf')) {
        times.push(Date.now()); const status = manual ? 200 : spec.statuses[Math.min(calls, spec.statuses.length - 1)]; calls++;
        if (status === 200) return route.fulfill({ status, contentType: 'application/pdf', body: fixturePdf });
        return route.fulfill({ status, contentType: 'application/json', headers: spec.header ? { 'Retry-After': spec.header } : {}, body: JSON.stringify({ code: status === 503 ? 'PDF_UNAVAILABLE' : 'UNAUTHORIZED', retryable: !spec.permanent, reason: spec.permanent ? 'REPORT_PDF_CONFIGURATION' : 'REPORT_PDF_QUEUE_FULL' }) });
      }
      let body;
      if (url.pathname === '/api/admin/me') body = { admin: { id, email: 'admin@example.test', role: 'ADMIN' } };
      else if (url.pathname === '/api/adaptive/config') body = { configured: true, mode: 'prepared-v2', aiReportAvailable: true, totalQuestions: 31, skills };
      else if (url.pathname === '/api/adaptive/me') body = interview;
      else if (url.pathname === '/api/admin/adaptive/participants/' + id) body = { interview, participant: { id, displayName: 'SYNTH-PDF', email: null, language: lang, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', expiresAt: interview.expiresAt, answeredCount: 31, totalQuestions: 31, status: 'COMPLETED', aiStatus: 'COMPLETE', aiGenerated: true } };
      else return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    for (spec of cases) {
      calls = 0; times = []; downloads = []; manual = false;
      try {
        await page.goto(base + (role === 'student' ? '/entretien/soft-skills' : '/admin/participants/' + id) + '?lang=' + lang);
        const control = page.locator('[data-pdf-download]'), button = control.locator('button'), message = control.locator('[role="status"]');
        await button.waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(await control.getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
        if (spec.name === '200') { await button.focus(); await page.keyboard.press('Enter'); }
        else await button.evaluate(b => { b.click(); b.click(); }); // deliberate same-tick double click
        if (spec.calls === 2) {
          await page.waitForFunction(text => document.querySelector('[data-pdf-download] [role="status"]')?.textContent === text, pdfDownloadCopy[lang].waiting);
          assert.equal(await button.isDisabled(), true); assert.equal(calls, 1);
          if (spec.name === '503-200') {
            await control.scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(out, `${role}-${lang}-${width}-waiting.png`) });
          }
        }
        const expected = spec.success ? pdfDownloadCopy[lang].success : spec.auth ? pdfDownloadCopy[lang].auth : pdfDownloadCopy[lang].failed;
        await page.waitForFunction(text => document.querySelector('[data-pdf-download] [role="status"]')?.textContent === text, expected, { timeout: 8000 });
        assert.equal(calls, spec.calls); assert.equal(await button.isEnabled(), true);
        if (spec.calls === 2) assert.ok(times[1] - times[0] >= 950, 'Respect Retry-After');
        const bounds = await button.boundingBox(); assert.ok(bounds && bounds.height >= 44 && bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
        if (spec.success) {
          assert.equal(downloads.length, 1); assert.equal(downloads[0].suggestedFilename(), 'SkillQuest-rapport.pdf');
          assert.deepEqual(await readFile(await downloads[0].path()), fixturePdf);
        } else assert.equal(downloads.length, 0);
        if (spec.name === '503-503') {
          await page.waitForTimeout(1100); assert.equal(calls, 2, 'No third automatic attempt');
          manual = true; await button.click();
          await page.waitForFunction(text => document.querySelector('[data-pdf-download] [role="status"]')?.textContent === text, pdfDownloadCopy[lang].success);
          assert.equal(calls, 3, 'Later manual click is permitted');
        }
        assert.deepEqual(jsErrors, []);
        results.push({ width, role, lang, scenario: spec.name, passed: true });
      } catch (error) {
        failures.push({ width, role, lang, scenario: spec.name, error: String(error), jsErrors: [...jsErrors] });
        await page.screenshot({ path: join(out, `${role}-${lang}-${width}-${spec.name}-failure.png`) });
        throw error;
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(join(out, 'results.json'), JSON.stringify({ passed: results.length, results, failures, blockedExternalRequests: external }, null, 2));
  console.log(JSON.stringify({ passed: results.length, failures, blockedExternalRequests: external.length }));
}
