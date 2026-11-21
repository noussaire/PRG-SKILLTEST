/**
 * SkillQuest — Script sécurisé de contrôle et migration Neon assessmentId optionnel
 * 
 * Garde-fous stricts :
 * 1. Hôte exact : ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech
 * 2. Base exacte : neondb
 * 3. Rôle exact : neondb_owner (skillquest_runtime strictement refusé)
 * 4. TLS exact : sslmode=verify-full
 * 5. Précontrôles : 20 migrations précédentes ordonnées et saines, marqueur synthétique, admin
 * 6. Migration unique : 20261105020000_session_assessment_optional (seule migration autorisée)
 * 7. Post-contrôles : colonne assessmentId nullable (is_nullable = 'YES'), clé étrangère préservée, suivi _prisma_migrations
 * 8. Protection secrets : aucun secret ni fragment sensible dans les logs ou exceptions
 */

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXACT_NEON_HOST = 'ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech';
const EXACT_DATABASE = 'neondb';
const REQUIRED_ROLE = 'neondb_owner';
const FORBIDDEN_ROLE = 'skillquest_runtime';
const TARGET_MIGRATION = '20261105020000_session_assessment_optional';

const EXPECTED_20_MIGRATIONS = [
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
  '20261102000100_synthetic_staging',
  '20261103010000_session_adaptive_link'
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

  const isNeonHost = host.includes('neon.tech');
  const isLocalLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const isLocalMock = process.env.ALLOW_LOCAL_MIGRATION_MOCK === 'true' && isLocalLoopback && !isNeonHost;

  console.log('--- 1. VÉRIFICATION DES GARDE-FOUS DE CONNEXION ---');

  if (!isLocalMock) {
    if (host !== EXACT_NEON_HOST) {
      safeError(`L'hôte distant ne correspond pas exactement à l'endpoint Neon autorisé (${EXACT_NEON_HOST}).`);
    }

    if (databaseName !== EXACT_DATABASE) {
      safeError(`La base de données doit être exactement "${EXACT_DATABASE}" (reçu: "${databaseName}").`);
    }

    if (username === FORBIDDEN_ROLE) {
      safeError(`Le rôle d'exécution "${FORBIDDEN_ROLE}" est strictement interdit pour les migrations DDL.`);
    }
    if (username !== REQUIRED_ROLE) {
      safeError(`Seul le rôle propriétaire "${REQUIRED_ROLE}" est autorisé pour appliquer les migrations (reçu: "${username}").`);
    }

    if (sslmode !== 'verify-full') {
      safeError(`Le mode SSL doit être exactement "sslmode=verify-full" pour garantir la validation du certificat TLS (reçu: "${sslmode || 'aucun'}").`);
    }
  }

  console.log(`[OK] Hôte vérifié: ${host}`);
  console.log(`[OK] Base vérifiée: ${databaseName}`);
  console.log(`[OK] Rôle vérifié: ${username || 'local-test'}`);
  console.log(`[OK] SSL vérifié: ${sslmode || 'local-disabled'}`);

  process.env.DATABASE_URL = connectionUrl;
  process.env.DIRECT_URL = connectionUrl;

  const prisma = new PrismaClient({
    datasources: { db: { url: connectionUrl } },
  });

  try {
    console.log('\n--- 2. PRÉCONTRÔLES STRICTS DES MIGRATIONS & DONNÉES ---');

    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('[OK] Connectivité base de données confirmée.');

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

    const failedMigration = recordedMigrations.find(m => m.rolled_back_at !== null || m.finished_at === null);
    if (failedMigration) {
      safeError(`Une migration en échec existe dans la base (${failedMigration.migration_name}). Résolution manuelle requise avant toute action.`);
    }

    if (recordedMigrations.length < EXPECTED_20_MIGRATIONS.length) {
      safeError(`Nombre de migrations insuffisant dans _prisma_migrations (${recordedMigrations.length} trouvées, ${EXPECTED_20_MIGRATIONS.length} attendues).`);
    }

    for (let i = 0; i < EXPECTED_20_MIGRATIONS.length; i++) {
      const expectedName = EXPECTED_20_MIGRATIONS[i];
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
    console.log(`[OK] Les 20 migrations précédentes sont rigoureusement conformes, terminées et intègres.`);

    const localMigrations = getLocalMigrationList();
    const expectedLocal = [...EXPECTED_20_MIGRATIONS, TARGET_MIGRATION];
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
      if (recordedMigrations.length !== EXPECTED_20_MIGRATIONS.length) {
        safeError(`Des migrations inattendues existent dans _prisma_migrations (${recordedMigrations.length} enregistrements).`);
      }
      console.log(`[OK] La seule et unique migration en attente est: ${TARGET_MIGRATION}`);
    }

    const [synthRow] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "SyntheticStagingInstallation"`
    );
    if (!synthRow || synthRow.count < 1) {
      safeError('Marqueur synthétique absent dans SyntheticStagingInstallation.');
    }
    console.log(`[OK] Marqueur synthétique validé (${synthRow.count} enregistrement).`);

    const [adminRow] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "User" WHERE role = 'ADMIN'`
    );
    if (!adminRow || adminRow.count < 1) {
      safeError('Aucun administrateur trouvé dans la table User.');
    }
    console.log(`[OK] Compte administrateur validé (${adminRow.count} compte(s)).`);

    const [colBefore] = await prisma.$queryRawUnsafe(
      `SELECT is_nullable FROM information_schema.columns 
       WHERE table_name = 'AssessmentSession' AND column_name = 'assessmentId'`
    );
    console.log(`[INFO] État colonne AssessmentSession.assessmentId avant migration: is_nullable=${colBefore?.is_nullable || 'INCONNUE'}`);

    // Sauvegarde du nombre initial de sessions pour vérifier l'intégrité
    const [sessionsBefore] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "AssessmentSession"`
    );
    console.log(`[INFO] Sessions existantes en base: ${sessionsBefore.count}`);

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

    // 1. Colonne assessmentId (UUID, NULLABLE)
    const colRows = await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable 
       FROM information_schema.columns 
       WHERE table_name = 'AssessmentSession' AND column_name = 'assessmentId'`
    );
    if (!colRows.length) {
      safeError('La colonne assessmentId est introuvable sur AssessmentSession.');
    }
    if (colRows[0].data_type !== 'uuid' || colRows[0].is_nullable !== 'YES') {
      safeError(`Propriétés de la colonne assessmentId non conformes (type: ${colRows[0].data_type}, nullable: ${colRows[0].is_nullable}). Attendu: uuid, YES.`);
    }
    console.log(`[OK] Colonne vérifiée: AssessmentSession.assessmentId (type: ${colRows[0].data_type}, is_nullable: ${colRows[0].is_nullable})`);

    // 2. Préservation de la contrainte de clé étrangère vers Assessment
    const fkRows = await prisma.$queryRawUnsafe(
      `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name 
       FROM information_schema.table_constraints AS tc 
       JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name 
       JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name 
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'AssessmentSession' AND kcu.column_name = 'assessmentId'`
    );
    if (!fkRows.length) {
      safeError('La contrainte de clé étrangère vers Assessment a disparu !');
    }
    console.log(`[OK] Contrainte clé étrangère préservée: ${fkRows[0].constraint_name} -> ${fkRows[0].foreign_table_name}(${fkRows[0].foreign_column_name})`);

    // 3. Intégrité des sessions existantes
    const [sessionsAfter] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as count FROM "AssessmentSession"`
    );
    if (sessionsAfter.count !== sessionsBefore.count) {
      safeError(`Incohérence du nombre de sessions (${sessionsAfter.count} après vs ${sessionsBefore.count} avant) !`);
    }
    console.log(`[OK] Intégrité des données confirmée : ${sessionsAfter.count} session(s) préservée(s) intacte(s).`);

    // 4. Suivi officiel _prisma_migrations
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

    console.log('\n=============================================================');
    console.log('  SUCCÈS: MIGRATION APPLIQUÉE ET VALIDÉE SANS AUCUNE ANOMALIE');
    console.log('=============================================================');

  } catch (error) {
    safeError('Erreur d\'exécution', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { run, sanitize, EXPECTED_20_MIGRATIONS, EXACT_NEON_HOST, EXACT_DATABASE, REQUIRED_ROLE, TARGET_MIGRATION };
if (require.main === module) {
  run();
}
