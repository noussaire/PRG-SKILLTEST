import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { acquireDispatchAdmission, dispatchJobs, DispatchBusy, sanitizeDispatchErrorCode } from "../src/services/job-dispatch.service.js";
import { MaintenanceStopped } from "../src/services/maintenance-control.js";

const sqlError = (code: string) => Object.assign(new Error("private SQL and credentials"), { code: "P2010", meta: { code, message: "SECRET" } });

function fixture(errors: unknown[] = [], onQuery?: () => void) {
  const events: string[] = [];
  const options: { maxWait: number; timeout: number; isolationLevel: string }[] = [];
  const sql: string[] = [];
  const state = {
    admission: { token: null as string | null, nextAllowedAt: 0, leaseUntil: 0 },
    otp: { id: "existing-otp", status: "PENDING", attempts: 0, encryptedPayload: "fixture-only", nextAttemptAt: 0 },
    intent: { id: "existing-intent", state: "PENDING", attempts: 0 },
    quota: { qstash: 12, email: 4 },
  };
  let pending = Promise.resolve();
  let number = 0;
  const db = {
    async $transaction(work: (tx: any) => Promise<unknown>, opts: any) {
      options.push(opts);
      const id = ++number;
      // Serialize the singleton UPDATE, as PostgreSQL's row lock does.
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const before = { ...state.admission };
      events.push(`BEGIN:${id}`);
      try {
        const result = await work({
          async $executeRawUnsafe(statement: string) { sql.push(statement); return 0; },
          async $queryRawUnsafe(statement: string, token: string) {
            assert.ok(statement.startsWith('UPDATE "JobDispatchState" SET "attemptToken"=$1::uuid,'));
            sql.push(statement);
            onQuery?.();
            if (errors.length) throw errors.shift();
            if (state.admission.leaseUntil > Date.now() || state.admission.nextAllowedAt > Date.now()) return [];
            state.admission = { token, nextAllowedAt: Date.now() + 10000, leaseUntil: Date.now() + 30000 };
            return [{ singleton: 1 }];
          },
        });
        events.push(`COMMIT:${id}`);
        return result;
      } catch (error) {
        state.admission = before;
        events.push(`ROLLBACK:${id}`);
        throw error;
      } finally { release(); }
    },
  } as unknown as PrismaClient;
  return { db, state, events, options, sql };
}

for (const code of ["40001", "40P01", "55P03"]) {
  test(`${code}: one fresh transaction after rollback, existing tasks and quotas preserved`, async () => {
    const f = fixture([sqlError(code)]);
    const before = structuredClone(f.state);
    const token = randomUUID();
    await acquireDispatchAdmission(f.db, token);
    assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1", "BEGIN:2", "COMMIT:2"]);
    assert.equal(f.state.admission.token, token);
    assert.deepEqual(f.state.otp, before.otp);
    assert.deepEqual(f.state.intent, before.intent);
    assert.deepEqual(f.state.quota, before.quota);
    assert.equal(f.options[0].maxWait, 1500);
    assert.ok(f.options[0].timeout <= 5000);
    assert.ok(f.options[1].timeout < f.options[0].timeout - 70);
    assert.ok(f.options.every(o => o.isolationLevel === "ReadCommitted" && o.maxWait <= 1500));
    assert.equal(f.sql.filter(s => s === "SET LOCAL statement_timeout='1500ms'").length, 2);
    assert.equal(f.sql.filter(s => s === "SET LOCAL lock_timeout='500ms'").length, 2);
  });
}

test("two temporary errors stop after two rollbacks; no publication or quota/task change", async () => {
  const second = sqlError("40P01");
  const f = fixture([sqlError("55P03"), second]);
  const before = structuredClone(f.state);
  let publications = 0;
  await assert.rejects(dispatchJobs(f.db, { async publish() { publications++; } }, undefined, 100), error => error === second);
  assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1", "BEGIN:2", "ROLLBACK:2"]);
  assert.deepEqual(f.state, before);
  assert.equal(publications, 0);
});

for (const code of ["42601", "42P01", "42501", "23505", "57014", "08006", "40003", "UNKNOWN", "55P03\nSECRET"]) {
  test(`${JSON.stringify(code)}: permanent, ambiguous or unknown errors are not retried`, async () => {
    const error = sqlError(code);
    const f = fixture([error]);
    const before = structuredClone(f.state);
    await assert.rejects(acquireDispatchAdmission(f.db, randomUUID()), e => e === error);
    assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1"]);
    assert.deepEqual(f.state, before);
  });
}

test("P2010 without SQLSTATE and P2028 never trigger retry", async () => {
  for (const code of ["P2010", "P2028"]) {
    const error = Object.assign(new Error("SECRET"), { code });
    const f = fixture([error]);
    await assert.rejects(acquireDispatchAdmission(f.db, randomUUID()), e => e === error);
    assert.equal(f.options.length, 1);
  }
});

test("already aborted: no transaction started", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture();
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID(), controller.signal), e => e instanceof MaintenanceStopped && e.code === "ABORTED");
  assert.equal(f.options.length, 0);
});

test("abort during failed transaction: rollback and no retry", async () => {
  const controller = new AbortController();
  const f = fixture([sqlError("55P03")], () => controller.abort());
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID(), controller.signal), e => e instanceof MaintenanceStopped && e.code === "ABORTED");
  assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1"]);
});

test("abort after successful UPDATE rolls back the claim and preserves tasks", async () => {
  const controller = new AbortController();
  const f = fixture([], () => controller.abort());
  const before = structuredClone(f.state);
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID(), controller.signal), e => e instanceof MaintenanceStopped && e.code === "ABORTED");
  assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1"]);
  assert.deepEqual(f.state, before);
});

test("direct SQLSTATE is retryable without assuming a P2010 wrapper", async () => {
  const f = fixture([Object.assign(new Error("SECRET"), { code: "40001" })]);
  await acquireDispatchAdmission(f.db, randomUUID());
  assert.equal(f.options.length, 2);
});

test("insufficient budget for backoff prevents retry", async t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const f = fixture([sqlError("55P03")], () => { clock = 4950; });
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID()), e => e instanceof MaintenanceStopped && e.code === "DEADLINE");
  assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1"]);
});

test("abort during backoff: awaited timer cancelled, no fresh transaction", async () => {
  const controller = new AbortController();
  const f = fixture([sqlError("55P03")]);
  const result = acquireDispatchAdmission(f.db, randomUUID(), controller.signal);
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(result, e => e instanceof MaintenanceStopped && e.code === "ABORTED");
    assert.deepEqual(f.events, ["BEGIN:1", "ROLLBACK:1"]);
  } finally { clearTimeout(timer); }
});

test("shared deadline exhausted: rollback without retry", async t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const f = fixture([sqlError("40001")], () => { clock = 5001; });
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID()), e => e instanceof MaintenanceStopped && e.code === "DEADLINE");
  assert.equal(f.options.length, 1);
});

test("remaining budget caps transaction, maxWait, SQL and lock limits on retry", async t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  let queries = 0;
  const f = fixture([sqlError("55P03")], () => { if (++queries === 1) clock = 4600; });
  await acquireDispatchAdmission(f.db, randomUUID());
  assert.deepEqual(f.options[1], { isolationLevel: "ReadCommitted", maxWait: 400, timeout: 400 });
  assert.ok(f.sql.includes("SET LOCAL statement_timeout='400ms'"));
  assert.ok(f.sql.includes("SET LOCAL lock_timeout='400ms'"));
});

test("two concurrent admissions including retry: only one winner, no overwritten lease", async () => {
  const f = fixture([sqlError("55P03")]);
  const before = structuredClone(f.state);
  const tokens = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled(tokens.map(token => acquireDispatchAdmission(f.db, token)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof DispatchBusy);
  const winner = results.findIndex(r => r.status === "fulfilled");
  assert.equal(f.state.admission.token, tokens[winner]);
  assert.equal(f.events.filter(e => e.startsWith("COMMIT")).length, 1);
  assert.deepEqual(f.state.otp, before.otp);
  assert.deepEqual(f.state.intent, before.intent);
  assert.deepEqual(f.state.quota, before.quota);
});

test("later invocation recovers persisted work after failed admission without resetting tasks", async () => {
  const f = fixture([sqlError("55P03"), sqlError("40001")]);
  const before = structuredClone(f.state);
  await assert.rejects(acquireDispatchAdmission(f.db, randomUUID()));
  await acquireDispatchAdmission(f.db, randomUUID());
  assert.deepEqual(f.state.otp, before.otp);
  assert.deepEqual(f.state.intent, before.intent);
  assert.deepEqual(f.state.quota, before.quota);
  assert.equal(f.options.length, 3);
});

test("sanitized diagnostic exposes SQLSTATE, never private metadata", () => {
  assert.equal(sanitizeDispatchErrorCode(sqlError("55P03")), "DB_55P03");
  assert.equal(sanitizeDispatchErrorCode(sqlError("42601")), "DB_42601");
  assert.equal(sanitizeDispatchErrorCode(sqlError("55P03\nSECRET")), "DB_P2010");
});
