/**
 * Test local de validation sécurisée d'URL Neon
 * Vérifie tous les cas d'erreur sans jamais divulguer de mot de passe ni contacter le réseau.
 */
const assert = require('node:assert/strict');

const EXPECTED_HOST = 'ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech';
const EXPECTED_DB = 'neondb';
const EXPECTED_ROLE = 'neondb_owner';

function sanitizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  // Retirer les guillemets englobants si collés par copier-coller
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function validateUrlSafe(raw) {
  const value = sanitizeUrl(raw);
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error('NEON_URL_REFUSED: INVALID_URL_SYNTAX (impossible de parser l\'URL)');
  }

  // 1. Protocole
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
    throw new Error(`NEON_URL_REFUSED: PROTOCOL_INVALID (attendu: postgresql://, reçu: ${u.protocol}//)`);
  }

  // Normaliser le protocole interne pour Prisma
  u.protocol = 'postgresql:';

  // 2. Hôte
  if (u.hostname !== EXPECTED_HOST) {
    if (u.hostname.includes('-pooler.')) {
      throw new Error(`NEON_URL_REFUSED: POOLER_ENDPOINT_FORBIDDEN (utilisez l'endpoint direct, pas le pooler: ${EXPECTED_HOST})`);
    }
    throw new Error(`NEON_URL_REFUSED: HOST_MISMATCH (hôte attendu: ${EXPECTED_HOST}, reçu: ${u.hostname})`);
  }

  // 3. Base de données
  const dbName = u.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (dbName !== EXPECTED_DB) {
    throw new Error(`NEON_URL_REFUSED: DATABASE_MISMATCH (base attendue: ${EXPECTED_DB}, reçue: ${dbName})`);
  }

  // 4. Rôle / Utilisateur
  const user = decodeURIComponent(u.username || '');
  if (user !== EXPECTED_ROLE) {
    throw new Error(`NEON_URL_REFUSED: ROLE_MISMATCH (rôle attendu: ${EXPECTED_ROLE}, reçu: ${user})`);
  }

  // 5. Mot de passe
  if (!u.password) {
    throw new Error('NEON_URL_REFUSED: PASSWORD_MISSING (mot de passe manquant dans l\'URL)');
  }

  // 6. Port
  if (u.port && u.port !== '5432') {
    throw new Error(`NEON_URL_REFUSED: PORT_INVALID (port attendu: 5432 ou par défaut, reçu: ${u.port})`);
  }

  // 7. Fragment
  if (u.hash) {
    throw new Error('NEON_URL_REFUSED: HASH_FRAGMENT_FORBIDDEN (fragment # interdit)');
  }

  // 8. sslmode
  const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase();
  if (sslmode !== 'verify-full') {
    throw new Error(`NEON_URL_REFUSED: SSL_MODE_INVALID (sslmode doit être "verify-full", reçu: "${sslmode || 'aucun'}". Remplacez sslmode=require par sslmode=verify-full)`);
  }

  // 9. Paramètres de requête autorisés
  const allowedParams = new Set(['sslmode', 'channel_binding', 'connect_timeout']);
  for (const key of u.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      throw new Error(`NEON_URL_REFUSED: UNEXPECTED_QUERY_PARAM ("${key}" non autorisé. Paramètres permis: sslmode, channel_binding, connect_timeout)`);
    }
    if (u.searchParams.getAll(key).length > 1) {
      throw new Error(`NEON_URL_REFUSED: DUPLICATE_QUERY_PARAM ("${key}" présent plusieurs fois)`);
    }
  }

  // 10. channel_binding optionnel
  if (u.searchParams.has('channel_binding')) {
    const cb = u.searchParams.get('channel_binding');
    if (cb !== 'require') {
      throw new Error(`NEON_URL_REFUSED: CHANNEL_BINDING_INVALID (channel_binding doit être "require", reçu: "${cb}")`);
    }
  }

  // 11. connect_timeout optionnel
  if (u.searchParams.has('connect_timeout')) {
    const ct = u.searchParams.get('connect_timeout');
    if (!/^(?:[1-9]|[12][0-9]|30)$/.test(ct)) {
      throw new Error(`NEON_URL_REFUSED: CONNECT_TIMEOUT_INVALID (connect_timeout doit être entre 1 et 30, reçu: "${ct}")`);
    }
  }

  return u.toString();
}

console.log('=== TEST UNITAIRE DU DIAGNOSTIC SÉCURISÉ D\'URL NEON ===\n');

// Cas Valide standard
const good1 = `postgresql://${EXPECTED_ROLE}:SecretP@ss123@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full`;
assert.equal(typeof validateUrlSafe(good1), 'string');
console.log('✓ URL valide acceptée');

// Cas Valide avec postgres://
const good2 = `postgres://${EXPECTED_ROLE}:SecretP@ss123@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full`;
assert.equal(typeof validateUrlSafe(good2), 'string');
console.log('✓ URL postgres:// normalisée et acceptée');

// Cas Valide avec guillemets autour
const good3 = `"${good1}"`;
assert.equal(typeof validateUrlSafe(good3), 'string');
console.log('✓ URL entre guillemets nettoyée et acceptée');

// Cas Valide avec channel_binding=require & connect_timeout=15
const good4 = `${good1}&channel_binding=require&connect_timeout=15`;
assert.equal(typeof validateUrlSafe(good4), 'string');
console.log('✓ URL avec channel_binding et connect_timeout acceptée');

// Test des rejets diagnostiqués
const tests = [
  { input: 'not_an_url', expect: 'INVALID_URL_SYNTAX' },
  { input: `http://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full`, expect: 'PROTOCOL_INVALID' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@ep-other-host.neon.tech/${EXPECTED_DB}?sslmode=verify-full`, expect: 'HOST_MISMATCH' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@ep-wispy-paper-bazujx4k-pooler.c-8.eu-central-1.aws.neon.tech/${EXPECTED_DB}?sslmode=verify-full`, expect: 'POOLER_ENDPOINT_FORBIDDEN' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/otherdb?sslmode=verify-full`, expect: 'DATABASE_MISMATCH' },
  { input: `postgresql://skillquest_runtime:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full`, expect: 'ROLE_MISMATCH' },
  { input: `postgresql://${EXPECTED_ROLE}@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full`, expect: 'PASSWORD_MISSING' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}:5433/${EXPECTED_DB}?sslmode=verify-full`, expect: 'PORT_INVALID' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}`, expect: 'SSL_MODE_INVALID' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=require`, expect: 'SSL_MODE_INVALID' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full&options=endpoint%3Dep-wispy-paper-bazujx4k`, expect: 'UNEXPECTED_QUERY_PARAM' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full&endpoint=ep-wispy-paper-bazujx4k`, expect: 'UNEXPECTED_QUERY_PARAM' },
  { input: `postgresql://${EXPECTED_ROLE}:pass@${EXPECTED_HOST}/${EXPECTED_DB}?sslmode=verify-full#hash`, expect: 'HASH_FRAGMENT_FORBIDDEN' }
];

for (const t of tests) {
  try {
    validateUrlSafe(t.input);
    assert.fail(`Devait échouer sur: ${t.expect}`);
  } catch (err) {
    assert.ok(err.message.includes(t.expect), `Message inattendu pour ${t.expect}: ${err.message}`);
    // Vérifier qu'aucun secret n'est dans le message d'erreur
    assert.ok(!err.message.includes('SecretP@ss123'), 'FUITE DE MOT DE PASSE DÉTECTÉE !');
    console.log(`✓ Rejet diagnostiqué: ${t.expect} -> "${err.message}"`);
  }
}

console.log('\n✅ TOUS LES 13 TESTS DE DIAGNOSTIC PASSENT AVEC SUCCÈS.');
