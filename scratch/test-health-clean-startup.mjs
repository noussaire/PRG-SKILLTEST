/**
 * Test de démarrage propre du nouveau backend et vérification du Health Check
 * SANS clés réelles QStash / Brevo / Groq
 */
import net from 'node:net';

// 1. Assurer que TOUTES les clés fournisseurs sont ABSENTES de l'environnement
delete process.env.BREVO_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.QSTASH_TOKEN;
delete process.env.QSTASH_CURRENT_SIGNING_KEY;
delete process.env.QSTASH_NEXT_SIGNING_KEY;
delete process.env.SKILLQUEST_ALLOW_REAL_BREVO;
delete process.env.SKILLQUEST_ALLOW_REAL_GROQ;
delete process.env.SKILLQUEST_ALLOW_REAL_QSTASH;

// Variables minimales obligatoires
process.env.NODE_ENV = 'production';
process.env.PORT = '3001';
process.env.DATABASE_URL = 'postgresql://dummy:dummy@127.0.0.1:5432/dummy';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SKILLQUEST_PROXY_HMAC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SKILLQUEST_EDGE_HMAC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JOIN_CODE_PEPPER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JOIN_CODE_PEPPER_PREVIOUS = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.OTP_ENCRYPTION_KEYS = JSON.stringify({ 'v1': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
process.env.SKILLQUEST_MAINTENANCE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

console.log('=== TEST DÉMARRAGE NOUVEAU BACKEND SANS FOURNISSEURS RÉELS ===');

try {
  // Importer l'application Express
  const { app } = await import('../backend/src/app.ts');
  console.log('✓ Application Express instanciée avec succès (zéro exception au chargement)');

  // Démarrer sur un port éphémère
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  console.log(`✓ Serveur en écoute sur 127.0.0.1:${port}`);

  // Requêter /api/v1/health
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  const body = await res.json();
  console.log(`✓ Réponse HTTP ${res.status}:`, JSON.stringify(body));

  // Vérifier la conformité de la réponse
  if (res.status === 200 || res.status === 503) {
    console.log('✓ Health check répond correctement (format JSON conforme, aucune dépendance externe requise)');
  } else {
    throw new Error(`Statut inattendu: ${res.status}`);
  }

  // Fermer le serveur
  await new Promise(r => server.close(r));
  console.log('✓ Serveur arrêté proprement.');
  console.log('\n✅ VERDICT : PASS — Le backend démarre et répond au health check de manière totalement autonome sans clés tierces.');
} catch (err) {
  console.error('❌ ERREUR :', err);
  process.exit(1);
}
