import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { PrismaClient } from "@prisma/client";
import { dispatchJobs } from "../src/services/job-dispatch.service.js";
import { JobPublications } from "../src/services/job-publication.service.js";
import { MaintenanceStopped } from "../src/services/maintenance-control.js";
import { logOtpEvent, safeOtpCode } from "../src/services/otp-diagnostic.service.js";

function setup(t: TestContext, cleanupFailure = false) {
  let clock = 0, publications = 0;
  const logs: any[] = [], sql: string[] = [], transactionOptions: any[] = [];
  t.mock.method(performance, "now", () => clock);
  t.mock.method(console, "info", (line: string) => {
    assert.ok(!line.includes("private@example.test"));
    logs.push(JSON.parse(line));
  });
  const db = { async $transaction(work: (tx: any) => Promise<unknown>, options: unknown) {
    transactionOptions.push(options);
    return work({
      async $executeRawUnsafe(statement: string) {
        sql.push(statement);
        if (cleanupFailure && statement.includes('SET "attemptToken"=NULL')) throw sqlError("42501");
        return 1;
      },
      async $queryRawUnsafe(statement: string) {
        sql.push(statement);
        if (statement.startsWith('UPDATE "JobDispatchState"')) return [{ singleton: 1 }];
        if (statement.startsWith('SELECT singleton')) return [{ singleton: 1 }];
        if (statement.startsWith('SELECT cursor')) return [{ cursor: 0 }];
        if (statement.startsWith('WITH clock')) return []; // Real claim returns no intent.
        throw Error("Unexpected SQL in simulated database");
      },
    });
  } } as unknown as PrismaClient;
  return { logs, sql, transactionOptions, setClock: (value: number) => { clock = value; },
    run: () => dispatchJobs(db, { async publish() { publications++; } }, undefined, 100),
    publications: () => publications };
}
function sqlError(code: string) { return Object.assign(new Error("private@example.test"), { code: "P2010", meta: { code } }); }
function fastPreparation(t: TestContext) {
  t.mock.method(JobPublications.prototype, "retire", async () => ({ reports: 0, otp: 0, summaries: 0 }));
  t.mock.method(JobPublications.prototype, "reconcile", async () => ({ reports: 0, intents: 0, cancelled: 0, rearmed: 0 }));
}

for (const elapsed of [6500, 6600]) {
  test(`preparation consumes ${elapsed}ms: explicit budget stop without selection or false empty queue`, async t => {
    const f = setup(t); let selections = 0;
    t.mock.method(JobPublications.prototype, "retire", async () => { f.setClock(2000); return { reports: 0, otp: 0, summaries: 0 }; });
    t.mock.method(JobPublications.prototype, "reconcile", async () => { f.setClock(elapsed); return { reports: 0, intents: 0, cancelled: 0, rearmed: 0 }; });
    t.mock.method(JobPublications.prototype, "publishBatch", async () => { selections++; return { published: 0, deferred: 0, stale: 0 }; });
    assert.equal((await f.run()).stop, "PARTIAL");
    assert.equal(selections, 0); assert.equal(f.publications(), 0);
    assert.deepEqual(f.logs.filter(r => r.event === "DISPATCH_PHASE_FINISHED").map(r => [r.phase, r.durationMs, r.remainingMs]),
      [["RETIRE", 2000, 6000], ["RECONCILE", elapsed - 2000, 8000 - elapsed]]);
    assert.ok(f.logs.some(r => r.event === "BUDGET_EXHAUSTED_BEFORE_SELECTION" && r.phase === "SELECT"
      && r.code === "BUDGET_EXHAUSTED_BEFORE_SELECTION" && r.remainingMs === 8000 - elapsed));
    assert.ok(!f.logs.some(r => ["DISPATCH_FAILED", "JOB_SELECTED", "NO_JOB_READY"].includes(r.event)));
    assert.ok(f.logs.some(r => r.event === "DISPATCH_FINISHED" && r.code === "PARTIAL"));
  });
}

test("1501ms remaining still permits selection; the original threshold is unchanged", async t => {
  const f = setup(t); fastPreparation(t); let selections = 0;
  t.mock.method(JobPublications.prototype, "reconcile", async () => { f.setClock(6499); return { reports: 0, intents: 0, cancelled: 0, rearmed: 0 }; });
  t.mock.method(JobPublications.prototype, "publishBatch", async () => { selections++; return { published: 0, deferred: 0, stale: 0 }; });
  assert.equal((await f.run()).stop, "COMPLETE");
  assert.equal(selections, 1);
  assert.ok(!f.logs.some(r => r.event === "BUDGET_EXHAUSTED_BEFORE_SELECTION"));
});

for (const phase of ["RETIRE", "RECONCILE", "SELECT"] as const) {
  test(`${phase}: SQL exception is distinct from budget exhaustion and no eligible job`, async t => {
    const f = setup(t); fastPreparation(t);
    const method = phase === "RETIRE" ? "retire" : phase === "RECONCILE" ? "reconcile" : "publishBatch";
    t.mock.method(JobPublications.prototype, method, async () => { f.setClock(350); throw sqlError("42501"); });
    assert.equal((await f.run()).stop, "PARTIAL");
    assert.ok(f.logs.some(r => r.event === "DISPATCH_FAILED" && r.phase === phase && r.code === "DB_42501" && r.remainingMs === 7650));
    assert.ok(!f.logs.some(r => ["BUDGET_EXHAUSTED_BEFORE_SELECTION", "JOB_SELECTED", "NO_JOB_READY"].includes(r.event)));
    assert.equal(f.publications(), 0);
  });
}

test("real claim with no eligible job reports NO_JOB_READY and COMPLETE, retaining all limits", async t => {
  const f = setup(t); fastPreparation(t);
  assert.deepEqual(await f.run(), { published: 0, deferred: 0, stale: 0, stop: "COMPLETE" });
  assert.ok(f.logs.some(r => r.event === "NO_JOB_READY" && r.code === "NO_ELIGIBLE_JOB"));
  assert.ok(!f.logs.some(r => ["DISPATCH_FAILED", "BUDGET_EXHAUSTED_BEFORE_SELECTION", "JOB_SELECTED"].includes(r.event)));
  assert.deepEqual(f.transactionOptions.map(o => [o.maxWait, o.timeout]), [[1500, 5000], [500, 8000], [500, 1500]]);
  assert.ok(f.sql.includes("SET LOCAL statement_timeout='750ms'"));
  assert.ok(f.sql.includes("SET LOCAL lock_timeout='250ms'"));
  assert.equal(f.publications(), 0);
});

test("DEADLINE exception inside preparation has its own safe category and phase", async t => {
  const f = setup(t); fastPreparation(t);
  t.mock.method(JobPublications.prototype, "retire", async () => { f.setClock(8001); throw new MaintenanceStopped("DEADLINE"); });
  assert.equal((await f.run()).stop, "PARTIAL");
  assert.ok(f.logs.some(r => r.event === "DISPATCH_FAILED" && r.phase === "RETIRE" && r.code === "MAINTENANCE_DEADLINE" && r.remainingMs === 0));
  assert.ok(!f.logs.some(r => r.event === "BUDGET_EXHAUSTED_BEFORE_SELECTION"));
});

test("budget exhausted after entering publishBatch is not called a pre-selection stop", async t => {
  const f = setup(t); fastPreparation(t); let selections = 0;
  t.mock.method(JobPublications.prototype, "publishBatch", async () => { selections++; f.setClock(7000); return { published: 1, deferred: 0, stale: 0 }; });
  const result = await f.run();
  assert.equal(result.stop, "PARTIAL"); assert.equal(result.published, 1); assert.equal(selections, 1);
  assert.ok(!f.logs.some(r => r.event === "BUDGET_EXHAUSTED_BEFORE_SELECTION"));
});

test("cleanup failure is labelled CLEANUP without changing an otherwise COMPLETE result", async t => {
  const f = setup(t, true); fastPreparation(t);
  assert.equal((await f.run()).stop, "COMPLETE");
  assert.ok(f.logs.some(r => r.event === "DISPATCH_FAILED" && r.phase === "CLEANUP" && r.code === "DB_42501"));
});

test("phase and remaining budget are strictly projected, and typed maintenance failures are classified", t => {
  const f = setup(t);
  assert.equal(safeOtpCode(new MaintenanceStopped("DEADLINE")), "MAINTENANCE_DEADLINE");
  assert.equal(safeOtpCode(new MaintenanceStopped("ABORTED")), "MAINTENANCE_ABORTED");
  assert.equal(safeOtpCode(new Error("DEADLINE")), "UNKNOWN_ERROR");
  logOtpEvent("DISPATCH_PHASE_FINISHED", "ok", { phase: "RECONCILE", remainingMs: 1600, durationMs: 6400 });
  assert.deepEqual(f.logs.at(-1), { event: "DISPATCH_PHASE_FINISHED", status: "ok", durationMs: 6400, remainingMs: 1600, phase: "RECONCILE" });
  logOtpEvent("DISPATCH_FAILED", "failed", { phase: "private@example.test", remainingMs: Infinity, error: "private@example.test" } as any);
  assert.deepEqual(f.logs.at(-1), { event: "DISPATCH_FAILED", status: "failed" });
});
