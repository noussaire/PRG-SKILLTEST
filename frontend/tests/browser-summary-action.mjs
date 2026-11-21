// Local browser qualification only. All API responses are fixtures; no backend or provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const project = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL('../../output/summary-button/', import.meta.url);
await mkdir(output, { recursive: true });
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [project + 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: project + 'frontend', windowsHide: true,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', API_INTERNAL_URL: 'http://127.0.0.1:9', GROQ_API_KEY: '', BREVO_API_KEY: '', QSTASH_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
let browser; const results = [];
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error(message);
}
function fixture(lang, status = 'PENDING') {
  const skills = Array.from({ length: 31 }, (_, n) => ({ id: `skill-${n}`, label: lang === 'ar' ? `المهارة ${n+1}` : `Compétence ${n+1}`, description: '', level: 3, rationale: 'Observation pédagogique.', evidenceQuote: '', advice: 'Comparer deux solutions.', question: 'Situation fictive.', answer: 'Choix enregistré.' }));
  return { id: 'local-summary-fixture', displayName: 'SYNTH-local', language: lang, status: 'COMPLETED', mode: 'prepared-v2',
    answeredCount: 31, totalQuestions: 31, currentQuestion: null, skills, transcript: [], expiresAt: new Date(Date.now() + 86400000).toISOString(),
    report: { summary: lang === 'ar' ? 'تقرير تربوي محفوظ.' : 'Bilan pédagogique sauvegardé.', summarySource: 'rules', aiStatus: status, skills, disclaimer: 'Situations fictives.', emailStatus: 'NOT_REQUESTED' } };
}
async function scenario(lang, status, available = true, handler) {
  const context = await browser.newContext();
  await context.addInitScript(language => { localStorage.setItem('sq_lang', language); localStorage.setItem('sq_lang_v3_arabic_default', 'true'); }, lang);
  let state = fixture(lang, status), posts = 0;
  const errors = [];
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/adaptive/config') return route.fulfill({ json: { configured: true, aiReportAvailable: available, mode: 'prepared-v2', totalQuestions: 31, skills: state.skills } });
    if (url.pathname === '/api/adaptive/me') return route.fulfill({ json: state });
    if (url.pathname === '/api/adaptive/me/summary') {
      posts++; assert.equal(route.request().method(), 'POST'); assert.equal(route.request().postData(), '{}');
      return handler(route, { get: () => state, set: value => { state = value; } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.goto(origin + '/entretien/soft-skills');
  await page.locator('[data-adaptive-summary]').waitFor();
  await page.waitForTimeout(250);
  assert.equal(posts, 0, 'No generation on page load');
  return { page, context, posts: () => posts, errors, state: () => state };
}
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Local Next server failed: ' + logs);
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  for (const lang of ['fr', 'ar']) {
    let release; const hold = new Promise(resolve => { release = resolve; });
    const s = await scenario(lang, 'PENDING', true, async (route, store) => {
      await hold; const updated = structuredClone(store.get());
      updated.report.aiStatus = 'COMPLETE'; updated.report.summarySource = 'ai';
      updated.report.summary = lang === 'ar' ? 'خلاصة محاكاة محفوظة.' : 'Synthèse simulée sauvegardée.';
      store.set(updated); await route.fulfill({ json: updated });
    });
    const button = s.page.locator('[data-summary-generate]'); await button.waitFor();
    for (const width of [390, 768, 1440]) {
      await s.page.setViewportSize({ width, height: 1000 });
      await button.scrollIntoViewIfNeeded();
      assert.ok((await button.boundingBox()).height >= 44);
      assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      await s.page.screenshot({ path: fileURLToPath(new URL(`${lang}-${width}.png`, output)) });
    }
    await button.focus(); await s.page.keyboard.press('Enter');
    await until(() => button.isDisabled(), 'Busy button should disable');
    await button.evaluate(el => { el.click(); el.click(); });
    assert.equal(s.posts(), 1); assert.ok(await s.page.locator('[data-adaptive-summary]').isVisible());
    release(); await button.waitFor({ state: 'detached' });
    assert.ok((await s.page.locator('[data-adaptive-summary]').innerText()).includes(s.state().report.summary));
    assert.equal(await s.page.locator('[data-adaptive-skill]').count(), 31);
    await s.page.reload(); await s.page.locator('[data-adaptive-summary]').waitFor(); assert.equal(s.posts(), 1);
    assert.deepEqual(s.errors, []); await s.context.close(); results.push(`${lang}: keyboard, double click, persisted reload, 31 skills, mobile/tablet/desktop`);
  }
  for (const status of ['UNAVAILABLE', 'COMPLETE']) {
    const s = await scenario('fr', status, true, () => { throw Error('Unexpected POST'); });
    assert.equal(await s.page.locator('[data-summary-generate]').count(), 0); await s.context.close(); results.push(status + ': no generation button');
  }
  {
    const s = await scenario('ar', 'NONE', false, () => { throw Error('Unexpected POST'); });
    assert.equal(await s.page.locator('[data-summary-generate]').count(), 0); await s.context.close(); results.push('Unavailable provider: no generation button');
  }
  {
    const s = await scenario('fr', 'NONE', true, async (route, store) => {
      const updated = structuredClone(store.get()); updated.report.aiStatus = 'RETRY'; updated.report.aiRetryAt = new Date(Date.now() + 2000).toISOString();
      store.set(updated); await route.fulfill({ json: updated });
    });
    const button = s.page.locator('[data-summary-generate]'); await button.click();
    await until(() => button.isDisabled(), 'Retry delay must disable');
    await until(() => button.isEnabled(), 'Retry delay should expire without a request');
    assert.equal(s.posts(), 1); await s.context.close(); results.push('RETRY: countdown without automatic POST');
  }
  for (const status of [401, 429, 503]) {
    const s = await scenario('fr', 'PENDING', true, route => route.fulfill({ status, headers: { 'Retry-After': '120' }, json: { error: 'fixture' } }));
    const button = s.page.locator('[data-summary-generate]'); await button.click();
    await s.page.locator('[data-ai-report-status] [role=alert]').waitFor();
    assert.ok(await button.isDisabled()); assert.ok(await s.page.locator('[data-adaptive-summary]').isVisible());
    assert.equal(s.posts(), 1); assert.deepEqual(s.errors, []); await s.context.close(); results.push(`${status}: visible error, preserved report, disabled repeated request`);
  }
  await writeFile(new URL('results.json', output), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  await browser?.close();
  server.kill(); await once(server, 'exit');
  await writeFile(new URL('server.log', output), logs);
}
