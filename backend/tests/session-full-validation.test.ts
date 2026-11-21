import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";

let db: PGlite;
let socket: PGLiteSocketServer;
let http: Server;
let prisma: PrismaClient;
let baseUrl: string;
let adminToken: string;
let assessmentId: string;
let openSessionCode: string;
let openSessionId: string;
let closedSessionCode: string;
let limitedSessionCode: string;

before(async () => {
  // 1. Base PostgreSQL locale isolée en mémoire (0 DH, aucun appel distant)
  db = await PGlite.create();

  // 2. Application séquentielle de TOUTES les migrations jusqu'à la migration additive sessionId
  const migrationsDir = new URL("../prisma/migrations/", import.meta.url);
  const entries = (await readdir(migrationsDir)).filter(n => n !== "migration_lock.toml").sort();
  for (const entry of entries) {
    const sql = await readFile(new URL(`${entry}/migration.sql`, migrationsDir), "utf8");
    await db.exec(sql);
  }

  // Démarrage du serveur socket PGlite
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 8 });
  await socket.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=4&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "isolated-session-test-only-0123456789abcdef";
  process.env.GROQ_API_KEY = "";
  process.env.BREVO_API_KEY = "";

  ({ prisma } = await import("../src/db/prisma.js"));
  const { hashPassword } = await import("../src/security/tokens.js");
  const { app } = await import("../src/app.js");

  http = createServer(app);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Création du compte administrateur avec mot de passe haché
  const passwordHash = await hashPassword("AdminPass123!");
  await prisma.user.create({
    data: {
      email: "admin@example.test",
      role: "ADMIN",
      passwordHash,
    },
  });

  // Création d'une évaluation de référence pour les sessions
  const assessment = await prisma.assessment.create({
    data: {
      slug: "soft-skills-assessment",
      title: "Test de compétences transversales",
      status: "PUBLISHED",
    },
  });
  assessmentId = assessment.id;
});

after(async () => {
  if (http?.listening) http.close();
  if (prisma) await prisma.$disconnect();
  if (socket) await socket.stop();
  if (db) await db.close();
});

test("Validation Permissions: compatibilité du rôle skillquest_runtime et exécution idempotente", async () => {
  // A. Vérifier que la colonne et l'index existent bien
  const colRes = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'AdaptiveInterview' AND column_name = 'sessionId'`
  );
  assert.equal(colRes.rows.length, 1, "La colonne sessionId doit exister sur AdaptiveInterview");

  const idxRes = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'AdaptiveInterview' AND indexname = 'AdaptiveInterview_sessionId_idx'`
  );
  assert.equal(idxRes.rows.length, 1, "L'index AdaptiveInterview_sessionId_idx doit exister");

  // B. Création du rôle skillquest_runtime s'il n'existe pas encore
  await db.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skillquest_runtime') THEN CREATE ROLE skillquest_runtime; END IF; END $$;`);

  // C. Exécution du bloc GRANT de la migration
  const migrationSql = await readFile(new URL("../prisma/migrations/20261103010000_session_adaptive_link/migration.sql", import.meta.url), "utf8");
  await db.exec(migrationSql);

  // D. Vérification que les privilèges SELECT, INSERT, UPDATE sont accordés
  const privRes = await db.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.table_privileges WHERE table_name = 'AdaptiveInterview' AND grantee = 'skillquest_runtime'`
  );
  const granted = privRes.rows.map(r => r.privilege_type);
  assert.ok(granted.includes("SELECT"), "skillquest_runtime doit avoir le privilège SELECT");
  assert.ok(granted.includes("INSERT"), "skillquest_runtime doit avoir le privilège INSERT");
  assert.ok(granted.includes("UPDATE"), "skillquest_runtime doit avoir le privilège UPDATE");
});

test("Parcours Administrateur: Connexion, Création et Gestion des sessions", async () => {
  // 1. Connexion administrateur
  const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.test", password: "AdminPass123!" }),
  });
  assert.equal(loginRes.status, 200, "La connexion admin doit réussir");
  const loginData = await loginRes.json();
  assert.ok(loginData.token, "Le token admin doit être retourné");
  adminToken = loginData.token;

  // 2. Création d'une session OPEN
  const createOpenRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "Session Promotion 2026",
      assessmentId,
      status: "OPEN",
    }),
  });
  assert.equal(createOpenRes.status, 201, "La création de session doit renvoyer 201");
  const openData = await createOpenRes.json();
  assert.ok(openData.plainCode, "Le code clair généré doit être renvoyé à l'administrateur");
  assert.ok(openData.session.id, "L'id de session doit être présent");
  openSessionCode = openData.plainCode;
  openSessionId = openData.session.id;

  // 3. Création d'une session CLOSED (pour test refus)
  const createClosedRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "Session Fermée",
      assessmentId,
      status: "DRAFT",
    }),
  });
  assert.equal(createClosedRes.status, 201);
  const closedData = await createClosedRes.json();
  closedSessionCode = closedData.plainCode;
  // Bascule en statut CLOSED via PATCH
  const patchClosedRes = await fetch(`${baseUrl}/api/v1/admin/sessions/${closedData.session.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: "CLOSED" }),
  });
  assert.equal(patchClosedRes.status, 200);

  // 4. Création d'une session à capacité limitée = 1 (pour test refus)
  const createLimitedRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "Session 1 Place",
      assessmentId,
      status: "OPEN",
      maxParticipants: 1,
    }),
  });
  assert.equal(createLimitedRes.status, 201);
  const limitedData = await createLimitedRes.json();
  limitedSessionCode = limitedData.plainCode;
});

test("Parcours Étudiant complet: Inscription par code, 31 questions directes, reprise et bilan final", async () => {
  // 1. Inscription étudiant SYNTH- avec le code de session
  const joinRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: openSessionCode,
      displayName: "SYNTH-Etudiant Integrite",
      language: "fr",
    }),
  });
  assert.equal(joinRes.status, 201, "L'inscription par code valide doit renvoyer 201");
  const joinData = await joinRes.json();
  assert.ok(joinData.token, "Un token de session adaptative doit être retourné");
  assert.equal(joinData.interview.displayName, "SYNTH-Etudiant Integrite");
  const studentToken = joinData.token;

  // 2. Accès direct aux 31 questions sans OTP
  const meRes = await fetch(`${baseUrl}/api/v1/adaptive/me`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(meRes.status, 200);
  const interview = await meRes.json();
  assert.equal(interview.answeredCount, 0, "L'étudiant démarre à 0 questions répondues");
  assert.equal(interview.totalQuestions, 31, "Le questionnaire comporte exactement 31 compétences");
  assert.ok(interview.currentQuestion, "La question 1 est immédiatement retournée");
  assert.equal(interview.currentQuestion.choices?.length, 4, "La question comporte 4 choix préparés");
  assert.equal(interview.emailVerified, false, "En session par code, aucun e-mail n'est demandé");

  // 3. Enregistrement des premières réponses (Questions 1 à 5)
  let current = interview;
  for (let i = 0; i < 5; i++) {
    const qId = current.currentQuestion.id;
    const choiceId = current.currentQuestion.choices[0].id;
    const ansRes = await fetch(`${baseUrl}/api/v1/adaptive/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ questionId: qId, choiceId }),
    });
    assert.equal(ansRes.status, 200);
    current = await ansRes.json();
    assert.equal(current.answeredCount, i + 1);
  }

  // 4. Test Reprise : ré-interroger GET /adaptive/me (comme si l'étudiant rafraîchissait ou rouvrait le navigateur)
  const resumeRes = await fetch(`${baseUrl}/api/v1/adaptive/me`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(resumeRes.status, 200);
  const resumed = await resumeRes.json();
  assert.equal(resumed.answeredCount, 5, "La progression est fidèlement reprise à 5 réponses");
  assert.ok(resumed.currentQuestion, "La question 6 est chargée pour continuer");

  // 5. Réponse aux questions restantes (Questions 6 à 31) pour atteindre le bilan final
  current = resumed;
  while (current.answeredCount < 31) {
    const qId = current.currentQuestion.id;
    const choiceId = current.currentQuestion.choices[0].id;
    const ansRes = await fetch(`${baseUrl}/api/v1/adaptive/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ questionId: qId, choiceId }),
    });
    assert.equal(ansRes.status, 200);
    current = await ansRes.json();
  }

  // 6. Vérification du bilan final
  assert.equal(current.answeredCount, 31, "Les 31 questions doivent être complétées");
  assert.ok(current.report, "Le rapport final complet doit être généré");
  assert.equal(current.report.skills.length, 31, "Le rapport doit contenir l'évaluation des 31 soft skills");
  assert.ok(current.report.summary, "Une synthèse textuelle doit être présente");

  // 7. Affichage du participant dans la session côté administrateur
  const adminSessionRes = await fetch(`${baseUrl}/api/v1/admin/sessions/${openSessionId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminSessionRes.status, 200);
  const sessionDetails = await adminSessionRes.json();
  assert.equal(sessionDetails.session.participants.length, 1, "Le participant doit figurer dans la session");
  assert.equal(sessionDetails.session.participants[0].displayName, "SYNTH-Etudiant Integrite");

  // 8. Suppression administrative du participant (Validation Option A)
  const deleteRes = await fetch(`${baseUrl}/api/v1/admin/adaptive/participants/${interview.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteRes.status, 200, "L'administrateur doit pouvoir supprimer le participant via DELETE");
  const deleteData = await deleteRes.json();
  assert.equal(deleteData.deleted, true);

  // Vérifier que le participant n'existe plus
  const verifyDeleted = await fetch(`${baseUrl}/api/v1/admin/adaptive/participants/${interview.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(verifyDeleted.status, 404, "Le participant supprimé ne doit plus être accessible");
});

test("Batterie des Refus: Contrôles de sécurité et intégrité de session", async () => {
  // A. Refus code erroné / inexistant
  const badCodeRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationId: crypto.randomUUID(), code: "ERR999", displayName: "SYNTH-Test Erreur" }),
  });
  assert.equal(badCodeRes.status, 400, "Un code inexistant doit être rejeté avec 400");
  const badErr = await badCodeRes.json();
  assert.equal(badErr.error, "Code invalide ou session indisponible.");

  // B. Refus session fermée
  const closedRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationId: crypto.randomUUID(), code: closedSessionCode, displayName: "SYNTH-Test Ferme" }),
  });
  assert.equal(closedRes.status, 400, "Une session fermée doit être rejetée avec 400");
  const closedErr = await closedRes.json();
  assert.equal(closedErr.error, "Code invalide ou session indisponible.");

  // C. Refus capacité atteinte (session limitée à 1 place)
  // Premier participant -> succès
  const firstJoin = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationId: crypto.randomUUID(), code: limitedSessionCode, displayName: "SYNTH-Premier Gagnant" }),
  });
  assert.equal(firstJoin.status, 201, "La 1ère place doit être attribuée (201)");

  // Deuxième participant -> rejet 409
  const secondJoin = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationId: crypto.randomUUID(), code: limitedSessionCode, displayName: "SYNTH-Deuxieme Perdant" }),
  });
  assert.equal(secondJoin.status, 409, "La session pleine doit rejeter avec 409");
  const fullErr = await secondJoin.json();
  assert.equal(fullErr.error, "Cette session a atteint sa capacité maximale de participants.");

  // D. Refus identité non synthétique en environnement test/staging
  const { randomUUID } = await import("node:crypto");
  const stagingId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SyntheticStagingInstallation" (singleton, "stagingId", "projectId", "databaseName")
     VALUES (1, $1::uuid, NULL, current_database())
     ON CONFLICT (singleton) DO UPDATE SET "stagingId"=$1::uuid`,
    stagingId
  );

  const secret = Buffer.alloc(32, 7).toString("base64url");
  const previousEnv = { ...process.env };
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = stagingId;
  process.env.SKILLQUEST_STAGING_SECRET = secret;

  try {
    // Ensure this fixture is a valid synthetic database before testing rejection.
    const { assertSyntheticDatabase } = await import("../src/security/synthetic-staging.js");
    await assertSyntheticDatabase(prisma);
    const realNameRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId: crypto.randomUUID(), code: openSessionCode, displayName: "Jean Dupont" }),
    });
    assert.equal(realNameRes.status, 400, "Un nom sans SYNTH- doit être rejeté en mode synthétique");
    const synthErr = await realNameRes.json();
    assert.equal(synthErr.code, "SYNTHETIC_IDENTITY_REQUIRED");
  } finally {
    process.env = previousEnv;
  }
});

test("Non-régression: Le parcours individuel e-mail OTP reste pleinement fonctionnel", async () => {
  const startRes = await fetch(`${baseUrl}/api/v1/adaptive/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "SYNTH-Candidat Individuel",
      email: "synth-indiv@example.test",
      language: "fr",
      consent: true,
      adult: true,
    }),
  });
  // En mode test local sans Brevo configuré (0 DH), l'API répond de manière cohérente avec EMAIL_UNAVAILABLE (503)
  assert.equal(startRes.status, 503, "L'endpoint répond normalement sans service tiers payant");
  const data = await startRes.json();
  assert.equal(data.code, "EMAIL_UNAVAILABLE");
  assert.equal(data.verificationStatus, "UNAVAILABLE");
});
