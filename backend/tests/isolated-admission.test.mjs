import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADMISSION_SQL, diagnoseAdmission, safeAdmissionError } from '../scripts/diagnose-dispatch-admission.mjs';
import { simulatedAdmissionDb } from '../scripts/lib/simulated-admission-db.mjs';

for (const [scenario, expected] of [['ok', 'ADMISSION_OK'], ['busy', 'DISPATCH_BUSY'], ['lock', 'PG_55P03'], ['statement', 'PG_57014'], ['invalid', 'ADMISSION_ERROR']]) {
  test(`${scenario}: rollback, no commit and unchanged state`, async () => {
    const sim = simulatedAdmissionDb(scenario);
    assert.equal(await diagnoseAdmission(sim.db), expected);
    assert.equal(sim.events.at(-1), 'ROLLBACK');
    assert.ok(!sim.events.includes('COMMIT'));
    assert.deepEqual(sim.state, sim.original);
  });
}

test('exact requested timeouts and parameterized production-source UPDATE', async () => {
  const sim = simulatedAdmissionDb();
  await diagnoseAdmission(sim.db, { now: () => 0 });
  assert.deepEqual(sim.options, { isolationLevel: 'ReadCommitted', maxWait: 1500, timeout: 5000 });
  assert.deepEqual(sim.events.slice(1, 4), ["SET LOCAL TIME ZONE 'UTC'", "SET LOCAL statement_timeout='1500ms'", "SET LOCAL lock_timeout='500ms'"]);
  const source = readFileSync(new URL('../src/services/job-dispatch.service.ts', import.meta.url), 'utf8');
  const query = source.match(/`(UPDATE "JobDispatchState" SET "attemptToken"=\$1::uuid,[\s\S]*?RETURNING singleton)`/);
  assert.ok(query);
  assert.equal(ADMISSION_SQL, query[1]);
  assert.equal(sim.events[4].sql, ADMISSION_SQL);
  assert.match(sim.events[4].token, /^[0-9a-f-]{36}$/);
});

for (const point of ['setup1', 'setup2', 'setup3', 'query']) {
  test(`${point}: SQL error rolls back`, async () => {
    const sim = simulatedAdmissionDb('ok', { failAt: point, failure: { code: '42501', message: 'SECRET' } });
    assert.equal(await diagnoseAdmission(sim.db), 'PG_42501');
    assert.equal(sim.events.at(-1), 'ROLLBACK');
    assert.deepEqual(sim.state, sim.original);
  });
}

test('pool acquisition failure: no transaction exists to roll back', async () => {
  const sim = simulatedAdmissionDb('pool');
  assert.equal(await diagnoseAdmission(sim.db), 'ADMISSION_ERROR');
  assert.deepEqual(sim.events, []);
});

test('rollback failure cannot report ADMISSION_OK', async () => {
  const sim = simulatedAdmissionDb('ok', { rollbackFailure: { code: '08006', message: 'SECRET' } });
  assert.equal(await diagnoseAdmission(sim.db), 'PG_08006');
});

test('deadline expired after UPDATE rolls back', async () => {
  const sim = simulatedAdmissionDb();
  let ticks = 0;
  assert.equal(await diagnoseAdmission(sim.db, { now: () => ++ticks < 8 ? 0 : 5001 }), 'ADMISSION_ERROR');
  assert.equal(sim.events.at(-1), 'ROLLBACK');
  assert.deepEqual(sim.state, sim.original);
});

test('no raw error data or invented PostgreSQL code', () => {
  for (const error of [null, undefined, new Error('SECRET'), { code: 'P2028' }, { code: 'P2010', meta: { code: 'SECRET\n' } }, { code: '00000' }]) {
    assert.equal(safeAdmissionError(error), 'ADMISSION_ERROR');
  }
  assert.equal(safeAdmissionError({ code: '42P01', message: 'SECRET' }), 'PG_42P01');
});

test('broken adapter cannot report success', async () => {
  assert.equal(await diagnoseAdmission({ async $transaction() {} }), 'ADMISSION_ERROR');
});

test('CLI simulations need no credentials and never print environment or secrets', () => {
  const script = fileURLToPath(new URL('../scripts/diagnose-dispatch-admission.mjs', import.meta.url));
  for (const [scenario, code, status] of [['ok', 'ADMISSION_OK', 0], ['busy', 'DISPATCH_BUSY', 0], ['lock', 'PG_55P03', 1], ['statement', 'PG_57014', 1], ['pool', 'ADMISSION_ERROR', 1]]) {
    const result = spawnSync(process.execPath, [script, '--simulate', scenario], {
      encoding: 'utf8', env: { DATABASE_URL: 'postgresql://SECRET@production.invalid/db', BREVO_API_KEY: 'SECRET', QSTASH_TOKEN: 'SECRET' }, windowsHide: true,
    });
    assert.equal(result.status, status);
    assert.equal(result.stdout, `${code}\n`);
    assert.equal(result.stderr, '');
  }
  const refused = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8', env: {}, windowsHide: true });
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, 'ADMISSION_ERROR\n');
  assert.equal(refused.stderr, '');
});
