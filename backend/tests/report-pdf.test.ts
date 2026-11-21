import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { printableReportHTML, reportPdfRenderer } from "../src/services/report-pdf.service.js";

for (const language of ["fr", "ar"] as const) test(`The ${language} PDF embeds the white logo, font and 31 skills without external resources`, { timeout: 60000 }, async () => {
  let state = createPreparedInterview(language);
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  const row = { id: randomUUID(), displayName: "Participant <test>", state: state as never, expiresAt: new Date(Date.now() + 86400000) };
  const job = { status: "COMPLETE", summary: JSON.stringify({ fr: "Synthèse personnelle pour apprendre et progresser.", ar: "خلاصة شخصية للتعلم والتقدم." }), nextAttemptAt: new Date() };
  const html = await printableReportHTML(row, job);
  assert.equal(html.match(/<section /g)?.length, 31);
  assert.ok(html.includes('data-report-logo src="data:image/png;base64,'));
  assert.ok(html.includes("data:font/ttf;base64,")); assert.ok(html.includes("&lt;test&gt;"));
  assert.ok(!html.includes("https://")); assert.ok(!html.includes("<script"));
  const pdf = await reportPdfRenderer.render(row, job);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const structure = pdf.toString("latin1");
  assert.ok(structure.includes("/FontFile2") || structure.includes("/FontFile3"));
  assert.ok(structure.includes("/Subtype /Image")); assert.ok(structure.includes("/StructTreeRoot"));
  const pages = structure.match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages >= 3 && pages <= 20, `Expected readable A4 pagination, got ${pages}`);
});
