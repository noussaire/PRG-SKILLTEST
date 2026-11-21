import { test } from "node:test";
import assert from "node:assert/strict";
import { startEmailRetention, EMAIL_RETENTION_INTERVAL_MS } from "../src/services/email-retention.service.js";

test("Retention starts immediately, runs hourly, prevents overlap and stops", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = startEmailRetention(async () => { calls++; if (calls === 1) await barrier; });
  assert.equal(calls, 1);
  t.mock.timers.tick(EMAIL_RETENTION_INTERVAL_MS * 2); assert.equal(calls, 1);
  release(); await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(EMAIL_RETENTION_INTERVAL_MS); assert.equal(calls, 2);
  stop(); await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(EMAIL_RETENTION_INTERVAL_MS * 2); assert.equal(calls, 2);
});

test("Retention retries next hour after failure without logging data or secrets", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  let calls = 0;
  const stop = startEmailRetention(async () => { if (++calls === 1) throw Error("synthetic-sensitive-detail"); });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [["Email retention cleanup temporarily unavailable"]]);
  t.mock.timers.tick(EMAIL_RETENTION_INTERVAL_MS); assert.equal(calls, 2);
  stop();
});
