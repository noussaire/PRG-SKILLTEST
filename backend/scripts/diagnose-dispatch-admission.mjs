import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const ADMISSION_LIMITS = Object.freeze({ budgetMs: 5000, sqlMs: 1500, maxWaitMs: 1500, lockMs: 500 });

// Verbatim query from src/services/job-dispatch.service.ts. Commit a91a776
// cannot be inspected in this checkout (no Git metadata).
export const ADMISSION_SQL = `UPDATE "JobDispatchState" SET "attemptToken"=$1::uuid,
      "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '30 seconds',
      "nextAllowedAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 seconds'
      WHERE singleton=1 AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
      AND "nextAllowedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') RETURNING singleton`;

export function safeAdmissionError(error) {
  // Prisma wraps raw-query SQLSTATE in P2010.meta.code. Never print messages,
  // metadata, stack traces, connection strings, environment or query parameters.
  const code = error?.code === 'P2010' ? error?.meta?.code : error?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P\d{4}$/.test(code) && !code.startsWith('00')) {
    return `PG_${code}`;
  }
  // Pool/transport/Prisma failures do not necessarily have a PostgreSQL code.
  return 'ADMISSION_ERROR';
}

// Inject a Prisma-compatible transaction adapter. No Prisma import, dotenv,
// application bootstrap, credential lookup, provider or network connector.
export async function diagnoseAdmission(db, { now = () => performance.now() } = {}) {
  const deadline = now() + ADMISSION_LIMITS.budgetMs;
  const remaining = () => {
    const ms = Math.floor(deadline - now());
    if (ms < 10) throw new Error('DEADLINE');
    return ms;
  };
  // Private identity sentinel: rejection of the interactive transaction forces
  // Prisma to ROLLBACK even when UPDATE succeeds. Never return from its callback.
  const rollback = new Error('ROLLBACK_ADMISSION_PROBE');
  let outcome;
  try {
    await db.$transaction(async tx => {
      remaining();
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='${Math.min(ADMISSION_LIMITS.sqlMs, remaining())}ms'`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout='${Math.min(ADMISSION_LIMITS.lockMs, remaining())}ms'`);
      remaining();
      const rows = await tx.$queryRawUnsafe(ADMISSION_SQL, randomUUID());
      remaining();
      if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && rows[0]?.singleton !== 1)) {
        throw new Error('UNEXPECTED_RESULT');
      }
      outcome = rows.length ? 'ADMISSION_OK' : 'DISPATCH_BUSY';
      throw rollback;
    }, {
      isolationLevel: 'ReadCommitted',
      maxWait: Math.min(ADMISSION_LIMITS.maxWaitMs, remaining()),
      timeout: remaining(),
    });
    // A broken adapter that resolves despite callback rejection fails closed.
    return 'ADMISSION_ERROR';
  } catch (error) {
    return error === rollback && outcome ? outcome : safeAdmissionError(error);
  }
}

// Local-only executable. There is deliberately no live execution mode.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowed = new Set(['ok', 'busy', 'lock', 'statement', 'pool']);
  const [flag, scenario, ...extra] = process.argv.slice(2);
  if (flag !== '--simulate' || !allowed.has(scenario) || extra.length) {
    process.stdout.write('ADMISSION_ERROR\n');
    process.exitCode = 1;
  } else {
    const { simulatedAdmissionDb } = await import('./lib/simulated-admission-db.mjs');
    const { db } = simulatedAdmissionDb(scenario);
    const code = await diagnoseAdmission(db);
    process.stdout.write(`${code}\n`);
    process.exitCode = code === 'ADMISSION_OK' || code === 'DISPATCH_BUSY' ? 0 : 1;
  }
}
