// Entirely in-memory: apply the 21 baseline migrations THEN the pending view.
// No seed, reset, credentials, environment mutation or network connection.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { checkLocal } = require('./report-fallback-migration.cjs');
const manifest = require('./report-fallback-migration-manifest.json');
(async () => {
  const checks = checkLocal(); const db = await PGlite.create();
  try {
    const sql = name => fs.readFileSync(path.resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
    for (const migration of manifest.baseline) await db.exec(sql(migration.name));
    const schema = () => db.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
    const before = (await schema()).rows;
    const oldView = (await db.query(`SELECT pg_get_viewdef('"JobPublicationCandidate"'::regclass) AS definition`)).rows[0].definition;
    await db.exec(sql(manifest.target));
    assert.deepEqual((await schema()).rows, before);
    const view = (await db.query(`SELECT pg_get_viewdef('"JobPublicationCandidate"'::regclass) AS definition`)).rows[0].definition;
    assert.ok(!oldView.includes('UNAVAILABLE') && view.includes('UNAVAILABLE'));
    await db.query('SELECT * FROM "JobPublicationReady" LIMIT 1');
    await db.exec(sql(manifest.target));
    assert.deepEqual((await schema()).rows, before);
    console.log(JSON.stringify({ ...checks, baselineAppliedBeforeTarget: 21, unchangedColumns: before.length, dependentViewValid: true, ddlRepeatable: true, seededRows: 0 }, null, 2));
  } finally { await db.close(); }
})().catch(() => { console.error('LOCAL_VIEW_QUALIFICATION_FAILED'); process.exitCode = 1; });
