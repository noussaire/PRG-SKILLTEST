import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { reportPdfRenderer } from "../src/services/report-pdf.service.js";

async function main() {
  console.log("Testing PDF generation with existing renderer...");
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
      displayName: lang === "ar" ? "Exemple SkillQuest" : "Exemple SkillQuest",
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
    const pdf = await reportPdfRenderer.render(row, job);
    await writeFile(`C:/Users/pc/.gemini/antigravity/brain/508e1644-6889-436b-a07a-3ff87490ed69/scratch/current-${lang}.pdf`, pdf);
    console.log(`Saved current-${lang}.pdf (${pdf.length} bytes)`);
  }
}

main().catch(console.error);

