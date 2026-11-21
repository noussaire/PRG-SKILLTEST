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
let publishedAssessmentId: string;
let decryptCode: (cipher: string | null) => string | null;

before(async () => {
  // 1. Initialisation de PostgreSQL local en mémoire via PGlite
  db = await PGlite.create();

  // 2. Application séquentielle de toutes les migrations
  const migrationsDir = new URL("../prisma/migrations/", import.meta.url);
  const entries = (await readdir(migrationsDir)).filter((n) => n !== "migration_lock.toml").sort();
  for (const entry of entries) {
    const sql = await readFile(new URL(`${entry}/migration.sql`, migrationsDir), "utf8");
    await db.exec(sql);
  }

  // 3. Démarrage du serveur socket PGlite
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
  const tokens = await import("../src/security/tokens.js");
  decryptCode = tokens.decryptCode;
  const { app } = await import("../src/app.js");

  http = createServer(app);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Création du compte administrateur
  const passwordHash = await hashPassword("AdminPass123!");
  await prisma.user.create({
    data: {
      email: "admin@example.test",
      role: "ADMIN",
      passwordHash,
    },
  });

  // Création d'une évaluation classique publiée
  const assessment = await prisma.assessment.create({
    data: {
      slug: "classic-assessment",
      title: "Évaluation Classique de Test",
      status: "PUBLISHED",
    },
  });
  publishedAssessmentId = assessment.id;

  // Connexion admin pour récupérer le token
  const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.test", password: "AdminPass123!" }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = (await loginRes.json()) as { token: string };
  adminToken = loginData.token;
});

after(async () => {
  if (http?.listening) http.close();
  if (prisma) await prisma.$disconnect();
  if (socket) await socket.stop();
  if (db) await db.close();
});

test("Migration Prisma : la colonne assessmentId est bien nullable sur AssessmentSession", async () => {
  const colRes = await db.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'AssessmentSession' AND column_name = 'assessmentId'`
  );
  assert.equal(colRes.rows.length, 1);
  assert.equal(colRes.rows[0].is_nullable, "YES", "La colonne assessmentId doit être nullable (is_nullable = YES)");
});

test("Création d'une session sans assessmentId : succès, code 6 caractères et assessmentId nul", async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Adaptative Pure",
      status: "OPEN",
      maxParticipants: 10,
    }),
  });

  assert.equal(res.status, 201);
  const data = (await res.json()) as { session: { id: string; assessmentId: string | null; code: string }; plainCode: string };
  assert.ok(data.session.id);
  assert.equal(data.session.assessmentId, null, "assessmentId doit être null pour une session adaptative");
  assert.ok(data.plainCode);
  assert.ok(data.plainCode.length >= 6, "Le code de session doit comporter au moins 6 caractères");
  assert.match(data.plainCode, /^[\p{L}0-9_-]+$/u, "Le code doit respecter le format valide");

  // Vérification en base de données
  const saved = await prisma.assessmentSession.findUnique({
    where: { id: data.session.id },
  });
  assert.ok(saved);
  assert.equal(saved.assessmentId, null);
  assert.equal(saved.status, "OPEN");
  assert.equal(decryptCode(saved.codeCipher), data.plainCode);
});

test("Obtention et validation d'un code de session à 6 caractères exacts", async () => {
  const { hashJoinCode, encryptCode } = await import("../src/security/tokens.js");
  const sixCharCode = "SKL999";
  const session6 = await prisma.assessmentSession.create({
    data: {
      label: "SYNTH-Session Code 6 Caractères",
      status: "OPEN",
      codeHash: hashJoinCode(sixCharCode),
      codeCipher: encryptCode(sixCharCode),
      createdById: (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id,
    },
  });

  assert.equal(sixCharCode.length, 6, "Le code comporte exactement 6 caractères");

  // Vérifier qu'un étudiant peut rejoindre directement avec ce code à 6 caractères
  const joinRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: sixCharCode,
      displayName: "SYNTH-Etudiant Code 6",
      language: "fr",
    }),
  });
  assert.equal(joinRes.status, 201, "L'accès avec un code à 6 caractères doit réussir (201 Created)");
  const joinData = (await joinRes.json()) as { interview: { totalQuestions: number } };
  assert.equal(joinData.interview.totalQuestions, 31);
});

test("Création d'une session classique avec assessmentId : succès et persistance de la clé étrangère", async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Hybride Classique",
      assessmentId: publishedAssessmentId,
      status: "OPEN",
    }),
  });

  assert.equal(res.status, 201);
  const data = (await res.json()) as { session: { id: string; assessmentId: string | null; code: string } };
  assert.equal(data.session.assessmentId, publishedAssessmentId);

  const saved = await prisma.assessmentSession.findUnique({
    where: { id: data.session.id },
  });
  assert.ok(saved);
  assert.equal(saved.assessmentId, publishedAssessmentId);
});

test("Refus d'une évaluation inexistante lors de la création de session", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const res = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Invalide",
      assessmentId: fakeId,
      status: "OPEN",
    }),
  });

  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "L'évaluation sélectionnée est introuvable.");
});

test("Accès étudiant à une session adaptative OPEN (sans assessmentId) : génération du token et interview 31 questions", async () => {
  // 1. Créer une session adaptative sans assessmentId
  const createRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Étudiants Adaptative",
      status: "OPEN",
    }),
  });
  assert.equal(createRes.status, 201);
  const { plainCode, session } = (await createRes.json()) as { plainCode: string; session: { id: string } };

  // 2. Rejoindre en tant qu'étudiant
  const joinRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: plainCode,
      displayName: "SYNTH-Étudiante Aïcha",
      language: "fr",
    }),
  });

  assert.equal(joinRes.status, 201);
  const joinData = (await joinRes.json()) as {
    token: string;
    publicId: string;
    interviewId: string;
    interview: {
      status: string;
      answeredCount: number;
      totalQuestions: number;
      currentQuestion: { id: string; choices: Array<{ id: string; label: string }> };
    };
  };

  assert.ok(joinData.token);
  assert.ok(joinData.publicId);
  assert.equal(joinData.interview.status, "IN_PROGRESS");
  assert.equal(joinData.interview.answeredCount, 0);
  assert.equal(joinData.interview.totalQuestions, 31);
  assert.ok(joinData.interview.currentQuestion);
  assert.equal(joinData.interview.currentQuestion.choices.length, 4);

  // Vérifier la liaison en base
  const interview = await prisma.adaptiveInterview.findUnique({
    where: { id: joinData.interviewId },
  });
  assert.ok(interview);
  assert.equal(interview.sessionId, session.id);
});

test("Refus d'une session fermée ou expirée lors de la tentative d'accès étudiant", async () => {
  // Session fermée
  const closedRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Clôturée",
      status: "OPEN",
    }),
  });
  const { plainCode: closedCode, session: closedSession } = (await closedRes.json()) as { plainCode: string; session: { id: string } };

  // Fermer la session
  await fetch(`${baseUrl}/api/v1/admin/sessions/${closedSession.id}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  // Tenter de rejoindre la session fermée
  const joinClosedRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: closedCode,
      displayName: "SYNTH-Testeur Fermé",
      language: "fr",
    }),
  });
  assert.equal(joinClosedRes.status, 400);
  const closedBody = (await joinClosedRes.json()) as { error: string };
  assert.equal(closedBody.error, "Code invalide ou session indisponible.");

  // Session expirée (closesAt dans le passé)
  const pastDate = new Date(Date.now() - 3600000).toISOString();
  const expiredRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Session Expirée",
      status: "OPEN",
      closesAt: pastDate,
    }),
  });
  const { plainCode: expiredCode } = (await expiredRes.json()) as { plainCode: string };

  const joinExpiredRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: expiredCode,
      displayName: "SYNTH-Testeur Expiré",
      language: "fr",
    }),
  });
  assert.equal(joinExpiredRes.status, 400);
  const expiredBody = (await joinExpiredRes.json()) as { error: string };
  assert.equal(expiredBody.error, "Code invalide ou session indisponible.");
});

test("Fonctionnement complet des 31 questions et du bilan final sans évaluation classique", async () => {
  // 1. Créer une session adaptative sans assessmentId
  const createRes = await fetch(`${baseUrl}/api/v1/admin/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      label: "SYNTH-Parcours 31 Questions",
      status: "OPEN",
    }),
  });
  const { plainCode } = (await createRes.json()) as { plainCode: string };

  // 2. Rejoindre la session
  const joinRes = await fetch(`${baseUrl}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: plainCode,
      displayName: "SYNTH-Candidat Complet",
      language: "fr",
    }),
  });
  assert.equal(joinRes.status, 201);
  const joinData = (await joinRes.json()) as {
    token: string;
    interview: {
      currentQuestion: { id: string; choices: Array<{ id: string }> };
    };
  };

  const token = joinData.token;
  let currentQuestion = joinData.interview.currentQuestion;

  // 3. Répondre successivement aux 31 questions
  for (let step = 1; step <= 31; step++) {
    assert.ok(currentQuestion, `La question ${step} doit exister`);
    const choiceId = currentQuestion.choices[0].id;

    const answerRes = await fetch(`${baseUrl}/api/v1/adaptive/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        questionId: currentQuestion.id,
        choiceId,
      }),
    });

    assert.equal(answerRes.status, 200, `La réponse à la question ${step} doit retourner 200`);
    const answerData = (await answerRes.json()) as {
      status: string;
      answeredCount: number;
      totalQuestions: number;
      currentQuestion: { id: string; choices: Array<{ id: string }> } | null;
      report: { skills: Array<{ id: string; label: string; level: number }>; summary: string } | null;
    };

    assert.equal(answerData.answeredCount, step);

    if (step < 31) {
      assert.equal(answerData.status, "IN_PROGRESS");
      assert.ok(answerData.currentQuestion);
      currentQuestion = answerData.currentQuestion;
    } else {
      // Étape 31 : fin du parcours adaptatif et bilan généré
      assert.equal(answerData.status, "COMPLETED");
      assert.equal(answerData.currentQuestion, null, "Il ne doit plus y avoir de question courante");
      assert.ok(answerData.report, "Le rapport final doit être généré");
      assert.equal(answerData.report.skills.length, 31, "Le rapport doit contenir exactement 31 compétences");
      assert.ok(answerData.report.summary, "Le résumé du bilan doit être présent");
    }
  }

  // 4. Vérifier GET /api/v1/adaptive/me avec le token
  const meRes = await fetch(`${baseUrl}/api/v1/adaptive/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = (await meRes.json()) as {
    status: string;
    answeredCount: number;
    report: { skills: Array<unknown> };
  };
  assert.equal(meData.status, "COMPLETED");
  assert.equal(meData.answeredCount, 31);
  assert.equal(meData.report.skills.length, 31);
});
