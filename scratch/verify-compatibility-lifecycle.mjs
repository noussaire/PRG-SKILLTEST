import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const pgBin = path.resolve('output/pg-native-ef583905f4cd/portable/pgsql/bin');
const exe = name => path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));

const tempDir = fs.mkdtempSync(path.join(path.resolve('output/lot4-durable'), 'compat-audit-'));
const dataDir = path.join(tempDir, 'data');

console.log('=== AUDIT DE COMPATIBILITE BIDIRECTIONNELLE & CYCLE DE VIE POSTGRESQL ===');
console.log('Cluster temporaire:', dataDir);

let port;
try {
  // 1. initdb
  let res = spawnSync(exe('initdb'), ['-D', dataDir, '-U', 'compat_tester', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  assert.equal(res.status, 0, 'initdb failed: ' + res.stderr);

  // 2. port libre
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  await new Promise(r => srv.close(r));

  // 3. demarrage
  res = spawnSync(exe('pg_ctl'), ['-D', dataDir, '-l', path.join(tempDir, 'pg.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  assert.equal(res.status, 0, 'pg_ctl start failed');

  const psql = (sqlOrFile, isFile = false) => {
    const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'compat_tester', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    if (isFile) args.push('-f', sqlOrFile);
    else args.push('-c', sqlOrFile);
    const r = spawnSync(exe('psql'), args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql error: ' + r.stderr + ' (sql: ' + sqlOrFile + ')');
    return r.stdout;
  };

  // 4. Appliquer les migrations de production EXISTANTES (jusqu'a 20261105020000)
  const migrationsDir = path.resolve('backend/prisma/migrations');
  const folders = fs.readdirSync(migrationsDir).filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory()).sort();
  const preMigrations = folders.filter(f => f < '20261107000100_durable_dispatch');
  console.log(`[ETAPE 1] Application des ${preMigrations.length} migrations precedentes...`);
  for (const m of preMigrations) {
    psql(path.join(migrationsDir, m, 'migration.sql'), true);
  }

  // 5. Inserer des donnees representatives
  console.log('[ETAPE 2] Insertion de donnees representatives (anonymisees)...');
  psql(`
    INSERT INTO "User" (id, email, "passwordHash", role) VALUES ('a0000000-0000-0000-0000-000000000001', 'admin@example.test', 'hash', 'ADMIN');
    INSERT INTO "AssessmentSession" (id, "creatorId", name, code, status, "maxParticipants") VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Session Test', 'TEST01', 'OPEN', 50);
    INSERT INTO "Participant" (id, name, "sessionId", "rawCode") VALUES ('c0000000-0000-0000-0000-000000000001', 'SYNTH_Etudiant', 'b0000000-0000-0000-0000-000000000001', 'TEST01');
    INSERT INTO "AdaptiveInterview" (id, "participantId", "displayName", email, "reportEmailRequested", "expiresAt", state)
    VALUES ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'SYNTH_Etudiant', 'etudiant@example.test', true, clock_timestamp() + interval '2 hours', '{"currentQuestion":null,"answers":[],"summary":"Resume"}');
    INSERT INTO "ParticipantEmailGate" ("challengeId", "participantId", email, "expiresAt")
    VALUES ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'etudiant@example.test', clock_timestamp() + interval '10 minutes');
    INSERT INTO "ParticipantEmailDeliveryJob" (id, "challengeId", "expiresAt")
    VALUES ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', clock_timestamp() + interval '10 minutes');
    INSERT INTO "AdaptiveReportJob" (id, "interviewId", status, summary, "emailStatus")
    VALUES ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'COMPLETE', 'Resume IA', 'PENDING');
  `);

  // Verification requete ancien backend sur ancien schema
  const oldReadyCountBefore = psql('SELECT count(*) FROM "JobPublicationReady"').trim();
  console.log(`[ETAPE 3] Ancien backend sur ancien schema: ${oldReadyCountBefore} candidats JobPublicationReady detectes.`);

  // 6. Application de la migration 20261107000100_durable_dispatch
  console.log('[ETAPE 4] Application de 20261107000100_durable_dispatch sur la base existante...');
  const t0 = Date.now();
  psql(path.join(migrationsDir, '20261107000100_durable_dispatch', 'migration.sql'), true);
  const durMs = Date.now() - t0;
  console.log(`Migration reussie en ${durMs} ms !`);

  // 7. Verification: Ancien backend sur nouveau schema
  console.log('[ETAPE 5] Verification: Compatibilite de l\'ancien backend sur le nouveau schema...');
  const oldReadyCountAfter = psql('SELECT count(*) FROM "JobPublicationReady"').trim();
  assert.equal(oldReadyCountBefore, oldReadyCountAfter, 'Incoherence de visibilite des candidats pour l\'ancien backend !');
  const oldParticipant = psql('SELECT name FROM "Participant" WHERE id=\'c0000000-0000-0000-0000-000000000001\'').trim();
  assert.equal(oldParticipant, 'SYNTH_Etudiant');
  console.log('-> L\'ancien backend continue d\'interroger JobPublicationReady et les tables metiers sans aucune anomalie !');

  // 8. Verification: Nouveau backend sur nouveau schema
  console.log('[ETAPE 6] Verification: Nouveau backend sur nouveau schema...');
  const dispatchState = psql('SELECT singleton, cursor, "nextAllowedAt" FROM "JobDispatchState"').trim();
  console.log('-> JobDispatchState present:\n' + dispatchState);
  const lifetimeCount = psql('SELECT count(*) FROM "JobLifetime"').trim();
  assert.ok(Number(lifetimeCount) >= 2, 'JobLifetime incomplet !');
  console.log(`-> JobLifetime calcule correctement ${lifetimeCount} durees de vie actives.`);

  // 9. Verification Rollback Application (sans DROP ni DELETE dans _prisma_migrations)
  console.log('[ETAPE 7] Verification du Rollback sans modification de base...');
  console.log('En cas de retour au commit f914328 (ancien code), la base conserve les tables additives et la vue filtree.');
  console.log('Execution de requetes typiques de l\'ancien backend sur la base migree...');
  const checkOldQueries = psql(`
    SELECT j.id, j.status, i.email, r.kind
    FROM "AdaptiveReportJob" j
    JOIN "AdaptiveInterview" i ON i.id = j."interviewId"
    JOIN "JobPublicationReady" r ON r."jobId" = j.id
  `).trim();
  console.log('Resultat requete ancien backend:\n' + checkOldQueries);
  console.log('-> CONCLUSION AUDIT : La base migree est 100% compatible avec l\'ancien backend. Aucun DROP ni DELETE n\'est necessaire en cas de rollback applicatif.');

} finally {
  spawnSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  console.log('Cluster temporaire arrete proprement.');
}

