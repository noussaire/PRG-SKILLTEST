import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ADAPTIVE_SKILLS } from "../src/services/adaptive-catalog.js";
import { advanceInterview, aiConfigured, createInterviewState, prepareInterviewChoices, interviewView, type InterviewState } from "../src/services/adaptive.service.js";

let savedKey: string | undefined;
let savedAllow: string | undefined;
beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  savedAllow = process.env.SKILLQUEST_ALLOW_REAL_GROQ;
  process.env.GROQ_API_KEY = "isolated-test-key";
  process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedKey;
  if (savedAllow === undefined) delete process.env.SKILLQUEST_ALLOW_REAL_GROQ; else process.env.SKILLQUEST_ALLOW_REAL_GROQ = savedAllow;
});
const initial: InterviewState = {
  language: "fr", answers: [], summary: null,
  currentQuestion: { id: "question-test", skillId: "communication", text: "Votre équipe ne comprend pas le projet. Que faites-vous ?" },
};
const answer = "Je propose une réunion pour reformuler ensemble les objectifs.";
const assessment = { level: 3 as const, evidenceQuote: "reformuler ensemble les objectifs", rationale: "Une action précise de clarification est décrite, dans cette seule situation.", advice: "Demandez à chaque membre de reformuler la prochaine étape." };
const choices = ["Je demande un retour et je clarifie la prochaine étape avec mon équipe.", "Je présente mon plan sans interrompre le travail du groupe.", "Je consulte un camarade avant de proposer une méthode.", "Je laisse chacun avancer puis je fais un point en fin de journée."];
// Match the provider's phase-specific schema: unused top-level fields are absent.
const completion = (data: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(Object.fromEntries(Object.entries({ ...data, ...(data.nextQuestion ? { choices: data.choices ?? choices } : {}) }).filter(([, value]) => value !== null))) } }] }), { status: 200 });

test("Missing configuration never calls a model or produces simulated AI", async t => {
  delete process.env.GROQ_API_KEY;
  delete process.env.SKILLQUEST_ALLOW_REAL_GROQ;
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
  assert.equal(aiConfigured(), false);
  await assert.rejects(createInterviewState("fr"), { code: "AI_NOT_CONFIGURED" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("First question requests the selected language and first of exactly 31 skills", async t => {
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(options?.body));
    const input = JSON.parse(body.messages[1].content).donneesEntretien;
    assert.equal(input.langue, "ar");
    assert.equal(input.prochaineCompetence.id, "communication");
    assert.equal(input.reponseCourante, null);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["nextQuestion", "choices"]);
    assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties), ["nextQuestion", "choices"]);
    assert.ok(!("displayName" in input));
    return completion({ assessment: null, nextQuestion: "كيف توضح الفكرة لفريقك؟", summary: null });
  });
  const state = await createInterviewState("ar");
  assert.equal(state.currentQuestion?.skillId, "communication");
  assert.equal(state.answers.length, 0);
  assert.equal(state.currentQuestion?.choices?.length, 4);
  assert.equal(ADAPTIVE_SKILLS.length, 31);
  assert.equal(new Set(ADAPTIVE_SKILLS.map(s => s[0])).size, 31);
});

test("Next question receives the actual answer; failures cannot mutate saved state", async t => {
  const before = structuredClone(initial);
  t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content).donneesEntretien;
    assert.equal(input.reponseCourante, answer);
    assert.equal(input.competenceCourante.id, "communication");
    assert.equal(input.prochaineCompetence.id, "ecoute-active");
    assert.deepEqual(bodySchema(options).required, ["assessment", "nextQuestion", "choices"]);
    return completion({ assessment, nextQuestion: "Pendant cette réunion, un membre vous interrompt. Comment l'écoutez-vous ?", summary: null });
  });
  const state = await advanceInterview(initial, { questionId: "question-test", answer });
  assert.equal(state.answers[0].answer, answer);
  assert.equal(state.currentQuestion?.skillId, "ecoute-active");
  assert.notEqual(state.currentQuestion?.id, initial.currentQuestion?.id);
  assert.deepEqual(initial, before);
  const view = interviewView({ id: "i", displayName: "Pseudo", state, expiresAt: new Date("2027-01-01") });
  assert.equal(view.report, null);
  assert.deepEqual(view.transcript, [{ question: initial.currentQuestion!.text, answer }]);
});

function bodySchema(options?: RequestInit) {
  return JSON.parse(String(options?.body)).response_format.json_schema.schema;
}

test("Provider JSON generation failures are reported as retryable format errors", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "json_validate_failed", message: "Failed to generate JSON", failed_generation: "{assessment:Object.null" } }, { status: 400 }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_INVALID_RESPONSE", status: 503 });
  assert.equal(provider.mock.callCount(), 1);
});

test("Hallucinated evidence, missing levels and repeated questions are rejected", async t => {
  const fixture = { assessment: { ...assessment, evidenceQuote: "Je suis un excellent communicant" }, nextQuestion: "Une autre question ?", summary: null };
  t.mock.method(globalThis, "fetch", async () => completion(fixture));
  await assert.rejects(advanceInterview(initial, { questionId: "question-test", answer }), { code: "AI_INVALID_RESPONSE" });
  fixture.assessment = { ...assessment };
  fixture.nextQuestion = initial.currentQuestion!.text;
  await assert.rejects(advanceInterview(initial, { questionId: "question-test", answer }), { code: "AI_INVALID_RESPONSE" });
  assert.equal(initial.answers.length, 0);
});

test("Stale answers and invalid lengths never consume provider quota", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
  await assert.rejects(advanceInterview(initial, { questionId: "stale", answer }), { code: "QUESTION_CHANGED" });
  await assert.rejects(advanceInterview(initial, { questionId: "question-test", answer: "ok" }), { code: "INVALID_ANSWER" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("Quota and provider errors preserve the question and do not auto-retry", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("limited", { status: 429 }));
  await assert.rejects(advanceInterview(initial, { questionId: "question-test", answer }), { code: "AI_QUOTA_REACHED", status: 429 });
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => { throw new Error("timeout"); });
  await assert.rejects(advanceInterview(initial, { questionId: "question-test", answer }), { code: "AI_UNAVAILABLE" });
  assert.equal(initial.currentQuestion?.id, "question-test");
});

test("Full 31-question report keeps evidence and unknown skills distinct from zero", async t => {
  const provider = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content).donneesEntretien;
    if (input.reponseCourante && !input.prochaineCompetence) {
      assert.deepEqual(bodySchema(options).required, ["assessment", "summary"]);
      assert.ok(!("nextQuestion" in bodySchema(options).properties));
      assert.equal(input.observationsPrecedentes.length, 30);
    } else {
      assert.equal(input.observationsPrecedentes.length, 0);
      assert.ok(input.echangesRecents.length <= 1);
      assert.ok(JSON.parse(String(options?.body)).max_completion_tokens < 1800);
    }
    return completion({
      assessment: input.reponseCourante ? { level: input.competenceCourante.id === "ecoute-active" ? null : 3, evidenceQuote: "Je demande un retour", rationale: "Un seul exemple décrit, sans vérification en situation réelle.", advice: "Essayez cette action dans un petit projet." } : null,
      nextQuestion: input.prochaineCompetence ? `Situation pour ${input.prochaineCompetence.label} : comment agissez-vous ?` : null,
      summary: input.prochaineCompetence ? null : "Votre parcours propose des pistes d'entraînement à partir de vos exemples. Ces repères demandent à être confrontés à des situations réelles.",
    });
  });
  let state = await createInterviewState("fr");
  for (let i = 0; i < 31; i++) state = await advanceInterview(state, { questionId: state.currentQuestion!.id, choiceId: state.currentQuestion!.choices![0].id });
  const view = interviewView({ id: "interview", displayName: "Pseudo", state, expiresAt: new Date("2027-01-01") });
  assert.equal(view.status, "COMPLETED");
  assert.equal(view.answeredCount, 31);
  assert.equal(view.report?.skills.length, 31);
  assert.equal(view.report?.skills[1].level, null);
  assert.equal(view.currentQuestion, null);
  assert.equal(provider.mock.callCount(), 32);
  for (const skill of view.report!.skills) assert.ok(skill.answer.includes(skill.evidenceQuote));
  await assert.rejects(advanceInterview(state, { questionId: "anything", answer }), { code: "QUESTION_CHANGED" });
});

test("Minute token quotas include the provider's wait time without exposing its account details", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Rate limit for org-private on tokens per minute (TPM)" } }, { status: 429, headers: { "Retry-After": "12.4" } }));
  await assert.rejects(createInterviewState("fr"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { quotaScope?: string }).quotaScope, "minute");
    assert.equal((error as { retryAfterSeconds?: number }).retryAfterSeconds, 13);
    assert.ok(!error.message.includes("org-private"));
    return true;
  });
  assert.equal(provider.mock.callCount(), 1);
});

test("Daily quotas and absent retry information are distinguished honestly", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "tokens per day (TPD) limit" } }, { status: 429, headers: { "Retry-After": "3600" } }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_QUOTA_REACHED", quotaScope: "day", retryAfterSeconds: 3600 });
  provider.mock.mockImplementation(async () => new Response("limited", { status: 429 }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_QUOTA_REACHED", quotaScope: "unknown", retryAfterSeconds: undefined });
});

test("Only a stored choice can answer a multiple-choice question", async t => {
  const state: InterviewState = { ...initial, currentQuestion: { ...initial.currentQuestion!, choices: [{ id: "valid-choice", label: answer }] } };
  const provider = t.mock.method(globalThis, "fetch", async () => completion({ assessment, nextQuestion: "Que choisissez-vous ensuite ?" }));
  await assert.rejects(advanceInterview(state, { questionId: "question-test", choiceId: "foreign-choice" }), { code: "INVALID_CHOICE" });
  await assert.rejects(advanceInterview(state, { questionId: "question-test", answer }), { code: "INVALID_CHOICE" });
  assert.equal(provider.mock.callCount(), 0);
  const next = await advanceInterview(state, { questionId: "question-test", choiceId: "valid-choice", answer: "Forged client label" });
  assert.equal(next.answers[0].answer, answer);
});

test("Existing interviews gain choices without losing their question or history", async t => {
  const provider = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    assert.deepEqual(bodySchema(options).required, ["choices"]);
    return completion({ choices });
  });
  const upgraded = await prepareInterviewChoices(initial);
  assert.equal(upgraded.currentQuestion?.id, initial.currentQuestion?.id);
  assert.equal(upgraded.currentQuestion?.text, initial.currentQuestion?.text);
  assert.deepEqual(upgraded.answers, initial.answers);
  assert.equal(upgraded.currentQuestion?.choices?.length, 4);
  assert.deepEqual(await prepareInterviewChoices(upgraded), upgraded);
  assert.equal(provider.mock.callCount(), 1);
});

test("Missing, duplicate or incomplete proposals cannot be published", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => completion({ nextQuestion: "Que choisissez-vous ?", choices: ["A", "A", "B", "C"] }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_INVALID_RESPONSE" });
  provider.mock.mockImplementation(async () => completion({ nextQuestion: "Que choisissez-vous ?", choices: ["A", "B", "C"] }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_INVALID_RESPONSE" });
  provider.mock.mockImplementation(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ nextQuestion: "Que choisissez-vous ?" }) } }] }));
  await assert.rejects(createInterviewState("fr"), { code: "AI_INVALID_RESPONSE" });
});
