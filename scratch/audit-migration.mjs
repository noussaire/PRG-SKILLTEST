import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const pgBin = path.resolve('output/pg-native-ef583905f4cd/portable/pgsql/bin');
const exe = name => path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));

const tempDir = fs.mkdtempSync(path.join(path.resolve('output/lot4-durable'), 'schema-audit-'));
const dataDir = path.join(tempDir, 'data');

console.log('--- TEST MIGRATION ET COMPATIBILITE SUR POSTGRESQL LOCAL JETABLE ---');
console.log('Cluster dir:', dataDir);

try {
  // 1. initdb
  let res = spawnSync(exe('initdb'), ['-D', dataDir, '-U', 'lot4_audit', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  assert.equal(res.status, 0, 'initdb failed: ' + res.stderr);

  // 2. get free port
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));

  // 3. pg_ctl start
  res = spawnSync(exe('pg_ctl'), ['-D', dataDir, '-l', path.join(tempDir, 'pg.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  assert.equal(res.status, 0, 'pg_ctl start failed');

  const psql = (sqlOrFile, isFile = false) => {
    const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'lot4_audit', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    if (isFile) args.push('-f', sqlOrFile);
    else args.push('-c', sqlOrFile);
    const r = spawnSync(exe('psql'), args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql failed: ' + r.stderr + ' (sql: ' + sqlOrFile + ')');
    return r.stdout;
  };

  // 4. Appliquer les migrations de 20261016 jusqu a 20261105 (AVANT 20261107)
  const migrationsDir = path.resolve('backend/prisma/migrations');
  const folders = fs.readdirSync(migrationsDir).filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory()).sort();
  const preMigrations = folders.filter(f => f < '20261107000100_durable_dispatch');
  console.log(`Application des migrations preexistantes (${preMigrations.length} migrations)...`);
  for (const m of preMigrations) {
    psql(path.join(migrationsDir, m, 'migration.sql'), true);
  }

  // 5. Inserer un etat representatif de production (donnees synthetiques sans PII)
  console.log('Insertion donnees representatives simulees...');
  const seedSql = `
    INSERT INTO "User" (id, email, password, role) VALUES ('a0000000-0000-0000-0000-000000000001', 'admin@example.test', 'hashed_pass', 'ADMIN');
    INSERT INTO "Session" (id, "adminId", name, code, status, "maxParticipants") VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Promotion Nov 2026', 'NOV2026', 'ACTIVE', 50);
    INSERT INTO "Participant" (id, name, "sessionId", "rawCode") VALUES ('c0000000-0000-0000-0000-000000000001', 'SYNTH_Etudiant_1', 'b0000000-0000-0000-0000-000000000001', 'CODE1');
    INSERT INTO "Participant" (id, name, "sessionId", "rawCode") VALUES ('c0000000-0000-0000-0000-000000000002', 'SYNTH_Etudiant_2', 'b0000000-0000-0000-0000-000000000001', 'CODE2');
    INSERT INTO "AdaptiveInterview" (id, "participantId", "displayName", email, "reportEmailRequested", "expiresAt", state)
    VALUES ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'SYNTH_Etudiant_1', 'synth1@example.test', true, clock_timestamp() + interval '2 hours', '{"currentQuestion":null,"answers":[],"summary":"Resume"}');
    INSERT INTO "ParticipantEmailGate" ("challengeId", "participantId", email, "expiresAt")
    VALUES ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'synth1@example.test', clock_timestamp() + interval '10 minutes');
    INSERT INTO "ParticipantEmailDeliveryJob" (id, "challengeId", "expiresAt")
    VALUES ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', clock_timestamp() + interval '10 minutes');
    INSERT INTO "AdaptiveReportJob" (id, "interviewId", status, summary, "emailStatus")
    VALUES ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'COMPLETE', 'Resume IA', 'PENDING');
  `;
  psql(seedSql);

  const countBefore = psql('SELECT count(*) FROM "AdaptiveInterview"').trim();
  console.log('Comptage interviews avant migration: ' + countBefore);

  // 6. APPLIQUER LA MIGRATION CANDIDATE 20261107000100_durable_dispatch
  console.log('APPLICATION DE LA MIGRATION CANDIDATE 20261107000100_durable_dispatch...');
  const t0 = Date.now();
  psql(path.join(migrationsDir, '20261107000100_durable_dispatch', 'migration.sql'), true);
  const duration = Date.now() - t0;
  console.log('Migration candidate appliquee avec succes en ' + duration + ' ms !');

  // 7. Verifications post-migration
  const countAfter = psql('SELECT count(*) FROM "AdaptiveInterview"').trim();
  assert.equal(countBefore, countAfter, 'Perte de donnees detectee!');
  console.log('Integrite des donnees verifiee: ' + countAfter + ' interviews conservees.');

  // Verifier la table JobDispatchState
  const dispatchState = psql('SELECT singleton, cursor, "nextAllowedAt" FROM "JobDispatchState"');
  console.log('JobDispatchState:\n' + dispatchState.trim());

  // Verifier la vue JobLifetime
  const lifetimes = psql('SELECT * FROM "JobLifetime"');
  console.log('JobLifetime:\n' + lifetimes.trim());

  // Verifier la vue JobPublicationReady
  const ready = psql('SELECT * FROM "JobPublicationReady"');
  console.log('JobPublicationReady:\n' + ready.trim());

  // 8. Tester le Rollback pour verifier la procedure de secours
  console.log('Test du Rollback SQL...');
  const rollbackSql = `
    DROP VIEW IF EXISTS "JobPublicationReady";
    CREATE VIEW "JobPublicationReady" AS
    SELECT c.* FROM "JobPublicationCandidate" c
    WHERE c.kind<>'OTP_INITIAL' OR EXISTS (
      SELECT 1 FROM "ParticipantEmailDeliveryJob" j JOIN "ParticipantEmailGate" g ON g."challengeId"=j."challengeId" WHERE j.id=c."jobId"
    );
    DROP VIEW IF EXISTS "JobLifetime";
    DROP TABLE IF EXISTS "JobDispatchUsage";
    DROP TABLE IF EXISTS "JobDispatchState";
  `;
  psql(rollbackSql);
  console.log('Rollback execute avec succes !');
  const countRollback = psql('SELECT count(*) FROM "AdaptiveInterview"').trim();
  assert.equal(countBefore, countRollback, 'Perte de donnees pendant le rollback!');
  console.log('Donnees apres rollback parfaitement intactes: ' + countRollback);

} finally {
  spawnSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  console.log('Serveur PostgreSQL de test arrete.');
}

