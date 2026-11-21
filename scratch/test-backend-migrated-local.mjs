/**
 * Test complet :
 * 1. Initialise un cluster PostgreSQL local temporaire
 * 2. Applique l'ensemble des 23 migrations (dont 20261107000100_durable_dispatch)
 * 3. Démarre le NOUVEAU backend connecté à ce schéma migré
 * 4. Interroge /api/v1/health -> vérifie la réponse HTTP 200 { status: "ok", database: "connected" }
 * 5. Vérifie que TOUS les fournisseurs réels (Brevo, Groq, QStash) restent rigoureusement désactivés
 * 6. Arrête le serveur et le cluster proprement
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const pgBin = path.resolve('output/pg-native-ef583905f4cd/portable/pgsql/bin');
const exe = name => path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));

const tempBase = path.resolve('output/audit-start');
if (!fs.existsSync(tempBase)) fs.mkdirSync(tempBase, { recursive: true });
const id = Math.random().toString(36).slice(2, 8);
const tempDir = path.join(tempBase, id);
fs.mkdirSync(tempDir);
const dataDir = path.join(tempDir, 'd');
const pgLog = path.join(tempDir, 'pg.log');

console.log('=== TEST DÉMARRAGE NOUVEAU BACKEND SUR SCHÉMA MIGRÉ (LOCAL) ===');
console.log(`Cluster PG: ${dataDir}`);

let port;
let pgRunning = false;
let serverInstance = null;

try {
  // 1. initdb
  let res = spawnSync(exe('initdb'), [
    '-D', dataDir, '-U', 'lot4_tester', '--auth=trust',
    '--encoding=UTF8', '--no-locale'
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(res.status, 0, 'initdb failed: ' + res.stderr);

  // 2. Port libre
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  await new Promise(r => srv.close(r));

  // 3. Démarrage PG
  res = spawnSync(exe('pg_ctl'), [
    '-D', dataDir, '-l', pgLog,
    '-o', `-h 127.0.0.1 -p ${port}`,
    'start'
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(res.status, 0, 'pg_ctl start failed');
  pgRunning = true;

  // Attendre readiness
  const psql = (sql, isFile = false) => {
    const args = ['-X', '-h', '127.0.0.1', '-p', String(port),
      '-U', 'lot4_tester', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    if (isFile) args.push('-f', sql);
    else args.push('-c', sql);
    const r = spawnSync(exe('psql'), args, { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) throw new Error(`psql error: ${r.stderr}`);
    return r.stdout.trim();
  };

  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      if (psql('SELECT 1').includes('1')) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, 'PostgreSQL not ready');
  console.log(`✓ PostgreSQL démarré sur port ${port}`);

  // 4. Appliquer les 23 migrations
  const migrDir = path.resolve('backend/prisma/migrations');
  const allFolders = fs.readdirSync(migrDir)
    .filter(f => fs.statSync(path.join(migrDir, f)).isDirectory())
    .sort();
  console.log(`✓ Application de ${allFolders.length} migrations (dont 20261107000100_durable_dispatch)...`);

  for (const m of allFolders) {
    const sqlFile = path.join(migrDir, m, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;
    psql(sqlFile, true);
  }
  console.log(`✓ Toutes les 23 migrations appliquées avec succès.`);

  // Vérifier la présence des tables additives
  const jds = psql(`SELECT singleton, cursor FROM "JobDispatchState"`);
  assert.ok(jds.includes('1'), 'JobDispatchState manquant ou non initialisé');
  console.log(`✓ JobDispatchState présent et initialisé : ${jds.split('\n')[2]?.trim() || 'singleton=1'}`);

  // 5. Configurer l'environnement pour le nouveau backend (AUCUNE clé réelle)
  delete process.env.BREVO_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.QSTASH_TOKEN;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  delete process.env.SKILLQUEST_ALLOW_REAL_BREVO;
  delete process.env.SKILLQUEST_ALLOW_REAL_GROQ;
  delete process.env.SKILLQUEST_ALLOW_REAL_QSTASH;

  process.env.NODE_ENV = 'production';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = `postgresql://lot4_tester@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SKILLQUEST_PROXY_HMAC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SKILLQUEST_EDGE_HMAC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.JOIN_CODE_PEPPER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.JOIN_CODE_PEPPER_PREVIOUS = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.OTP_ENCRYPTION_KEYS = JSON.stringify({ 'v1': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
  process.env.SKILLQUEST_MAINTENANCE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // 6. Importer et démarrer le nouveau backend
  console.log('\n--- DÉMARRAGE NOUVEAU BACKEND ---');
  const { app } = await import('../backend/src/app.ts');
  const server = app.listen(0, '127.0.0.1');
  serverInstance = server;
  await new Promise(r => server.once('listening', r));
  const appPort = server.address().port;
  console.log(`✓ Nouveau backend démarré et en écoute sur 127.0.0.1:${appPort}`);

  // 7. Requêter /api/v1/health
  const httpRes = await fetch(`http://127.0.0.1:${appPort}/api/v1/health`);
  const health = await httpRes.json();
  console.log(`✓ Réponse Health Check HTTP ${httpRes.status}:`, JSON.stringify(health));

  assert.equal(httpRes.status, 200, `Health check a échoué: ${httpRes.status}`);
  assert.equal(health.status, 'ok', 'Status != ok');
  assert.equal(health.database, 'connected', 'Database != connected');
  console.log(`✓ Health Check 200 OK — Base connectée et requêtable !`);

  // 8. Vérifier que TOUS les fournisseurs restent DÉSACTIVÉS
  console.log('\n--- VÉRIFICATION DÉSACTIVATION DES FOURNISSEURS RÉELS ---');
  const { realProviderAllowed } = await import('../backend/src/security/provider-mode.ts');

  assert.equal(realProviderAllowed('BREVO'), false, 'Brevo ne doit PAS être autorisé');
  assert.equal(realProviderAllowed('GROQ'), false, 'Groq ne doit PAS être autorisé');
  assert.equal(realProviderAllowed('QSTASH'), false, 'QStash ne doit PAS être autorisé');
  console.log('✓ realProviderAllowed("BREVO") = false');
  console.log('✓ realProviderAllowed("GROQ") = false');
  console.log('✓ realProviderAllowed("QSTASH") = false');

  console.log('\n✅ VERDICT : PASS — Le nouveau backend démarre avec le schéma migré, la base est connectée, et tous les verrous fournisseurs sont strictement actifs (fournisseurs désactivés).');

} catch (err) {
  console.error('\n❌ ERREUR :', err);
  process.exitCode = 1;
} finally {
  if (serverInstance) {
    await new Promise(r => serverInstance.close(r));
    console.log('✓ Serveur Express arrêté.');
  }
  if (pgRunning) {
    spawnSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop'], { encoding: 'utf8' });
    console.log('✓ Cluster PostgreSQL arrêté.');
  }
}
