import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { providerFetch, realProviderAllowed } from "../src/security/provider-mode.js";
import { brevoConfigured, sendReportEmail } from "../src/services/brevo.service.js";
import { aiConfigured } from "../src/services/adaptive.service.js";
import { realQstashPublisher } from "../src/services/qstash-publisher.service.js";
import { qstashConfiguration } from "../src/security/qstash-signature.js";

const saved = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
function keys() {
  Object.assign(process.env, { SKILLQUEST_STAGING_MODE: "off", BREVO_API_KEY: "fixture-only", BREVO_SENDER_EMAIL: "sender@example.test", GROQ_API_KEY: "fixture-only", QSTASH_TOKEN: "fixture-only", SKILLQUEST_QSTASH_MODE: "real",
    QSTASH_CURRENT_SIGNING_KEY: "current-local-fixture-0123456789abcdef", QSTASH_NEXT_SIGNING_KEY: "next-local-fixture-0123456789abcdef", QSTASH_CALLBACK_URL: "https://backend.example.test/api/internal/jobs/qstash" });
  for (const p of ["BREVO", "QSTASH", "GROQ"]) delete process.env[`SKILLQUEST_ALLOW_REAL_${p}`];
}
test("API keys alone cannot configure or call any real provider", async t => {
  keys(); const calls = t.mock.method(globalThis, "fetch", async () => { throw Error("NETWORK_FORBIDDEN"); });
  assert.equal(brevoConfigured(), false); assert.equal(aiConfigured(), false);
  assert.throws(realQstashPublisher, /DISABLED/); assert.throws(qstashConfiguration, /DISABLED/);
  for (const p of ["BREVO", "QSTASH", "GROQ"] as const) assert.throws(() => providerFetch(p, "https://forbidden.example.test/", {}), /DISABLED/);
  await assert.rejects(sendReportEmail({ recipient: "student@example.test", recipientName: "SYNTH-test", idempotencyKey: randomUUID(), subject: "Test", htmlContent: "<p>Test</p>" }), /BREVO_NOT_CONFIGURED/);
  assert.equal(calls.mock.callCount(), 0);
});
test("provider authorizations are independent and reject truthy typos", () => {
  keys();
  for (const p of ["BREVO", "QSTASH", "GROQ"] as const) {
    process.env[`SKILLQUEST_ALLOW_REAL_${p}`] = "true"; assert.equal(realProviderAllowed(p), false);
    process.env[`SKILLQUEST_ALLOW_REAL_${p}`] = "1";
    for (const other of ["BREVO", "QSTASH", "GROQ"] as const) assert.equal(realProviderAllowed(other), other === p);
    delete process.env[`SKILLQUEST_ALLOW_REAL_${p}`];
  }
});
test("synthetic-v1 wins over all real authorizations and refuses provider secrets", () => {
  keys(); for (const key of ["BREVO_API_KEY", "GROQ_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) delete process.env[key];
  Object.assign(process.env, { SKILLQUEST_STAGING_MODE: "synthetic-v1", SKILLQUEST_DEPLOYMENT_PURPOSE: "synthetic-staging", SKILLQUEST_STAGING_ACK: "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS", SKILLQUEST_STAGING_ID: randomUUID(), SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 73).toString("base64url") });
  for (const p of ["BREVO", "QSTASH", "GROQ"] as const) { process.env[`SKILLQUEST_ALLOW_REAL_${p}`] = "1"; assert.equal(realProviderAllowed(p), false); }
  assert.equal(brevoConfigured(), true); assert.equal(aiConfigured(), false);
  process.env.BREVO_API_KEY = "fixture-only"; assert.throws(() => realProviderAllowed("BREVO"), /SYNTHETIC/);
});
test("prepared QStash real adapter rechecks permission and exact destination before every mocked request", async t => {
  keys(); process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "1";
  let captured: { url: string; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => { captured = { url: String(url), init: init! }; return Response.json({ messageId: "simulated" }); });
  const publisher = realQstashPublisher();
  const n = { version: 1 as const, notificationId: randomUUID(), kind: "OTP_INITIAL" as const, jobId: randomUUID(), phase: "DELIVER" as const, generation: 0, dueAt: new Date().toISOString() };
  await publisher.publish(n, new AbortController().signal);
  assert.ok(captured); assert.match(captured.url, /^https:\/\/qstash\.upstash\.io\/v2\/publish\/https%3A/);
  assert.equal((captured.init.headers as Record<string, string>)["Upstash-Deduplication-Id"], n.notificationId);
  assert.equal(captured.init.redirect, "error");
  assert.deepEqual(JSON.parse(String(captured.init.body)), n);
  delete process.env.SKILLQUEST_ALLOW_REAL_QSTASH;
  await assert.rejects(publisher.publish(n, new AbortController().signal), /DISABLED/);
});
