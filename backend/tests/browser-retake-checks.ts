import assert from "node:assert/strict";
import type { Browser } from "playwright";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";

export async function runRetakeBrowserChecks(browser: Browser, origin: string, prisma: PrismaClient, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 552 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const originalFetch = globalThis.fetch, oldKey = process.env.BREVO_API_KEY, oldSender = process.env.BREVO_SENDER_EMAIL, oldBudget = process.env.EMAIL_ACCOUNT_DAILY_LIMIT;
  let code = "", sent = 0;
  process.env.BREVO_API_KEY = "browser-retake-only"; process.env.BREVO_SENDER_EMAIL = "sender@example.test";
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300";
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://api.brevo.com/v3/smtp/email") {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.to[0].email, "retake.browser@example.test");
      code = payload.htmlContent.match(/>(\d{6})<\//)[1]; sent++;
      return Response.json({ messageId: "browser-isolated-code" }, { status: 201 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const profile = { fullName: "Retake browser participant", email: "retake.browser@example.test", language: "fr", adult: true, consent: true, emailReport: true };
    const start = await context.request.post(`${origin}/api/adaptive/start`, { headers: { origin }, data: profile });
    assert.equal(start.status(), 201); const first = await start.json();
    let state = createPreparedInterview("fr");
    while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
    await prisma.adaptiveInterview.update({ where: { id: first.id }, data: { state: state as unknown as Prisma.InputJsonValue } });
    await prisma.adaptiveReportJob.create({ data: { interviewId: first.id, status: "COMPLETE", summary: JSON.stringify({ fr: "Ancien rapport du participant.", ar: "تقرير المشارك السابق." }) } });
    // A different browser cannot bypass the 30-day server rule.
    await context.clearCookies(); await page.goto(`${origin}/entretien/soft-skills?lang=fr`);
    await page.waitForFunction(() => document.documentElement.lang === "fr");
    await page.locator("#interview-name").fill(profile.fullName); await page.locator("#interview-email").fill(profile.email);
    for (const checkbox of await page.locator(".sq-enrol-form input[type=checkbox]").all()) await checkbox.check();
    await page.locator("form button[type=submit]").click();
    await page.getByRole("alert").filter({ hasText: "Cette adresse a déjà" }).waitFor(); assert.equal(sent, 0);
    await prisma.adaptiveInterview.update({ where: { id: first.id }, data: { lastTestStartedAt: new Date(Date.now() - 31 * 86400000) } });
    await page.locator("form button[type=submit]").click(); await page.locator("[data-retake-verification]").waitFor(); assert.equal(sent, 0);
    const { processOtpDeliveries } = await import("../src/services/otp-delivery.service.js"); await processOtpDeliveries(); assert.equal(sent, 1);
    const resend = page.waitForResponse(r => r.url().includes("/api/adaptive/start") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Demander un nouveau code", exact: true }).click(); assert.equal((await resend).status(), 409); assert.equal(sent, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/retake-code-fr.png`, fullPage: true });
    await page.getByRole("button", { name: "العربية", exact: true }).first().click();
    await page.waitForFunction(() => document.documentElement.lang === "ar"); await page.setViewportSize({ width: 375, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/retake-code-ar-mobile.png`, fullPage: true });
    await page.locator("#retake-code").fill(code); await page.locator("form button[type=submit]").click(); await page.getByRole("radio").nth(3).waitFor();
    assert.equal(await prisma.adaptiveInterview.count({ where: { emailIdentity: profile.email } }), 1);
    assert.ok((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: first.id } })).previousResult);
    assert.equal(await page.getByRole("button", { name: /Effacer|حذف المقابلة/ }).count(), 0);
    assert.equal((await context.request.delete(`${origin}/api/adaptive/me`, { headers: { origin } })).status(), 403);
    // The administrator can still consult the previous complete report.
    const adminPage = await context.newPage(); await adminPage.goto(`${origin}/admin/login`);
    await adminPage.locator("#email").fill(process.env.ADMIN_EMAIL!); await adminPage.locator("#password").fill(process.env.ADMIN_PASSWORD!);
    await adminPage.locator("button[type=submit]").click(); await adminPage.waitForURL("**/admin/dashboard");
    await adminPage.goto(`${origin}/admin/participants/${first.id}`); await adminPage.locator("[data-adaptive-report]").waitFor();
    assert.equal(await adminPage.locator("[data-adaptive-skill]").count(), 31);
    if (output) await adminPage.screenshot({ path: `${output}/retake-previous-admin.png`, fullPage: true });
    await adminPage.close();
    for (let i = 0; i < 31; i++) {
      await page.getByRole("radio").nth(1).check(); const saved = page.waitForResponse(r => r.url().includes("/api/adaptive/answer") && r.request().method() === "POST");
      await page.locator("form button[type=submit]").click(); assert.equal((await saved).status(), 200);
      if (i < 30) await page.waitForFunction(count => document.querySelector('[role=progressbar]')?.getAttribute("aria-valuenow") === String(count), i + 1);
    }
    await page.locator("[data-adaptive-report]").waitFor(); assert.equal((await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: first.id } })).previousResult, null);
    assert.equal(await prisma.adaptiveInterview.count({ where: { emailIdentity: profile.email } }), 1); assert.equal(sent, 1); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ retakeBrowser: "pass", bilingualCodeForm: true, singleParticipant: true, adminPreviousReport: true, updatedAfter31Answers: true, participantDelete: "forbidden", errors }));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = oldKey;
    if (oldSender === undefined) delete process.env.BREVO_SENDER_EMAIL; else process.env.BREVO_SENDER_EMAIL = oldSender;
    if (oldBudget === undefined) delete process.env.EMAIL_ACCOUNT_DAILY_LIMIT; else process.env.EMAIL_ACCOUNT_DAILY_LIMIT = oldBudget;
    await context.close();
  }
}
