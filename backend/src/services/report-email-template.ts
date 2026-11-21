import type { AdaptiveInterview, AdaptiveReportJob } from "@prisma/client";
import { interviewView, type InterviewState } from "./adaptive.service.js";
import { ReportEmailError, type ReportEmailMessage } from "./brevo.service.js";

export const escapeEmailHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const paragraph = (value: string) => escapeEmailHTML(value).replace(/\r?\n/g, "<br>");

export function buildReportEmail(
  row: Pick<AdaptiveInterview, "id" | "displayName" | "state" | "expiresAt"> & { email?: string | null },
  job: Pick<AdaptiveReportJob, "status" | "summary" | "nextAttemptAt">,
  options: { logoDataURL?: string; printable?: boolean; fontCSS?: string; language?: "fr" | "ar" } = {},
): ReportEmailMessage {
  const state = row.state as unknown as InterviewState;
  const targetLanguage: "fr" | "ar" = options.language === "ar" || options.language === "fr" ? options.language : (state.language === "ar" ? "ar" : "fr");
  const view = interviewView({ ...row, state }, job, targetLanguage);
  const report = view.report;
  const emailReady = job.status === "COMPLETE" && report?.summarySource === "ai"
    || job.status === "UNAVAILABLE" && report?.summarySource === "rules";
  if (!report || report.skills.length !== 31 || (!options.printable && !emailReady)) throw new ReportEmailError("EMAIL_REPORT_NOT_READY");
  const ar = targetLanguage === "ar", direction = ar ? "rtl" : "ltr", align = ar ? "right" : "left";
  const hasEmail = typeof row.email === "string" && !!row.email.trim();
  const configuredLogo = process.env.REPORT_EMAIL_LOGO_URL?.trim();
  let publicLogo: string | undefined;
  if (configuredLogo) {
    try {
      const url = new URL(configuredLogo);
      if (url.protocol === "https:" && !url.username && !url.password && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(url.hostname)) publicLogo = url.href;
    } catch { /* A missing hosted image must not break the attached PDF. */ }
  }
  const logo = options.logoDataURL ?? publicLogo;

  const isSyntheticStaging = process.env.SKILLQUEST_STAGING_MODE === "synthetic-v1";

  const copy = ar ? {
    subject: "SkillQuest — تقرير مهاراتك الشخصية",
    hello: "مرحبا", title: "تقرير مهاراتك الشخصية",
    summary: isSyntheticStaging ? "خلاصة تجريبية" : "خلاصة مولدة بالذكاء الاصطناعي",
    intro: "أكملت المواقف الـ31. إليك تقريرك مع خلاصة الذكاء الاصطناعي ومؤشرات كل مهارة ..",
    overviewTitle: "نظرة عامة على مهاراتك",
    overviewSubtitle: "توزيع المهارات الـ 31 من الأقوى إلى الأحوج للاستكشاف ( حسب المؤشر )",
    detailsTitle: "تفاصيل كل مهارة",
    levels: ["المعطيات غير كافية", "مهارة تحتاج إلى استكشاف", "في طور التطوير", "نقطة قوة في هذا الموقف", "نقطة قوة مدعومة في هذا الموقف"],
    situation: "الموقف", answer: "اختيارك", advice: "خطوة عملية للتقدم",
    note: isSyntheticStaging
      ? "الخلاصة أعلاه تجريبية في وضع الاختبار؛ مؤشرات المهارات والنصائح مبنية على شبكة التصحيح المعدة مسبقا."
      : "الخلاصة أعلاه مولدة بالذكاء الاصطناعي؛ مؤشرات المهارات والنصائح مبنية على شبكة التصحيح المعدة مسبقا.",
    footer: "أُرسل هذا التقرير إلى العنوان الذي أدخلته قبل الاختبار. احفظ هذه الرسالة للاحتفاظ بنسختك من التقرير.",
    org: "جمعية شباب كونكت",
  } : {
    subject: "SkillQuest — Votre rapport de soft skills",
    hello: "Bonjour", title: "Votre rapport de soft skills",
    summary: isSyntheticStaging ? "Synthèse simulée" : "Synthèse générée par IA",
    intro: "Vous avez terminé les 31 situations. Voici votre rapport avec la synthèse IA et le détail de chaque compétence.",
    overviewTitle: "Aperçu de vos compétences",
    overviewSubtitle: "Répartition des 31 compétences selon vos points d’appui et axes de progrès",
    detailsTitle: "Détail de chaque compétence",
    levels: ["Éléments insuffisants", "À explorer", "En développement", "Point fort dans cette situation", "Point fort étayé dans cette situation"],
    situation: "Situation", answer: "Votre choix", advice: "Une action pour progresser",
    note: isSyntheticStaging
      ? "La synthèse ci-dessus est simulée en mode d’essai ; les indicateurs et conseils par compétence reposent sur la grille préparée."
      : "La synthèse ci-dessus est rédigée par IA ; les indicateurs et conseils par compétence reposent sur la grille préparée.",
    footer: "Ce rapport est envoyé à l’adresse renseignée avant le test. Conservez ce message pour garder votre exemplaire du rapport.",
    org: "Association Chabab Connect",
  };

  if (report.summarySource === "rules") {
    copy.summary = ar ? "خلاصة تربوية" : "Bilan pédagogique";
    copy.intro = ar ? "أكملت المواقف الـ31. إليك تقريرك التربوي وتفاصيل كل مهارة." : "Vous avez terminé les 31 situations. Voici votre bilan pédagogique et le détail de chaque compétence.";
    copy.note = ar ? "الخلاصة والمؤشرات والنصائح مبنية على شبكة التصحيح المعدة مسبقا." : "Le bilan, les indicateurs et les conseils reposent sur la grille préparée.";
  }

  // If this is for printable PDF, build the high-fidelity 9-page layout matching skillquest-rapport-ameliore-ar.pdf
  if (options.printable) {
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
              <p style="margin:0${hasEmail ? " 0 4px" : ""}">${paragraph(report.disclaimer)}</p>
              ${hasEmail ? `<p style="margin:0">${copy.footer}</p>` : ""}
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    return {
      subject: copy.subject,
      htmlContent: `<!doctype html>
<html lang="${targetLanguage}" dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeEmailHTML(copy.title)} — SkillQuest</title>
<style>
${options.fontCSS ?? ""}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #14344a;
  font-family: 'Cairo', Tahoma, Arial, sans-serif !important;
  direction: ${direction};
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
  direction: ${direction};
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
      ${logo ? `<img data-report-logo src="${escapeEmailHTML(logo)}" alt="SkillQuest — Association Chabab Connect" style="display:block;width:127pt;height:auto;border:0">` : '<strong style="font-size:25px" dir="ltr">SkillQuest</strong>'}
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
</html>`,
    };
  }

  // Fallback for non-printable email body view
  const skills = report.skills.map((skill, index) => `<section style="border-top:1px solid #dce5e0;padding:20px 0">
<h2 style="margin:0 0 8px;font-size:18px;color:#123348">${index + 1}. ${escapeEmailHTML(skill.label)}</h2>
<p style="margin:0 0 12px;color:#526877">${skill.level === null ? "—" : `${skill.level}/4`} · ${copy.levels[skill.level ?? 0]}</p>
<p>${paragraph(skill.rationale)}</p>
<p><strong>${copy.situation}</strong><br>${paragraph(skill.question)}</p>
<p><strong>${copy.answer}</strong><br>${paragraph(skill.answer)}</p>
<p style="background:#f0f6ed;padding:12px"><strong>${copy.advice}</strong><br>${paragraph(skill.advice)}</p>
</section>`).join("");

  return { subject: copy.subject, htmlContent: `<!doctype html>
<html lang="${targetLanguage}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeEmailHTML(copy.title)} — SkillQuest</title>
<style>${options.fontCSS ?? ""}
@media print { html,body{background:white!important}body{font-size:10pt!important;line-height:1.5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}body>table>tbody>tr>td{padding:0!important}table{max-width:none!important}section{break-inside:avoid;page-break-inside:avoid;padding:14px 0!important}h1,h2{break-after:avoid;page-break-after:avoid}p{orphans:3;widows:3}section p{margin:7px 0!important;line-height:1.5!important}section h2{margin-bottom:6px!important}h1{font-size:23pt!important}h2{font-size:13pt!important}.email-attachment-note{display:none!important} }
</style></head>
<body style="margin:0;background:#f5f8f7;color:#123348;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.65;overflow-wrap:break-word;word-break:break-word;direction:${direction};text-align:${ar ? "right" : "left"}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;max-width:680px;background:#ffffff"><tr><td bgcolor="#123348" style="padding:26px 24px;background:#123348;color:#ffffff">${logo ? `<img data-report-logo src="${escapeEmailHTML(logo)}" alt="SkillQuest — Association Chabab Connect" width="190" height="110" style="display:block;width:190px;max-width:100%;height:auto;border:0;margin:0 0 12px">` : '<strong style="font-size:25px" dir="ltr">SkillQuest</strong><br>'}<span style="font-size:13px;color:#ffffff">${copy.org}</span></td></tr>
<tr><td style="padding:24px"><p>${copy.hello} <bdi>${escapeEmailHTML(row.displayName)}</bdi>${ar ? "،" : ","}</p><h1 style="font-size:26px;line-height:1.3;margin:16px 0">${copy.title}</h1><p>${copy.intro}</p>
${!options.printable ? `<div class="email-attachment-note" style="margin:22px 0;padding:16px;border:1px solid #dce5e0;background:#f0f6ed"><strong>${ar ? "تقريرك بصيغة PDF مرفق بهذه الرسالة" : "Votre rapport PDF est joint à cet e-mail"}</strong><p style="margin:6px 0 0">${ar ? "افتح الملف المرفق لحفظ تقريرك أو طباعته. يتضمن الشعار والخلاصة والمهارات الـ31." : "Ouvrez la pièce jointe pour enregistrer ou imprimer votre rapport. Elle contient le logo, la synthèse et les 31 compétences."}</p></div>` : ""}
<h2 style="font-size:19px;margin-top:24px">${copy.summary}</h2><p style="background:#edf5f9;padding:16px">${paragraph(report.summary)}</p><p style="font-size:13px;color:#526877">${copy.note}</p>
${skills}
<p style="border-top:1px solid #dce5e0;padding-top:16px;font-size:13px;color:#526877">${paragraph(report.disclaimer)}</p>
${hasEmail ? `<p style="font-size:13px;color:#526877">${copy.footer}</p>` : ""}</td></tr></table></td></tr></table>
</body></html>` };
}
