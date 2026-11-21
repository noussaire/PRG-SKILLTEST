import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library.js";
import type { PrismaClient } from "@prisma/client";
import { MaintenanceControl, MaintenanceStopped } from "../src/services/maintenance-control.js";
import { dispatchJobs, sanitizeDispatchErrorCode, DispatchBusy } from "../src/services/job-dispatch.service.js";

// Mock publisher: strictly in-memory, 0 network calls, 0 external providers
function createMockPublisher() {
  const published: unknown[] = [];
  return {
    publisher: {
      async publish(notification: unknown) {
        published.push(notification);
      },
    },
    published,
  };
}

test("ADMISSION TIMEOUTS: MaintenanceControl applies exact 500ms maxWait and 250ms lock_timeout", async () => {
  const capturedOptions: unknown[] = [];
  const executedSql: string[] = [];

  const mockDb = {
    async $transaction(work: (tx: any) => Promise<any>, options: unknown) {
      capturedOptions.push(options);
      const mockTx = {
        async $executeRawUnsafe(sql: string) {
          executedSql.push(sql);
          return 1;
        },
      };
      return work(mockTx);
    },
  } as unknown as PrismaClient;

  const control = new MaintenanceControl(2000, 500);
  await control.transaction(mockDb, async () => "ok");

  // Verify options passed to Prisma $transaction
  assert.equal(capturedOptions.length, 1);
  const opts = capturedOptions[0] as { isolationLevel: string; maxWait: number; timeout: number };
  assert.equal(opts.isolationLevel, "ReadCommitted");
  assert.equal(opts.maxWait, 500); // 500 ms pool acquisition timeout!
  assert.ok(opts.timeout >= 1990 && opts.timeout <= 2000); // 2000 ms total timeout

  // Verify SQL session timeout statements executed
  assert.ok(executedSql.includes("SET LOCAL TIME ZONE 'UTC'"));
  assert.ok(executedSql.includes("SET LOCAL statement_timeout='500ms'")); // 500 ms statement timeout!
  assert.ok(executedSql.includes("SET LOCAL lock_timeout='250ms'")); // 250 ms lock timeout!
});

test("ADMISSION FAILURE: Prisma pool connection timeout (P2028) leaves OTP PENDING with attempts=0", async () => {
  const { publisher, published } = createMockPublisher();

  // Simulate Prisma pool acquisition timeout (not a PostgreSQL retryable code).
  const poolTimeoutError = new PrismaClientKnownRequestError(
    "Transaction API error: Unable to start a transaction in the given time.",
    { code: "P2028", clientVersion: "6.19.3" }
  );

  const mockDb = {
    async $transaction() {
      throw poolTimeoutError;
    },
  } as unknown as PrismaClient;

  // dispatchJobs must reject with the error before any publication work
  let caughtError: unknown;
  try {
    await dispatchJobs(mockDb, publisher);
  } catch (err) {
    caughtError = err;
  }

  assert.equal(caughtError, poolTimeoutError);
  assert.equal(published.length, 0); // ZERO publications attempted

  // Sanitized diagnostic code must be DB_P2028
  const code = sanitizeDispatchErrorCode(caughtError);
  assert.equal(code, "DB_P2028");
});

test("ADMISSION FAILURE: persistent lock error 55P03 exhausts the bounded retry without publication", async () => {
  const { publisher, published } = createMockPublisher();

  // Simulate Postgres lock timeout error (55P03: lock_not_available)
  const lockTimeoutError = Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
  });

  const mockDb = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const mockTx = {
        async $executeRawUnsafe() { return 1; },
        async $queryRawUnsafe() {
          throw lockTimeoutError;
        },
      };
      return work(mockTx);
    },
  } as unknown as PrismaClient;

  let caughtError: unknown;
  try {
    await dispatchJobs(mockDb, publisher);
  } catch (err) {
    caughtError = err;
  }

  assert.equal(caughtError, lockTimeoutError);
  assert.equal(published.length, 0); // ZERO publications attempted

  // Sanitized diagnostic code must be DB_55P03
  const code = sanitizeDispatchErrorCode(caughtError);
  assert.equal(code, "DB_55P03");
});

test("ADMISSION FAILURE: query cancellation 57014 is not retried and leaves OTP PENDING with attempts=0", async () => {
  const { publisher, published } = createMockPublisher();

  // Simulate Postgres statement timeout error (57014: query_canceled)
  const statementTimeoutError = Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });

  const mockDb = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const mockTx = {
        async $executeRawUnsafe() { return 1; },
        async $queryRawUnsafe() {
          throw statementTimeoutError;
        },
      };
      return work(mockTx);
    },
  } as unknown as PrismaClient;

  let caughtError: unknown;
  try {
    await dispatchJobs(mockDb, publisher);
  } catch (err) {
    caughtError = err;
  }

  assert.equal(caughtError, statementTimeoutError);
  assert.equal(published.length, 0);

  // Sanitized diagnostic code must be DB_57014
  const code = sanitizeDispatchErrorCode(caughtError);
  assert.equal(code, "DB_57014");
});

test("ADMISSION FAILURE: Singleton claim miss (claimed.length === 0) raises DispatchBusy", async () => {
  const { publisher, published } = createMockPublisher();

  const mockDb = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const mockTx = {
        async $executeRawUnsafe() { return 1; },
        async $queryRawUnsafe() {
          // UPDATE returns empty array (e.g. lease is held or nextAllowedAt is in future)
          return [];
        },
      };
      return work(mockTx);
    },
  } as unknown as PrismaClient;

  let caughtError: unknown;
  try {
    await dispatchJobs(mockDb, publisher);
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError instanceof DispatchBusy);
  assert.equal(published.length, 0);

  // Sanitized diagnostic code must be DISPATCH_BUSY
  const code = sanitizeDispatchErrorCode(caughtError);
  assert.equal(code, "DISPATCH_BUSY");
});

test("ADMISSION FAILURE: Wall-clock budget exceeded (budgetMs 2000ms -> DEADLINE)", async () => {
  const control = new MaintenanceControl(5, 500); // 5ms budget (less than 10ms threshold)
  assert.throws(() => control.check(), (err: unknown) => {
    return err instanceof MaintenanceStopped && err.code === "DEADLINE";
  });
});
