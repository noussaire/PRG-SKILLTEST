import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { generateReportSummary } from "../src/services/report-summary.service.js";
let previous: string | undefined;
let previousAllow: string | undefined;
beforeEach(() => {
  previous = process.env.GROQ_API_KEY;
  previousAllow = process.env.SKILLQUEST_ALLOW_REAL_GROQ;
  process.env.GROQ_API_KEY = "test-key-only";
  process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1";
});
afterEach(() => {
  if (previous === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previous;
  if (previousAllow === undefined) delete process.env.SKILLQUEST_ALLOW_REAL_GROQ; else process.env.SKILLQUEST_ALLOW_REAL_GROQ = previousAllow;
});
function finished() {
  let state = createPreparedInterview("fr");
  while (state.currentQuestion) state = advancePreparedInterview(state, { questionId: state.currentQuestion.id, choiceId: state.currentQuestion.choices![0].id });
  return state;
}
test("AI is unavailable before the complete report and receives no partial interviews", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected call"); });
  await assert.rejects(generateReportSummary(createPreparedInterview("fr")), { code: "REPORT_NOT_READY" });
  assert.equal(provider.mock.callCount(), 0);
});
test("One compact AI request enriches the report without changing its 31 observations", async t => {
  const state = finished(), snapshot = structuredClone(state);
  const provider = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_completion_tokens, 800);
    assert.ok(body.messages[1].content.length < 1800);
    const data = JSON.parse(body.messages[1].content);
    assert.ok(data.appuis.length <= 3 && data.aTravailler.length <= 3 && data.exemples.length <= 2);
    assert.ok(!("displayName" in data) && !("fullName" in data) && !("email" in data) && !("token" in data));
    assert.deepEqual(body.response_format.json_schema.schema.required, ["fr", "ar"]);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ fr: "Une synthèse pédagogique prudente fondée sur vos choix.", ar: "خلاصة تربوية مبنية على اختياراتك." }) } }] });
  });
  const result = JSON.parse(await generateReportSummary(state));
  assert.match(result.ar, /[\u0600-\u06ff]/); assert.ok(result.fr);
  assert.equal(provider.mock.callCount(), 1); assert.deepEqual(state, snapshot);
});
test("A report quota error leaves the already-complete report intact", async t => {
  const state = finished(), snapshot = structuredClone(state);
  const provider = t.mock.method(globalThis, "fetch", async () => new Response("limited", { status: 429, headers: { "Retry-After": "120" } }));
  await assert.rejects(generateReportSummary(state), { code: "AI_QUOTA_REACHED", retryAfterSeconds: 120 });
  assert.equal(provider.mock.callCount(), 1); assert.deepEqual(state, snapshot); assert.ok(state.summary);
  provider.mock.mockImplementation(async () => Response.json({ error: { message: "tokens per day (TPD) limit" } }, { status: 429 }));
  await assert.rejects(generateReportSummary(state), { code: "AI_QUOTA_REACHED", retryAfterSeconds: 86400, quotaScope: "day" });
});

test("An incomplete translation cannot be published as a bilingual AI summary", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ fr: "Votre synthèse", ar: "French text instead of Arabic" }) } }] }));
  await assert.rejects(generateReportSummary(finished()), { code: "AI_INVALID_RESPONSE" });
});
