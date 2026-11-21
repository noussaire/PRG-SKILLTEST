import assert from "node:assert/strict";
import type { Browser } from "playwright";
import type { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "node:fs/promises";

export async function runAdaptiveBrowserChecks(browser: Browser, origin: string, prisma: PrismaClient, output?: string) {
  const checks: string[] = [], errors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await ctx.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const language = async (lang: "fr" | "ar") => {
    await page.getByRole("button", { name: lang === "ar" ? "العربية" : "Français", exact: true }).first().click();
    await page.waitForFunction(value => document.documentElement.lang === value, lang);
  };
  async function appSnapshot(name: string) {
    if (!output) return;
    const css = await page.evaluate(() => Array.from(document.styleSheets).map(sheet => { try { return Array.from(sheet.cssRules).map(rule => rule.cssText).join("\n"); } catch { return ""; } }).join("\n"));
    const logo = (await readFile(new URL("../../frontend/public/brand/skillquest-logo.png", import.meta.url))).toString("base64");
    let html = await page.content();
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, "");
    html = html.replace(/<img\b[^>]*>/gi, tag => tag.replace(/\s(?:srcset|sizes)="[^"]*"/gi, "").replace(/src="[^"]*"/i, `src="data:image/png;base64,${logo}"`));
    await writeFile(`${output}/${name}.html`, html.replace("</head>", `<style>${css}</style></head>`));
    await page.screenshot({ path: `${output}/${name}-fold.png` });
  }
  try {
    assert.equal((await ctx.request.get(`${origin}/api/admin/adaptive/dashboard`)).status(), 401);
    await page.goto(origin); await language("fr");
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>(".hq-hero-receipt img")?.getAttribute("src")?.includes("path-fr"));
    const motion = page.getByRole("button", { name: "Mettre en pause", exact: true });
    await motion.click();
    assert.equal(await page.getByRole("button", { name: "Animer l’aperçu", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Animer l’aperçu", exact: true }).click();
    assert.equal(await page.getByRole("tab").count(), 4);
    await page.getByRole("tab").first().focus(); await page.keyboard.press("End");
    assert.equal(await page.getByRole("tab").last().getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".hq-skill-panel li").count(), 31);
    await page.waitForFunction(() => { const logo = document.querySelector<HTMLImageElement>(".public-header .brand-logo img"); return logo?.complete && logo.naturalWidth > 0; });
    const demoInputs = page.locator('input[name="demo-choice"]');
    assert.equal(await demoInputs.count(), 4);
    await demoInputs.first().check();
    const firstReaction = await page.locator(".sq-demo-result").innerText();
    await demoInputs.last().check();
    assert.notEqual(await page.locator(".sq-demo-result").innerText(), firstReaction);
    if (output) await page.screenshot({ path: `${output}/accueil-fr.png`, fullPage: true });
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Home overflow at ${width}`);
    }
    await language("ar"); await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>(".hq-hero-receipt img")?.getAttribute("src")?.includes("path-ar"));
    if (output) await page.screenshot({ path: `${output}/accueil-ar-mobile.png`, fullPage: true });
    await language("fr"); await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.locator('a[href="/participer"]').count(), 0);
    await page.goto(`${origin}/participer`); await page.waitForURL("**/entretien");
    await page.locator("[data-pathway-selection]").waitFor();
    assert.ok(await page.locator("[data-egogram-card] button").isDisabled());
    assert.equal(await page.locator("[data-egogram-card] a").count(), 0);
    await language("ar");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/selection-tests-ar-mobile.png`, fullPage: true });
    await language("fr"); await page.setViewportSize({ width: 1440, height: 1000 });
    if (output) await page.screenshot({ path: `${output}/selection-tests-fr.png`, fullPage: true });
    await page.locator("[data-soft-skills-card]").click(); await page.waitForURL("**/entretien/soft-skills");
    await page.locator("#interview-email").waitFor();
    if (output) await page.screenshot({ path: `${output}/formulaire-fr.png`, fullPage: true });
    await page.locator("#interview-name").fill("Amine navigateur");
    await page.locator("#interview-email").fill("amine.navigateur@example.test");
    for (const checkbox of await page.locator("[data-adaptive-root] input[type=checkbox]").all()) await checkbox.check();
    await page.locator("form button[type=submit]").click();
    await page.getByRole("radio").nth(3).waitFor();
    if (output) await page.screenshot({ path: `${output}/question-fr.png`, fullPage: true });
    await page.getByRole("radio").first().check(); await language("ar");
    await page.waitForFunction(() => /[\u0600-\u06ff]/.test(document.querySelector("fieldset")?.textContent ?? ""));
    assert.ok(await page.getByRole("radio").first().isChecked()); await language("fr");
    for (let index = 0; index < 31; index++) {
      await page.getByText(`Question ${index + 1} sur 31`, { exact: true }).waitFor();
      if (index === 9) { await page.reload(); await page.getByText("Question 10 sur 31", { exact: true }).waitFor(); }
      await page.getByRole("radio").nth(index % 4).check(); await page.locator("form button[type=submit]").click();
    }
    await page.getByRole("heading", { name: "Votre rapport de soft skills", exact: true }).waitFor();
    assert.equal(await page.locator("[data-adaptive-skill]").count(), 31);
    const participant = await prisma.adaptiveInterview.findFirstOrThrow({ where: { displayName: "Amine navigateur" } });
    // A persisted provider result is simulated, never requested from a real AI service.
    await prisma.adaptiveReportJob.create({ data: { interviewId: participant.id, status: "COMPLETE", emailStatus: "PENDING", summary: JSON.stringify({ fr: "Synthèse IA française de démonstration.", ar: "خلاصة تجريبية بالعربية." }) } });
    await page.reload(); await page.getByText("Synthèse IA française de démonstration.", { exact: true }).waitFor();
    await page.goto(`${origin}/entretien`); await page.locator("[data-soft-skills-card]").click();
    await page.getByText("Synthèse IA française de démonstration.", { exact: true }).waitFor();
    await language("ar"); await page.getByText("خلاصة تجريبية بالعربية.", { exact: true }).waitFor();
    checks.push("Public: bilingual test selector, disabled future egogram, full name/email form, 31 saved choices, resume at 9 and via selector, bilingual report");
    await language("fr");
    await page.goto(`${origin}/admin/login`); await page.locator("#email").fill(process.env.ADMIN_EMAIL!); await page.locator("#password").fill(process.env.ADMIN_PASSWORD!); await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/admin/dashboard"); await page.locator("[data-kpi]").nth(3).waitFor();
    const dashboard = await page.evaluate(async () => {
      const response = await fetch("/api/admin/adaptive/dashboard?lang=fr", { cache: "no-store" });
      if (!response.ok) throw Error(`Dashboard status ${response.status}`);
      return response.json();
    });
    assert.equal(dashboard.kpis.completedTests, 1); assert.equal(dashboard.kpis.aiReports, 1); assert.equal(dashboard.kpis.totalParticipants, 1);
    assert.equal(await page.locator('.ad-sidebar nav:visible a').count(), 2);
    assert.equal(await page.locator('a[href="/admin/missions"],a[href="/admin/sessions"],a[href="/admin/reports"]').count(), 0);
    assert.equal(await page.locator("[data-top-skill]").count(), 5);
    if (output) await page.screenshot({ path: `${output}/admin-dashboard-fr.png`, fullPage: true });
    await appSnapshot("admin-overview-rendered");
    await page.goto(`${origin}/admin/participants`); await page.locator("[data-participant-row]").first().waitFor();
    const search = page.getByRole("textbox", { name: "Rechercher par nom ou e-mail" });
    await search.fill("aucun-résultat"); await page.getByText("Aucune participation trouvée", { exact: true }).waitFor();
    await search.fill("Amine"); await page.locator("[data-participant-row]").first().waitFor();
    await page.getByLabel("État de la synthèse IA", { exact: true }).selectOption("COMPLETE");
    await page.locator("[data-participant-row]").first().getByRole("link").first().click();
    await page.getByText("Synthèse IA française de démonstration.", { exact: true }).waitFor();
    await page.getByText("amine.navigateur@example.test", { exact: true }).waitFor();
    await appSnapshot("admin-participant-rendered");
    assert.equal(await page.locator("[data-adaptive-skill]").count(), 31);
    await page.getByRole("button", { name: "Questions et réponses", exact: true }).click();
    assert.equal(await page.getByText("Choix enregistré", { exact: true }).count(), 31);
    await page.getByRole("button", { name: "Rapport personnel", exact: true }).click();
    if (output) await page.screenshot({ path: `${output}/admin-participant-fr.png`, fullPage: true });
    await language("ar"); await page.getByText("خلاصة تجريبية بالعربية.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-adaptive-skill]").count(), 31);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (output) {
      await page.screenshot({ path: `${output}/admin-participant-ar-mobile.png`, fullPage: true });
      await page.emulateMedia({ media: "print" }); await page.pdf({ path: `${output}/admin-rapport-arabe.pdf`, format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" });
    }
    await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
    await page.getByRole("link", { name: "لوحة القيادة", exact: true }).click();
    await page.locator("[data-kpi]").nth(3).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/admin-dashboard-ar-mobile.png`, fullPage: true });
    checks.push("Admin: authenticated login, adaptive KPIs, top skills, participant search and filters, responses, bilingual AI report, mobile RTL and PDF");
    const { checkAdminDesign } = await import('./browser-admin-design-checks.js');
    await checkAdminDesign(page, origin, participant.id, output);
    checks.push("Admin design: FR/AR at 375/768/1024/1440, keyboard drawer, global search, selected CSV export, grouped report, complete print and retry state");
    await language("fr");
    for (const path of ["/admin/missions", "/admin/sessions"]) { await page.goto(`${origin}${path}`); await page.waitForURL("**/admin/dashboard"); }
    await page.goto(`${origin}/admin/reports`); await page.waitForURL("**/admin/participants");
    checks.push("Retired mission/session/report pages redirect to the new administration");
    const csrf = await ctx.request.post(`${origin}/api/adaptive/start`, { headers: { Origin: "https://untrusted.example" }, data: { displayName: "CSRF", language: "fr", consent: true, adult: true } });
    assert.equal(csrf.status(), 403);
    assert.deepEqual(errors, []);
    return { checks, errors };
  } finally { await ctx.close(); }
}
