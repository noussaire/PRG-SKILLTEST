import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTIVE_SKILLS } from "../src/services/adaptive-catalog.js";
import { PREPARED_BANK } from "../src/services/prepared-bank.js";
import { PREPARED_BRANCHES } from "../src/services/prepared-branches.js";
import { createPreparedInterview, advancePreparedInterview, upgradePreparedInterview } from "../src/services/prepared-interview.service.js";
import { interviewView } from "../src/services/adaptive.service.js";

test("The prepared bank covers exactly 31 bilingual skills with four distinct choices", () => {
  assert.deepEqual(PREPARED_BANK.map(row => row[0]).sort(), ADAPTIVE_SKILLS.map(row => row[0]).sort());
  assert.equal(PREPARED_BANK.length, 31);
  for (const row of PREPARED_BANK) {
    assert.ok(row[1].trim() && row[2].trim());
    for (const labels of [row[3], row[4]]) { assert.equal(labels.length, 4); assert.equal(new Set(labels).size, 4); assert.ok(labels.every(label => label.trim().length > 5)); }
  }
});

test("A selected action changes the next skill and fictional situation", () => {
  const state = createPreparedInterview("fr"), question = state.currentQuestion!;
  const dialogue = question.choices!.find(choice => question.rubric![choice.id].style === "dialoguer")!;
  const organise = question.choices!.find(choice => question.rubric![choice.id].style === "organiser")!;
  const first = advancePreparedInterview(state, { questionId: question.id, choiceId: dialogue.id });
  const second = advancePreparedInterview(state, { questionId: question.id, choiceId: organise.id });
  assert.notEqual(first.currentQuestion?.skillId, second.currentQuestion?.skillId);
  assert.notEqual(first.currentQuestion?.text, second.currentQuestion?.text);
  assert.equal(state.answers.length, 0);
});

test("Every one of the124 choices has its own causal follow-up in both languages", t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No external AI"); });
  for (const language of ["fr", "ar"] as const) {
    for (const [skillId] of ADAPTIVE_SKILLS) {
      const state = upgradePreparedInterview({ language, summary: null, answers: [], currentQuestion: { id: "old-question", skillId, text: "Old prompt" } });
      const source = state.currentQuestion!;
      assert.equal(PREPARED_BRANCHES[skillId].length, 4);
      const branches = source.choices!.map(choice => {
        const next = advancePreparedInterview(state, { questionId: source.id, choiceId: choice.id });
        assert.equal(next.currentQuestion?.previousDecision?.questionId, source.id);
        assert.equal(next.currentQuestion?.previousDecision?.choiceLabel, choice.label);
        assert.equal(next.currentQuestion?.previousDecision?.consequence, source.rubric![choice.id].consequence);
        assert.equal(next.currentQuestion?.skillId, source.rubric![choice.id].nextSkill);
        assert.ok(next.currentQuestion!.text.includes(source.rubric![choice.id].consequence!));
        return next.currentQuestion!.text;
      });
      assert.equal(new Set(branches).size, 4, `${language}:${skillId}`);
    }
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("A saved reaction is used as-is and old prepared questions can continue", () => {
  const state = createPreparedInterview("fr"), question = state.currentQuestion!;
  const selected = question.choices![0];
  question.rubric![selected.id].consequence = "Réaction propre à la version sauvegardée.";
  const next = advancePreparedInterview(state, { questionId: question.id, choiceId: selected.id });
  assert.equal(next.currentQuestion?.previousDecision?.consequence, "Réaction propre à la version sauvegardée.");
  const old = structuredClone(state); old.engine = "prepared-v1";
  for (const rubric of Object.values(old.currentQuestion!.rubric!)) { delete rubric.consequence; delete rubric.nextSkill; }
  const resumed = advancePreparedInterview(old, { questionId: question.id, choiceId: selected.id });
  assert.equal(resumed.engine, "prepared-v2");
  assert.ok(resumed.currentQuestion?.previousDecision?.consequence);
  assert.equal(resumed.answers[0].answer, selected.label);
});

test("Rubrics stay private and unknown or stale choices cannot change an answer", () => {
  const state = createPreparedInterview("fr"), question = state.currentQuestion!;
  const view = interviewView({ id: "test", displayName: "Test", state, expiresAt: new Date("2027-01-01") });
  assert.ok(!JSON.stringify(view.currentQuestion).includes("rubric"));
  assert.equal(view.report, null);
  assert.throws(() => advancePreparedInterview(state, { questionId: "stale", choiceId: question.choices![0].id }), { code: "STALE_QUESTION" });
  assert.throws(() => advancePreparedInterview(state, { questionId: question.id, choiceId: "foreign-choice" }), { code: "INVALID_CHOICE" });
  assert.equal(state.answers.length, 0);
});

test("An old interview resumes at its saved progress without an AI call", t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider may be called"); });
  let state = createPreparedInterview("fr");
  for (let i = 0; i < 9; i++) state = advancePreparedInterview(state, { questionId: state.currentQuestion!.id, choiceId: state.currentQuestion!.choices![0].id });
  const old = { ...state, engine: undefined };
  const upgraded = upgradePreparedInterview(old);
  assert.equal(upgraded.answers.length, 9);
  assert.deepEqual(upgraded.answers, state.answers);
  assert.equal(upgraded.currentQuestion?.skillId, state.currentQuestion?.skillId);
  assert.notEqual(upgraded.currentQuestion?.id, state.currentQuestion?.id);
  assert.equal(provider.mock.callCount(), 0);
});

test("300 complete prepared journeys produce all 31 results with zero external calls", t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider may be called"); });
  for (let person = 0; person < 300; person++) {
    let state = createPreparedInterview(person % 2 ? "ar" : "fr");
    for (let step = 0; step < 31; step++) {
      const current = state.currentQuestion!;
      assert.equal(current.choices!.length, 4);
      state = advancePreparedInterview(state, { questionId: current.id, choiceId: current.choices![(person + step) % 4].id });
    }
    const view = interviewView({ id: String(person), displayName: "Test", state, expiresAt: new Date("2027-01-01") });
    assert.equal(view.status, "COMPLETED");
    assert.equal(view.report?.skills.length, 31);
    assert.equal(new Set(view.report?.skills.map(skill => skill.id)).size, 31);
    assert.equal(view.report?.summarySource, "rules");
    assert.ok(view.report?.summary);
    assert.equal(view.currentQuestion, null);
  }
  assert.equal(provider.mock.callCount(), 0);
});
