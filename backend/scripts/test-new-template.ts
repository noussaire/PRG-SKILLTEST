import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { resolvePdfBrowser } from "../src/services/report-browser.service.js";
import { interviewView } from "../src/services/adaptive.service.js";
import { escapeEmailHTML } from "../src/services/report-email-template.js";

async function embeddedAssets() {
  const [logo, cLight, cRegular, cSemiBold, cBold, cExtraBold] = await Promise.all([
    readFile(new URL("../assets/skillquest-logo-white.png", import.meta.url)),
    readFile(new URL("../assets/fonts/Cairo-Light.ttf", import.meta.url)),
    readFile(new URL("../assets/fonts/Cairo-Regular.ttf", import.meta.url)),
    readFile(new URL("../assets/fonts/Cairo-SemiBold.ttf", import.meta.url)),
    readFile(new URL("../assets/fonts/Cairo-Bold.ttf", import.meta.url)),
    readFile(new URL("../assets/fonts/Cairo-ExtraBold.ttf", import.meta.url)),
  ]);
  return {
    logo: `data:image/png;base64,${logo.toString("base64")}`,
    cairoLight: cLight.toString("base64"),
    cairoRegular: cRegular.toString("base64"),
    cairoSemiBold: cSemiBold.toString("base64"),
    cairoBold: cBold.toString("base64"),
    cairoExtraBold: cExtraBold.toString("base64"),
  };
}

const paragraph = (value: string) => escapeEmailHTML(value).replace(/\r?\n/g, "<br>");

export function buildPrintableHTML(
  row: { id: string; displayName: string; state: any; expiresAt: Date },
  job: { status: "COMPLETE" | "UNAVAILABLE" | "PENDING"; summary: string | null; nextAttemptAt: Date },
  assets: { logo: string; cairoLight: string; cairoRegular: string; cairoSemiBold: string; cairoBold: string; cairoExtraBold: string },
) {
  const view = interviewView(row, job);
  const report = view.report!;
  const ar = row.state.language === "ar";
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";

  const isSynthetic = process.env.SKILLQUEST_STAGING_MODE === "synthetic-v1" || report.summarySource === "rules";

  const copy = ar ? {
    subject: "SkillQuest — تقرير مهاراتك الشخصية",
    hello: "مرحبا",
    title: "تقرير مهاراتك الشخصية",
    summary: isSynthetic ? "خلاصة تجريبية" : "خلاصة مولدة بالذكاء الاصطناعي",
    intro: "أكملت المواقف الـ31. إليك تقريرك مع خلاصة الذكاء الاصطناعي ومؤشرات كل مهارة ..",
    overviewTitle: "نظرة عامة على مهاراتك",
    overviewSubtitle: "توزيع المهارات الـ 31 من الأقوى إلى الأحوج للاستكشاف ( حسب المؤشر )",
    detailsTitle: "تفاصيل كل مهارة",
    levels: [
      "المعطيات غير كافية",
      "مهارة تحتاج إلى استكشاف",
      "في طور التطوير",
      "نقطة قوة في هذا الموقف",
      "نقطة قوة مدعومة في هذا الموقف",
    ],
    situation: "الموقف",
    answer: "اختيارك",
    advice: "خطوة عملية للتقدم",
    note: isSynthetic
      ? "الخلاصة أعلاه تجريبية في وضع الاختبار؛ مؤشرات المهارات والنصائح مبنية على شبكة التصحيح المعدة مسبقا."
      : "الخلاصة أعلاه مولدة بالذكاء الاصطناعي؛ مؤشرات المهارات والنصائح مبنية على شبكة التصحيح المعدة مسبقا.",
    footer: "أُرسل هذا التقرير إلى العنوان الذي أدخلته قبل الاختبار. احفظ هذه الرسالة للاحتفاظ بنسختك من التقرير.",
    org: "جمعية شباب كونكت",
  } : {
    subject: "SkillQuest — Votre rapport de soft skills",
    hello: "Bonjour",
    title: "Votre rapport de soft skills",
    summary: isSynthetic ? "Synthèse simulée" : "Synthèse générée par IA",
    intro: "Vous avez terminé les 31 situations. Voici votre rapport avec la synthèse IA et le détail de chaque compétence.",
    overviewTitle: "Aperçu de vos compétences",
    overviewSubtitle: "Répartition des 31 compétences selon vos points d’appui et axes de progrès",
    detailsTitle: "Détail de chaque compétence",
    levels: [
      "Éléments insuffisants",
      "À explorer",
      "En développement",
      "Point fort dans cette situation",
      "Point fort étayé dans cette situation",
    ],
    situation: "Situation",
    answer: "Votre choix",
    advice: "Une action pour progresser",
    note: isSynthetic
      ? "La synthèse ci-dessus est simulée en mode d’essai ; les indicateurs et conseils par compétence reposent sur la grille préparée."
      : "La synthèse ci-dessus est rédigée par IA ; les indicateurs et conseils par compétence reposent sur la grille préparée.",
    footer: "Ce rapport est envoyé à l’adresse renseignée avant le test. Conservez ce message pour garder votre exemplaire du rapport.",
    org: "Association Chabab Connect",
  };

  const levelColors: Record<number, { text: string; bg: string; border: string }> = {
    4: { text: "#0b6e55", bg: "#d8efe6", border: "#0b6e55" },
    3: { text: "#1f9d7a", bg: "#e2f4ed", border: "#1f9d7a" },
    2: { text: "#2d7fb8", bg: "#e6f0f9", border: "#2d7fb8" },
    1: { text: "#c77d1a", bg: "#fbf0e2", border: "#c77d1a" },
    0: { text: "#7a8894", bg: "#f4f7f9", border: "#7a8894" },
  };

  const count4 = report.skills.filter(s => (s.level ?? 0) === 4).length;
  const count3 = report.skills.filter(s => (s.level ?? 0) === 3).length;
  const count2 = report.skills.filter(s => (s.level ?? 0) === 2).length;
  const count1 = report.skills.filter(s => (s.level ?? 0) <= 1).length;

  const stackedSegments = [
    { lvl: 4, count: count4, color: "#0b6e55" },
    { lvl: 3, count: count3, color: "#1f9d7a" },
    { lvl: 2, count: count2, color: "#2d7fb8" },
    { lvl: 1, count: count1, color: "#c77d1a" },
  ];

  const stackedBarHTML = stackedSegments.map(s => {
    if (s.count === 0) return "";
    return `<div style="flex:${s.count};background:${s.color};color:#ffffff;font-size:9pt;font-weight:700;display:flex;align-items:center;justify-content:center;height:100%">${s.count}</div>`;
  }).join("");

  const levelRowsHTML = [4, 3, 2, 1].map(lvl => {
    const skillsInLevel = report.skills.filter(s => (lvl === 1 ? (s.level ?? 0) <= 1 : (s.level ?? 0) === lvl));
    const cfg = levelColors[lvl];
    const dots = [1, 2, 3, 4].map(i => {
      const active = i <= lvl;
      return `<span style="display:inline-block;width:4.3px;height:6.2px;background:${active ? cfg.text : "#d3dbe1"};border-radius:1px;margin:0 1px"></span>`;
    }).join("");

    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="display:flex;align-items:center">${dots}</div>
            <span style="font-size:10.5pt;font-weight:700;color:${cfg.text}">${copy.levels[lvl]}</span>
          </div>
          <span style="font-size:9pt;color:#7a8894;font-weight:600"><bdi dir="ltr">${skillsInLevel.length} · ${lvl}/4</bdi></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px 6px">
          ${skillsInLevel.map(s => `<span style="background:${cfg.bg};color:${cfg.text};font-size:9pt;font-weight:600;padding:2.5px 10px;border-radius:12px">${escapeEmailHTML(s.label)}</span>`).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Split 31 skills into 8 pages: 4, 4, 4, 4, 4, 4, 4, 3
  const pagesSkills: (typeof report.skills)[] = [];
  let cur = 0;
  for (let p = 0; p < 7; p++) {
    pagesSkills.push(report.skills.slice(cur, cur + 4));
    cur += 4;
  }
  pagesSkills.push(report.skills.slice(cur)); // remaining 3

  const renderCard = (skill: typeof report.skills[0], index: number) => {
    const lvl = skill.level ?? 1;
    const cfg = levelColors[lvl] ?? levelColors[1];
    const dots = [1, 2, 3, 4].map(i => {
      const active = i <= (skill.level ?? 0);
      return `<span style="display:inline-block;width:4.3px;height:6.2px;background:${active ? cfg.text : "#d3dbe1"};border-radius:1px;margin:0 1px"></span>`;
    }).join("");

    const parts = skill.question.split(/\r?\n\r?\n/);
    const context = parts.length > 1 ? parts[0] : "";
    const prompt = parts.length > 1 ? parts.slice(1).join("\n\n") : skill.question;

    return `
      <section class="skill-card" style="background:#dce5ea;border-${ar ? "right" : "left"}:3.5px solid ${cfg.border};border-radius:6px;padding:9px 12px;margin-bottom:8.5px;break-inside:avoid;page-break-inside:avoid">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;background:${cfg.border};color:#ffffff;border-radius:3px;font-weight:700;font-size:9.5pt">${index + 1}</span>
            <span style="font-weight:800;font-size:12.5pt;color:#14344a">${escapeEmailHTML(skill.label)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="display:flex;align-items:center">${dots}</div>
            <span style="background:${cfg.bg};color:${cfg.text};font-weight:700;font-size:8.5pt;padding:2px 8px;border-radius:4px">${copy.levels[lvl]}</span>
          </div>
        </div>
        <div style="margin-bottom:5px">
          <div style="font-weight:700;font-size:8.5pt;color:${cfg.text};margin-bottom:1px">${copy.situation}</div>
          ${context ? `<div style="font-size:9.0pt;color:#7a8894;line-height:1.35;margin-bottom:2px">${escapeEmailHTML(context)}</div>` : ""}
          <div style="font-weight:600;font-size:9.3pt;color:#14344a;line-height:1.35">${escapeEmailHTML(prompt)}</div>
        </div>
        <div style="margin-bottom:5px">
          <div style="font-weight:700;font-size:8.5pt;color:${cfg.text};margin-bottom:1px">${copy.answer}</div>
          <div style="background:#f4f7f9;padding:5px 9px;border-radius:4px;font-size:9.3pt;color:#14344a;line-height:1.35">${escapeEmailHTML(skill.answer)}</div>
        </div>
        <div style="background:${cfg.bg};padding:5px 9px;border-radius:4px;font-size:9.0pt;line-height:1.35">
          <span style="font-weight:700;color:${cfg.text}">${copy.advice} : </span>
          <span style="color:#14344a">${escapeEmailHTML(skill.advice)}</span>
        </div>
      </section>
    `;
  };

  const pagesHTML = pagesSkills.map((pageSkills, pIdx) => {
    const isFirstCardPage = pIdx === 0;
    const isLastPage = pIdx === pagesSkills.length - 1;
    const startIdx = pIdx * 4;

    return `
      <div class="report-page ${isLastPage ? "last-page" : ""}" style="page-break-before:always;break-before:page;padding:12mm 39.7pt 0;box-sizing:border-box">
        ${isFirstCardPage ? `<h2 style="font-size:14pt;font-weight:800;color:#14344a;margin:0 0 10px">${copy.detailsTitle}</h2>` : ""}
        ${pageSkills.map((s, idx) => renderCard(s, startIdx + idx)).join("")}
        ${isLastPage ? `
          <div style="background:#f4f7f9;border-radius:6px;padding:9px 12px;margin-top:8px;font-size:8.5pt;color:#7a8894;line-height:1.45">
            <p style="margin:0 0 4px">${paragraph(report.disclaimer)}</p>
            <p style="margin:0">${copy.footer}</p>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  return `<!doctype html>
<html lang="${row.state.language}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeEmailHTML(copy.title)} — SkillQuest</title>
<style>
@font-face { font-family: 'Cairo'; src: url(data:font/ttf;base64,${assets.cairoLight}) format('truetype'); font-weight: 300; font-display: block; }
@font-face { font-family: 'Cairo'; src: url(data:font/ttf;base64,${assets.cairoRegular}) format('truetype'); font-weight: 400; font-display: block; }
@font-face { font-family: 'Cairo'; src: url(data:font/ttf;base64,${assets.cairoSemiBold}) format('truetype'); font-weight: 600; font-display: block; }
@font-face { font-family: 'Cairo'; src: url(data:font/ttf;base64,${assets.cairoBold}) format('truetype'); font-weight: 700; font-display: block; }
@font-face { font-family: 'Cairo'; src: url(data:font/ttf;base64,${assets.cairoExtraBold}) format('truetype'); font-weight: 800; font-display: block; }

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #14344a;
  font-family: 'Cairo', Tahoma, Arial, sans-serif !important;
  direction: ${dir};
  text-align: ${align};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page {
  size: A4 portrait;
  margin: 0 0 14mm 0;
}

.report-header {
  height: 136.06pt;
  background: #143448;
  padding: 0 39.7pt;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  direction: ${dir};
}

.report-body-p1 {
  padding: 24pt 39.7pt 0;
}

.summary-box {
  background: #eaf3f8;
  border-${ar ? "right" : "left"}: 4px solid #2d7fb8;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 20px;
}

.report-page {
  width: 100%;
}
</style>
</head>
<body>
  <!-- PAGE 1 -->
  <div class="report-page page-1">
    <div class="report-header">
      <div style="font-size:10pt;color:#c9d6e0;font-weight:400">${copy.org}</div>
      <img data-report-logo src="${escapeEmailHTML(assets.logo)}" alt="SkillQuest" style="display:block;width:127pt;height:auto;border:0">
    </div>
    <div class="report-body-p1">
      <div style="font-size:10.5pt;color:#5b6b79;margin-bottom:4px">${copy.hello} <bdi style="font-weight:600">${escapeEmailHTML(row.displayName)}</bdi>${ar ? "،" : ","}</div>
      <h1 style="font-size:26pt;font-weight:800;color:#14344a;margin:0 0 8px;line-height:1.2">${copy.title}</h1>
      <div style="font-size:11pt;color:#3e5465;margin-bottom:18px;line-height:1.4">${copy.intro}</div>

      <div class="summary-box">
        <div style="font-size:9pt;font-weight:700;color:#2d7fb8;margin-bottom:4px">${copy.summary}</div>
        <div style="font-size:9.3pt;color:#14344a;line-height:1.55;margin-bottom:6px">${paragraph(report.summary)}</div>
        <div style="font-size:8.5pt;color:#7a8894">${copy.note}</div>
      </div>

      <div style="margin-bottom:14px">
        <div style="margin-bottom:6px">
          <h2 style="font-size:14pt;font-weight:800;color:#14344a;margin:0 0 4px">${copy.overviewTitle}</h2>
          <div style="font-size:8.5pt;color:#5b6b79;margin-bottom:12px">${copy.overviewSubtitle}</div>
        </div>
        <div style="display:flex;height:22.7pt;border-radius:6px;overflow:hidden;margin-bottom:16px">
          ${stackedBarHTML}
        </div>
        ${levelRowsHTML}
      </div>
    </div>
  </div>

  <!-- PAGES 2 TO 9 -->
  ${pagesHTML}
</body>
</html>`;
}

async function main() {
  console.log("Testing refined PDF template renderer...");
  const assets = await embeddedAssets();
  const runtime = await resolvePdfBrowser();
  const browser = await runtime.launch({
    ...runtime.options,
    headless: true,
    args: [...(runtime.options.args ?? []), "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--no-first-run"],
  });

  for (const lang of ["ar", "fr"] as const) {
    let state = createPreparedInterview(lang);
    while (state.currentQuestion) {
      state = advancePreparedInterview(state, {
        questionId: state.currentQuestion.id,
        choiceId: state.currentQuestion.choices![0].id,
      });
    }
    const row = {
      id: randomUUID(),
      displayName: "Exemple SkillQuest",
      state: state as never,
      expiresAt: new Date(Date.now() + 86400000),
    };
    const job = {
      status: "COMPLETE" as const,
      summary: JSON.stringify({
        fr: "La synthèse ci-dessus est rédigée pour illustrer le rapport.",
        ar: "هذا التقرير مثال توضيحي لعرض نقاط القوة وفرص التطور. تصف المؤشرات اختياراتك في المواقف المقترحة.",
      }),
      nextAttemptAt: new Date(),
    };

    const html = buildPrintableHTML(row, job, assets);
    const page = await browser.newPage({ javaScriptEnabled: false, serviceWorkers: "block", offline: true });
    await page.route("**/*", route => route.abort());
    await page.setContent(html, { waitUntil: "load", timeout: 20000 });
    await page.evaluate("document.fonts.ready");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      tagged: true,
      outline: true,
      margin: { top: "0mm", right: "0mm", bottom: "14mm", left: "0mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%;margin:0 39.7pt;font-family:'Cairo',Tahoma,sans-serif;font-size:8pt;color:#8a97a3;display:flex;justify-content:space-between;align-items:center;${lang === "ar" ? "direction:rtl;" : "direction:ltr;"}">
          <span>SkillQuest · Association Chabab Connect</span>
          <span><bdi dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></bdi></span>
        </div>
      `,
    });
    await page.close();

    const outPath = `C:/Users/pc/.gemini/antigravity/brain/508e1644-6889-436b-a07a-3ff87490ed69/scratch/new-${lang}.pdf`;
    await writeFile(outPath, pdf);
    console.log(`Generated ${outPath} (${pdf.length} bytes)`);
  }

  await browser.close();
  console.log("Done!");
}

main().catch(console.error);
