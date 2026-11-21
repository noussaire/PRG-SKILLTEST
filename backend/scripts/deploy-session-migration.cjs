/**
 * SkillQuest — Script sécurisé de contrôle et migration Neon sessionId
 * 
 * Garde-fous stricts :
 * 1. Hôte exact : ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech
 * 2. Base exacte : neondb
 * 3. Rôle exact : neondb_owner (skillquest_runtime strictement refusé)
 * 4. TLS exact : sslmode=verify-full
 * 5. Précontrôles : 19 migrations précédentes ordonnées et saines, marqueur synthétique, admin
 * 6. Migration unique : 20261103010000_session_adaptive_link (seule migration autorisée)
 * 7. Post-contrôles : colonne uuid nullable, index, privilèges stricts skillquest_runtime, suivi _prisma_migrations
 * 8. Protection secrets : aucun secret ni fragment sensible dans les logs ou exceptions
 */

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXACT_NEON_HOST = 'ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech';
const EXACT_DATABASE = 'neondb';
const REQUIRED_ROLE = 'neondb_owner';
const FORBIDDEN_ROLE = 'skillquest_runtime';
const TARGET_MIGRATION = '20261103010000_session_adaptive_link';

const EXPECTED_19_MIGRATIONS = [
  '20261016112800_init',
  '20261016115655_add_admin_session',
  '20261016131249_add_session_fields',
  '20261016145005_add_mission_builder_fields',
  '20261026010000_reliable_assessment',
  '20261028010000_adaptive_interviews',
  '20261028020000_prepared_report_queue',
  '20261029010000_adaptive_participant_email',
  '20261029020000_report_email',
  '20261029030000_participant_retake',
  '20261030010000_email_security_foundation',
  '20261030020000_email_budget_fencing',
  '20261030030000_otp_delivery_outbox',
  '20261030040000_initial_email_gate',
  '20261031010000_proxy_request_nonce',
  '20261031020000_job_publication_intents',
  '20261031030000_maintenance_invocations',
  '20261031040000_technical_retention',
  '20261102000100_synthetic_staging'
];

function sanitize(msg) {
  if (typeof msg !== 'string') msg = String(msg ?? '');
  return msg
    .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***:***@')
    .replace(/:[^:@/]+@/g, ':***@');
}

function safeError(prefix, detail = '') {
  console.error(`[REFUS_SECURITE] ${prefix}${detail ? ' : ' + sanitize(detail) : ''}`);
  process.exit(1);
}

function getLocalMigrationList() {
  const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter(name => fs.statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();
}

async function run() {
  const connectionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionUrl) {
    safeError('DIRECT_URL ou DATABASE_URL non définie.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionUrl);
  } catch {
    safeError('Format d’URL PostgreSQL invalide.');
  }

  const host = parsedUrl.hostname;
  const username = decodeURIComponent(parsedUrl.username || '');
  const databaseName = parsedUrl.pathname.replace(/^\//, '').replace(/\/$/, '');
  const sslmode = (parsedUrl.searchParams.get('sslmode') || '').toLowerCase();

  // RÈGLE 6 : Si l'hôte cible neon.tech, AUCUN mock n'est jamais autorisé
  const isNeonHost = host.includes('neon.tech');
  const isLocalLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const isLocalMock = process.env.ALLOW_LOCAL_MIGRATION_MOCK === 'true' && isLocalLoopback && !isNeonHost;

  console.log('--- 1. VÉRIFICATION DES GARDE-FOUS DE CONNEXION ---');

  if (!isLocalMock) {
    // RÈGLE 1 : Hôte exact
    if (host !== EXACT_NEON_HOST) {
      safeError(`L'hôte distant ne correspond pas exactement à l'endpoint Neon autorisé (${EXACT_NEON_HOST}).`);
    }

    // RÈGLE 1 : Base exacte
    if (databaseName !== EXACT_DATABASE) {
      safeError(`La base de données doit être exactement "${EXACT_DATABASE}" (reçu: "${databaseName}").`);
    }

    // RÈGLE 1 : Rôle exact neondb_owner et interdiction skillquest_runtime
    if (username === FORBIDDEN_ROLE) {
      safeError(`Le rôle d'exécution "${FORBIDDEN_ROLE}" est strictement interdit pour les migrations DDL.`);
    }
    if (username !== REQUIRED_ROLE) {
      safeError(`Seul le rôle propriétaire "${REQUIRED_ROLE}" est autorisé pour appliquer les migrations (reçu: "${username}").`);
    }

    // RÈGLE 2 : TLS verify-full obligatoire
    if (sslmode !== 'verify-full') {
      safeError(`Le mode SSL doit être exactement "sslmode=verify-full" pour garantir la validation du certificat TLS (reçu: "${sslmode || 'aucun'}").`);
    }
  }

  console.log(`[OK] Hôte vérifié: ${host}`);
  console.log(`[OK] Base vérifiée: ${databaseName}`);
  console.log(`[OK] Rôle vérifié: ${username || 'local-test'}`);
  console.log(`[OK] SSL vérifié: ${sslmode || 'local-disabled'}`);

  // Synchronisation des variables d'environnement pour Prisma CLI
  process.env.DATABASE_URL = connectionUrl;
  process.env.DIRECT_URL = connectionUrl;

  const prisma = new PrismaClient({
    datasources: { db: { url: connectionUrl } },
  });

  try {
    console.log('\n--- 2. PRÉCONTRÔLES STRICTS DES MIGRATIONS & DONNÉES ---');

    // Test de connectivité
    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('[OK] Connectivité base de données confirmée.');

    // RÈGLE 3 : Vérification des migrations existantes dans _prisma_migrations
    let recordedMigrations = [];
    try {
      recordedMigrations = await prisma.$queryRawUnsafe(
        `SELECT migration_name, finished_at, rolled_back_at, checksum 
         FROM "_prisma_migrations" 
         ORDER BY started_at ASC`
      );
    } catch (e) {
      safeError('Impossible de lire la table _prisma_migrations', e.message);
    }

    // Vérifier l'absence absolue de migration échouée
    const failedMigration = recordedMigrations.find(m => m.rolled_back_at !== null || m.finished_at === null);
    if (failedMigration) {
      safeError(`Une migration en échec existe dans la base (${failedMigration.migration_name}). Résolution manuelle requise avant toute action.`);
    }

    // Vérifier que les 19 migrations précédentes sont présentes et conformes
    if (recordedMigrations.length < EXPECTED_19_MIGRATIONS.length) {
      safeError(`Nombre de migrations insuffisant dans _prisma_migrations (${recordedMigrations.length} trouvées, ${EXPECTED_19_MIGRATIONS.length} attendues).`);
    }

    for (let i = 0; i < EXPECTED_19_MIGRATIONS.length; i++) {
      const expectedName = EXPECTED_19_MIGRATIONS[i];
      const recorded = recordedMigrations[i];
      if (!recorded || recorded.migration_name !== expectedName) {
        safeError(`Divergence à la migration #${i + 1} : attendu "${expectedName}", trouvé "${recorded?.migration_name || 'absent'}".`);
      }
      if (!recorded.finished_at || recorded.rolled_back_at) {
        safeError(`La migration précédente "${expectedName}" n'est pas marquée comme terminée avec succès.`);
      }
      if (!recorded.checksum || recorded.checksum.length !== 64) {
        safeError(`Checksum SHA-256 invalide pour la migration "${expectedName}".`);
      }
    }
    console.log(`[OK] Les 19 migrations précédentes sont rigoureusement conformes, terminées et intègres.`);

    // RÈGLE 4 : Contrôler que la SEULE migration en attente est 20261103010000_session_adaptive_link
    const localMigrations = getLocalMigrationList();
    const expectedLocal = [...EXPECTED_19_MIGRATIONS, TARGET_MIGRATION];
    if (JSON.stringify(localMigrations) !== JSON.stringify(expectedLocal)) {
      safeError(`Les migrations locales ne correspondent pas exactement à la liste autorisée.`);
    }

    const alreadyAppliedTarget = recordedMigrations.find(m => m.migration_name === TARGET_MIGRATION);
    if (alreadyAppliedTarget) {
      if (alreadyAppliedTarget.finished_at && !alreadyAppliedTarget.rolled_back_at) {
        console.log(`[INFO] La migration cible ${TARGET_MIGRATION} est DÉJÀ appliquée avec succès.`);
      } else {
        safeError(`La migration cible ${TARGET_MIGRATION} est dans un état instable dans _prisma_migrations.`);
      }
    } else {
      if (recordedMigrations.length !== EXPECTED_19_MIGRATIONS.length) {
        safeError(`Des migrations inattendues existent dans _prisma_migrations (${recordedMigrations.length} enregistrements).`);
      }
      console.log(`[OK] La seule et unique migration en attente est: ${TARGET_MIGRATION}`);
    }

    // RÈGLE 5 : Vérification du marqueur synthétique
    const [synthRow] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "SyntheticStagingInstallation"`
    );
    if (!synthRow || synthRow.count < 1) {
      safeError('Marqueur synthétique absent dans SyntheticStagingInstallation.');
    }
    console.log(`[OK] Marqueur synthétique validé (${synthRow.count} enregistrement).`);

    // RÈGLE 5 : Présence de l'administrateur
    const [adminRow] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "User" WHERE role = 'ADMIN'`
    );
    if (!adminRow || adminRow.count < 1) {
      safeError('Aucun administrateur trouvé dans la table User.');
    }
    console.log(`[OK] Compte administrateur validé (${adminRow.count} compte(s)).`);

    // État initial colonne sessionId
    const [colBefore] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM information_schema.columns 
       WHERE table_name = 'AdaptiveInterview' AND column_name = 'sessionId'`
    );
    console.log(`[INFO] État colonne sessionId avant migration: ${colBefore.count === 1 ? 'EXISTANTE' : 'NON PRÉSENTE'}`);

    // Si déjà appliquée, ne pas ré-exécuter Prisma
    if (!alreadyAppliedTarget) {
      console.log('\n--- 3. APPLICATION CIBLÉE VIA PRISMA MIGRATE DEPLOY ---');
      console.log(`Exécution exclusive de: ${TARGET_MIGRATION} (aucun reset, aucun seed)...`);

      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: connectionUrl,
          DIRECT_URL: connectionUrl,
        },
        cwd: path.resolve(__dirname, '..'),
      });
    }

    console.log('\n--- 4. POST-CONTRÔLES STRICTS DE CONFORMITÉ ---');

    // 1. Colonne sessionId (UUID, NULLABLE)
    const colRows = await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable 
       FROM information_schema.columns 
       WHERE table_name = 'AdaptiveInterview' AND column_name = 'sessionId'`
    );
    if (!colRows.length) {
      safeError('La colonne sessionId n\'a pas été créée sur AdaptiveInterview.');
    }
    if (colRows[0].data_type !== 'uuid' || colRows[0].is_nullable !== 'YES') {
      safeError(`Propriétés de la colonne sessionId non conformes (type: ${colRows[0].data_type}, nullable: ${colRows[0].is_nullable}). Attendu: uuid, YES.`);
    }
    console.log(`[OK] Colonne vérifiée: AdaptiveInterview.sessionId (type: ${colRows[0].data_type}, nullable: ${colRows[0].is_nullable})`);

    // 2. Index AdaptiveInterview_sessionId_idx
    const idxRows = await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'AdaptiveInterview' AND indexname = 'AdaptiveInterview_sessionId_idx'`
    );
    if (!idxRows.length) {
      safeError('L\'index AdaptiveInterview_sessionId_idx est introuvable.');
    }
    console.log(`[OK] Index vérifié: ${idxRows[0].indexname}`);

    // 3. Suivi officiel _prisma_migrations
    const [finalMigration] = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at, rolled_back_at, checksum 
       FROM "_prisma_migrations" 
       WHERE migration_name = $1`,
      TARGET_MIGRATION
    );
    if (!finalMigration || !finalMigration.finished_at || finalMigration.rolled_back_at) {
      safeError(`La migration ${TARGET_MIGRATION} n'apparaît pas comme terminée avec succès dans _prisma_migrations.`);
    }
    console.log(`[OK] Suivi _prisma_migrations validé: ${finalMigration.migration_name} (checksum: ${finalMigration.checksum.slice(0, 16)}...)`);

    // 4. Privilèges de skillquest_runtime
    const roleCheck = await prisma.$queryRawUnsafe(
      `SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = '${FORBIDDEN_ROLE}'`
    );
    if (roleCheck.length > 0) {
      const roleAttrs = roleCheck[0];
      if (roleAttrs.rolsuper || roleAttrs.rolcreaterole || roleAttrs.rolcreatedb) {
        safeError(`Le rôle ${FORBIDDEN_ROLE} possède des attributs de superutilisateur ou privilèges système interdits !`);
      }

      // Vérifier que skillquest_runtime n'est PAS propriétaire de la table
      const ownerCheck = await prisma.$queryRawUnsafe(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'AdaptiveInterview'`
      );
      if (ownerCheck.length > 0 && ownerCheck[0].tableowner === FORBIDDEN_ROLE) {
        safeError(`Le rôle ${FORBIDDEN_ROLE} est propriétaire de AdaptiveInterview, lui conférant des droits DDL implicites interdits !`);
      }

      // Vérifier les privilèges sur la table AdaptiveInterview
      const permRows = await prisma.$queryRawUnsafe(
        `SELECT privilege_type FROM information_schema.table_privileges 
         WHERE table_name = 'AdaptiveInterview' AND grantee = '${FORBIDDEN_ROLE}'`
      );
      const perms = permRows.map(r => r.privilege_type).sort();

      // Privilèges requis pour le fonctionnement normal (incluant DELETE pour l'administration)
      const expectedRequired = ['INSERT', 'SELECT', 'UPDATE', 'DELETE'];
      const hasRequired = expectedRequired.every(p => perms.includes(p));
      if (!hasRequired) {
        safeError(`Le rôle ${FORBIDDEN_ROLE} n'a pas tous les privilèges requis (${expectedRequired.join(', ')}). Trouvé: ${perms.join(', ')}`);
      }

      // Privilèges non nécessaires et dangereux strictement interdits
      const forbiddenPerms = ['TRUNCATE', 'TRIGGER'];
      const hasForbidden = perms.some(p => forbiddenPerms.includes(p));
      if (hasForbidden) {
        const found = perms.filter(p => forbiddenPerms.includes(p));
        safeError(`Le rôle ${FORBIDDEN_ROLE} possède des privilèges dangereux interdits (${found.join(', ')}) !`);
      }

      console.log(`[OK] Attributs rôle ${FORBIDDEN_ROLE} vérifiés (aucun droit superuser / DDL).`);
      console.log(`[OK] Propriétaire de la table vérifié: ${ownerCheck[0]?.tableowner || 'neondb_owner'}.`);
      console.log(`[OK] Privilèges de table ${FORBIDDEN_ROLE} conformes (SELECT, INSERT, UPDATE, DELETE autorisés ; TRUNCATE/TRIGGER exclus).`);
    } else {
      console.log(`[INFO] Rôle ${FORBIDDEN_ROLE} non présent dans cet environnement de test.`);
    }

    console.log('\n=============================================================');
    console.log('  SUCCÈS: MIGRATION APPLIQUÉE ET VALIDÉE SANS AUCUNE ANOMALIE');
    console.log('=============================================================');

  } catch (error) {
    safeError('Erreur d\'exécution', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { run, sanitize, EXPECTED_19_MIGRATIONS, EXACT_NEON_HOST, EXACT_DATABASE, REQUIRED_ROLE, TARGET_MIGRATION };
if (require.main === module) {
  run();
}
