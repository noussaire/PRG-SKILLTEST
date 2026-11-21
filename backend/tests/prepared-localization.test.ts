import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { interviewView } from "../src/services/adaptive.service.js";
import { PREPARED_BANK } from "../src/services/prepared-bank.js";
import { PREPARED_BRANCHES } from "../src/services/prepared-branches.js";

test("Switching language translates all 31 questions, choices, consequences and report without changing IDs or saved responses", t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No translation API"); });
  for (const original of ["fr", "ar"] as const) {
    const language = original === "fr" ? "ar" : "fr";
    let state = createPreparedInterview(original);
    let previousSkill: string | undefined, previousLevel = 0;
    while (state.currentQuestion) {
      const snapshot = structuredClone(state);
      const row = { id: "localization-test", displayName: "Test", state, expiresAt: new Date() };
      const view = interviewView(row, undefined, language), question = view.currentQuestion!;
      const entry = PREPARED_BANK.find(item => item[0] === question.skillId)!;
      assert.equal(view.language, language);
      assert.equal(question.prompt, entry[language === "ar" ? 2 : 1]);
      assert.deepEqual(question.choices?.map(item => item.id), state.currentQuestion.choices?.map(item => item.id));
      assert.deepEqual(question.choices?.map(item => item.label).sort(), [...entry[language === "ar" ? 4 : 3]].sort());
      assert.ok(!("rubric" in question));
      if (previousSkill) {
        const branch = PREPARED_BRANCHES[previousSkill as keyof typeof PREPARED_BRANCHES][4 - previousLevel];
        assert.equal(question.previousDecision?.consequence, branch[language === "ar" ? 2 : 1]);
      }
      assert.deepEqual(state, snapshot);
      const selected = question.choices![0];
      previousSkill = question.skillId;
      previousLevel = state.currentQuestion.rubric![selected.id].level;
      state = advancePreparedInterview(state, { questionId: question.id, choiceId: selected.id });
    }
    const row = { id: "done", displayName: "Test", state, expiresAt: new Date() };
    const job = { status: "COMPLETE", summary: JSON.stringify({ fr: "Votre synthèse française.", ar: "خلاصتك باللغة العربية." }), nextAttemptAt: new Date() };
    const french = interviewView(row, job, "fr"), arabic = interviewView(row, job, "ar");
    assert.equal(french.report?.summary, "Votre synthèse française.");
    assert.equal(arabic.report?.summary, "خلاصتك باللغة العربية.");
    assert.equal(arabic.report?.summarySource, "ai");
    for (const skill of arabic.report!.skills) {
      for (const text of [skill.label, skill.question, skill.answer, skill.rationale, skill.advice]) assert.match(text, /[\u0600-\u06ff]/);
    }
    assert.deepEqual(arabic.report?.skills.map(item => item.level), french.report?.skills.map(item => item.level));
    // Older French-only AI summaries must not be presented as Arabic AI text.
    const old = interviewView({ ...row, state: { ...state, language: "fr" } }, { ...job, summary: "Ancienne synthèse" }, "ar");
    assert.equal(old.report?.summarySource, "rules");
    assert.match(old.report!.summary, /[\u0600-\u06ff]/);
  }
  assert.equal(provider.mock.callCount(), 0);
});
