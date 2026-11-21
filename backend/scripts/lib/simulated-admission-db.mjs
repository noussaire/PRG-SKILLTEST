// In-memory transaction adapter only. No database or external dependency.
export function simulatedAdmissionDb(scenario = 'ok', { failAt, failure, rollbackFailure } = {}) {
  const events = [];
  const original = { attemptToken: null, leaseUntil: null, nextAllowedAt: 'fixture' };
  let state = { ...original };
  let options;
  const fail = point => { if (failAt === point) throw failure; };
  const db = {
    async $transaction(work, opts) {
      options = opts;
      if (scenario === 'pool') throw Object.assign(new Error('private connection details'), { code: 'P2028' });
      events.push('BEGIN');
      const snapshot = { ...state };
      let setup = 0;
      try {
        const result = await work({
          async $executeRawUnsafe(sql) {
            events.push(sql);
            fail(`setup${++setup}`);
            return 0;
          },
          async $queryRawUnsafe(sql, token) {
            events.push({ sql, token });
            fail('query');
            if (scenario === 'lock' || scenario === 'statement') {
              throw Object.assign(new Error('private SQL details'), { code: 'P2010', meta: { code: scenario === 'lock' ? '55P03' : '57014' } });
            }
            if (scenario === 'busy') return [];
            state = { attemptToken: token, leaseUntil: 'changed', nextAllowedAt: 'changed' };
            if (scenario === 'invalid') return [{ singleton: 2 }];
            return [{ singleton: 1 }];
          },
        });
        events.push('COMMIT');
        return result;
      } catch (error) {
        events.push('ROLLBACK');
        state = snapshot;
        if (rollbackFailure) throw rollbackFailure;
        throw error;
      }
    },
  };
  return { db, events, original, get state() { return state; }, get options() { return options; } };
}
