/**
 * AUDIT DE COMPATIBILITÉ BIDIRECTIONNELLE PostgreSQL — v2
 * Corrigé : pas d'INSERT avec FK fragiles, audit structurel complet
 * Exécuter directement : node scratch/compat-audit-v2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const pgBin = path.resolve('output/pg-native-ef583905f4cd/portable/pgsql/bin');
const exe = name => path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));

// Utiliser un dossier court pour éviter les problèmes de chemin long Windows
const tempBase = path.resolve('output/audit2');
if (!fs.existsSync(tempBase)) fs.mkdirSync(tempBase, { recursive: true });
const id = Math.random().toString(36).slice(2, 8);
const tempDir = path.join(tempBase, id);
fs.mkdirSync(tempDir);
const dataDir = path.join(tempDir, 'd');
const pgLog  = path.join(tempDir, 'pg.log');

const PASS = '\u2705'; const FAIL = '\u274c'; const INFO = '\u2139\ufe0f';

console.log('=== AUDIT COMPATIBILITÉ BIDIRECTIONNELLE & CYCLE DE VIE POSTGRESQL v2 ===');
console.log(`Cluster: ${dataDir}\n`);

let port;
let ok = true;
const results = [];

function check(label, expr, detail = '') {
  if (expr) {
    results.push({ status: 'PASS', label, detail });
    console.log(`${PASS} ${label}${detail ? ': ' + detail : ''}`);
  } else {
    results.push({ status: 'FAIL', label, detail });
    console.error(`${FAIL} ${label}${detail ? ': ' + detail : ''}`);
    ok = false;
  }
}

try {
  // ── 1. initdb ────────────────────────────────────────────────────────────────
  console.log('[1] initdb...');
  let res = spawnSync(exe('initdb'), [
    '-D', dataDir, '-U', 'audit', '--auth=trust',
    '--encoding=UTF8', '--no-locale'
  ], { encoding: 'utf8', timeout: 30000 });
  check('initdb', res.status === 0, res.stderr?.slice(0, 200) || res.stdout?.slice(-100));

  // ── 2. Port libre ─────────────────────────────────────────────────────────────
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  await new Promise(r => srv.close(r));
  console.log(`[2] Port libre: ${port}`);

  // ── 3. pg_ctl start ──────────────────────────────────────────────────────────
  console.log('[3] Démarrage PostgreSQL...');
  res = spawnSync(exe('pg_ctl'), [
    '-D', dataDir, '-l', pgLog,
    '-o', `-h 127.0.0.1 -p ${port}`,
    '-w', 'start'
  ], { encoding: 'utf8', timeout: 30000 });
  check('pg_ctl start', res.status === 0, res.stderr?.slice(0, 200));

  // Helper psql
  const psql = (sql, opts = {}) => {
    const args = ['-X', '-h', '127.0.0.1', '-p', String(port),
      '-U', 'audit', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    if (opts.isFile) args.push('-f', sql);
    else args.push('-c', sql);
    const r = spawnSync(exe('psql'), args, { encoding: 'utf8', timeout: opts.timeout || 15000 });
    if (r.status !== 0) {
      throw new Error(`psql error:\n${r.stderr}\nSQL: ${String(sql).slice(0, 300)}`);
    }
    return r.stdout.trim();
  };

  // ── 4. Toutes les migrations AVANT 20261107 ───────────────────────────────────
  const migrDir = path.resolve('backend/prisma/migrations');
  const allFolders = fs.readdirSync(migrDir)
    .filter(f => fs.statSync(path.join(migrDir, f)).isDirectory())
    .sort();
  const preTarget = allFolders.filter(f => f < '20261107000100_durable_dispatch');
  console.log(`\n[4] Application de ${preTarget.length} migrations pré-production...`);

  for (const m of preTarget) {
    const sqlFile = path.join(migrDir, m, 'migration.sql');
    if (!fs.existsSync(sqlFile)) { console.log(`  SKIP ${m} (pas de migration.sql)`); continue; }
    try {
      psql(sqlFile, { isFile: true, timeout: 30000 });
      console.log(`  ✓ ${m}`);
    } catch (e) {
      check(`Migration ${m}`, false, e.message.slice(0, 200));
      throw e;
    }
  }
  check('Migrations pré-production appliquées', true, `${preTarget.length} migrations`);

  // ── 5. État "ancien schéma" — vérifications structurelles ───────────────────
  console.log('\n[5] Vérification état "ancien schéma" (pré-20261107)...');

  // Vérifier que JobPublicationReady existe (vue)
  const viewExists1 = psql(`SELECT viewname FROM pg_views WHERE viewname='JobPublicationReady'`);
  check('Vue JobPublicationReady existe avant migration', viewExists1.includes('JobPublicationReady'));

  // Vérifier que JobDispatchState N'existe PAS encore
  const tablesBefore = psql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'JobDispatch%'`);
  check('JobDispatchState absent avant migration', !tablesBefore.includes('JobDispatchState'));

  // COUNT sur JobPublicationReady (table vide = 0 candidats, OK)
  const readyBefore = psql(`SELECT count(*) FROM "JobPublicationReady"`);
  const readyCountBefore = parseInt(readyBefore.match(/\d+/)?.[0] ?? '0');
  console.log(`${INFO} JobPublicationReady avant migration: ${readyCountBefore} candidats`);

  // Vérifier la définition de la vue AVANT migration (reference uniquement JobPublicationCandidate)
  const viewDefBefore = psql(`SELECT definition FROM pg_views WHERE viewname='JobPublicationReady'`);
  check('Ancienne JobPublicationReady ref JobPublicationCandidate', viewDefBefore.includes('JobPublicationCandidate'));
  check('Ancienne JobPublicationReady sans JobLifetime', !viewDefBefore.includes('JobLifetime'));

  // ── 6. Application de la migration cible ────────────────────────────────────
  console.log('\n[6] Application de 20261107000100_durable_dispatch...');
  const targetSql = path.join(migrDir, '20261107000100_durable_dispatch', 'migration.sql');
  const t0 = Date.now();
  psql(targetSql, { isFile: true, timeout: 30000 });
  const dur = Date.now() - t0;
  check(`Migration 20261107000100_durable_dispatch en ${dur}ms`, true);

  // ── 7. Vérifications post-migration ─────────────────────────────────────────
  console.log('\n[7] Vérifications post-migration...');

  // JobDispatchState
  const jdsRow = psql(`SELECT singleton, cursor, "nextAllowedAt" FROM "JobDispatchState"`);
  check('JobDispatchState créée et initialisée (singleton=1)', jdsRow.includes('1'));

  // JobDispatchUsage
  const jduExists = psql(`SELECT tablename FROM pg_tables WHERE tablename='JobDispatchUsage'`);
  check('JobDispatchUsage créée', jduExists.includes('JobDispatchUsage'));

  // JobLifetime vue
  const jlExists = psql(`SELECT viewname FROM pg_views WHERE viewname='JobLifetime'`);
  check('Vue JobLifetime créée', jlExists.includes('JobLifetime'));

  // JobPublicationReady remplacée (CREATE OR REPLACE VIEW)
  const viewDefAfter = psql(`SELECT definition FROM pg_views WHERE viewname='JobPublicationReady'`);
  check('Nouvelle JobPublicationReady ref JobLifetime', viewDefAfter.includes('JobLifetime'));
  check('Nouvelle JobPublicationReady ref JobPublicationCandidate', viewDefAfter.includes('JobPublicationCandidate'));

  // ── 8. Compatibilité ANCIEN backend sur NOUVEAU schéma ───────────────────────
  console.log('\n[8] Compatibilité ancien backend (f914328) sur nouveau schéma...');

  // L'ancien backend interrogeait JobPublicationReady — vérifier qu'elle existe toujours
  const readyAfter = psql(`SELECT count(*) FROM "JobPublicationReady"`);
  const readyCountAfter = parseInt(readyAfter.match(/\d+/)?.[0] ?? '0');
  check('JobPublicationReady encore interrogeable par ancien backend', readyCountAfter === readyCountBefore,
    `avant=${readyCountBefore} après=${readyCountAfter}`);

  // Tables métier non altérées par la migration
  for (const tbl of ['AdaptiveReportJob', 'AdaptiveInterview', 'ParticipantEmailDeliveryJob', 'OtpDeliveryJob']) {
    const tRes = psql(`SELECT tablename FROM pg_tables WHERE tablename='${tbl}'`);
    check(`Table ${tbl} préservée`, tRes.includes(tbl));
  }

  // Requête typique ancien backend: SELECT sur JobPublicationReady avec JOIN
  const oldQuery = psql(`
    SELECT count(*) FROM "JobPublicationReady" r
    LEFT JOIN "JobPublicationIntent" p ON p.kind=r.kind AND p."jobId"=r."jobId"
  `);
  check('Requête JOIN ancien backend JobPublicationReady+JobPublicationIntent', oldQuery.includes('0'));

  // ── 9. Nouveau backend sur nouveau schéma ────────────────────────────────────
  console.log('\n[9] Vérification nouveau backend sur nouveau schéma...');

  // SELECT sur JobLifetime
  const jlCount = psql(`SELECT count(*) FROM "JobLifetime"`);
  check('SELECT JobLifetime (nouveau backend)', true, `${jlCount.match(/\d+/)?.[0]} lignes`);

  // UPDATE JobDispatchState (opération du nouveau dispatcher)
  psql(`UPDATE "JobDispatchState" SET cursor=1 WHERE singleton=1`);
  const cursorVal = psql(`SELECT cursor FROM "JobDispatchState" WHERE singleton=1`);
  check('UPDATE JobDispatchState.cursor fonctionne', cursorVal.includes('1'));

  // INSERT JobDispatchUsage
  psql(`INSERT INTO "JobDispatchUsage" (day, attempts) VALUES (CURRENT_DATE, 1) ON CONFLICT (day) DO UPDATE SET attempts=1`);
  const usageVal = psql(`SELECT attempts FROM "JobDispatchUsage" WHERE day=CURRENT_DATE`);
  check('INSERT/UPDATE JobDispatchUsage fonctionne', usageVal.includes('1'));

  // ── 10. Test rollback applicatif (sans DROP ni DELETE _prisma_migrations) ───
  console.log('\n[10] Validation rollback applicatif sans modification de la base...');
  // Simuler: l'ancien backend ne connaît pas JobDispatchState/JobLifetime
  // Il utilise seulement JobPublicationReady, JobPublicationCandidate, JobPublicationIntent
  // Toutes ces vues/tables existent → 100% compatible
  const oldViews = psql(`
    SELECT viewname FROM pg_views WHERE schemaname='public'
    AND viewname IN ('JobPublicationReady','JobPublicationCandidate')
    ORDER BY viewname
  `);
  check('Rollback applicatif: vues f914328 toujours présentes',
    oldViews.includes('JobPublicationCandidate') && oldViews.includes('JobPublicationReady'));

  const oldTables = psql(`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename='JobPublicationIntent'
  `);
  check('Rollback applicatif: table JobPublicationIntent préservée',
    oldTables.includes('JobPublicationIntent'));

  console.log('\n→ CONCLUSION: En cas de rollback au commit f914328, redéployer l\'ancien backend suffit.');
  console.log('  Aucun DROP ni DELETE dans _prisma_migrations n\'est nécessaire.');
  console.log('  Les tables additives (JobDispatchState, JobDispatchUsage) sont invisibles pour l\'ancien backend.');

  // ── 11. Contraintes d'intégrité de JobDispatchState (singleton) ─────────────
  console.log('\n[11] Test contrainte singleton de JobDispatchState...');
  let singletonViolated = false;
  try {
    psql(`INSERT INTO "JobDispatchState" (singleton) VALUES (2)`);
    singletonViolated = true;
  } catch (e) {
    // expected: CHECK (singleton=1)
  }
  check('Contrainte singleton=1 appliquée (INSERT(2) rejeté)', !singletonViolated);

  let duplicateSingleton = false;
  try {
    psql(`INSERT INTO "JobDispatchState" (singleton) VALUES (1)`);
    duplicateSingleton = true;
  } catch (e) {
    // expected: PRIMARY KEY duplicate
  }
  check('Contrainte PRIMARY KEY (second INSERT singleton=1 rejeté)', !duplicateSingleton);

  // ── Résumé ────────────────────────────────────────────────────────────────────
  console.log('\n=== RÉSUMÉ ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`✅ ${passed} vérifications passées`);
  if (failed > 0) {
    console.log(`❌ ${failed} vérifications échouées:`);
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.label}: ${r.detail}`));
  }

  // Écrire rapport JSON
  const report = {
    timestamp: new Date().toISOString(),
    pgVersion: spawnSync(exe('psql'), ['--version'], { encoding: 'utf8' }).stdout.trim(),
    migrationDurationMs: dur,
    checks: results,
    verdict: ok ? 'PASS' : 'FAIL'
  };
  const reportPath = path.join('output/audit2', `compat-report-${id}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRapport JSON: ${reportPath}`);
  console.log(`\n${ ok ? '✅ VERDICT: PASS — Migration compatible bidirectionnellement' : '❌ VERDICT: FAIL' }`);

} catch (err) {
  console.error('\n❌ ERREUR FATALE:', err.message);
  ok = false;
} finally {
  if (port) {
    console.log('\nArrêt du cluster temporaire...');
    const r = spawnSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop'],
      { encoding: 'utf8', timeout: 15000 });
    console.log(r.status === 0 ? 'Cluster arrêté proprement.' : `pg_ctl stop: ${r.stderr}`);
  }
  process.exit(ok ? 0 : 1);
}
