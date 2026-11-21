import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

let db: PGlite;
let socket: PGLiteSocketServer;
let http: Server;
let prisma: PrismaClient;
let base: string;
let hashJoinCode: (code: string) => string;
let hashGuestToken: (token: string) => string;
let encryptCode: (code: string) => string;
let openSessionCode = "ABC123";
let closedSessionCode = "CLOSED";
let scheduledSessionCode = "FUTURE";
let limitedSessionCode = "LMT001";
let openSessionId: string;
let limitedSessionId: string;

before(async () => {
  db = await PGlite.create();
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name !== "migration_lock.toml").sort()) {
    await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
  }

  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 8 });
  await socket.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=4&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "isolated-session-test-only-0123456789abcdef";
  process.env.GROQ_API_KEY = "";
  process.env.BREVO_API_KEY = "";

  const tokens = await import("../src/security/tokens.js");
  hashJoinCode = tokens.hashJoinCode;
  hashGuestToken = tokens.hashGuestToken;
  encryptCode = tokens.encryptCode;

  ({ prisma } = await import("../src/db/prisma.js"));
  const { app } = await import("../src/app.js");

  http = createServer(app);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;

  // Seed baseline records
  const admin = await prisma.user.create({
    data: { email: "admin@example.test", role: "ADMIN" },
  });

  const assessment = await prisma.assessment.create({
    data: {
      slug: "soft-skills-eval",
      title: "Évaluation Soft Skills",
      status: "PUBLISHED",
    },
  });

  // 1. OPEN session with capacity for 2 participants
  const sOpen = await prisma.assessmentSession.create({
    data: {
      label: "Session Informatique 2026",
      assessmentId: assessment.id,
      createdById: admin.id,
      codeHash: hashJoinCode(openSessionCode),
      codeCipher: encryptCode(openSessionCode),
      maxParticipants: 2,
      status: "OPEN",
    },
  });
  openSessionId = sOpen.id;

  // 2. CLOSED session
  await prisma.assessmentSession.create({
    data: {
      label: "Session Terminée",
      assessmentId: assessment.id,
      createdById: admin.id,
      codeHash: hashJoinCode(closedSessionCode),
      codeCipher: encryptCode(closedSessionCode),
      status: "CLOSED",
    },
  });

  // 3. SCHEDULED session (future opensAt)
  await prisma.assessmentSession.create({
    data: {
      label: "Session Future",
      assessmentId: assessment.id,
      createdById: admin.id,
      codeHash: hashJoinCode(scheduledSessionCode),
      codeCipher: encryptCode(scheduledSessionCode),
      status: "SCHEDULED",
      opensAt: new Date(Date.now() + 86400000), // tomorrow
    },
  });

  // 4. Session with capacity = 1 for concurrency test
  const sLmt = await prisma.assessmentSession.create({
    data: {
      label: "Session 1 Place",
      assessmentId: assessment.id,
      createdById: admin.id,
      codeHash: hashJoinCode(limitedSessionCode),
      codeCipher: encryptCode(limitedSessionCode),
      maxParticipants: 1,
      status: "OPEN",
    },
  });
  limitedSessionId = sLmt.id;
});

after(async () => {
  http?.close();
  await prisma?.$disconnect();
  await socket?.stop();
  await db?.close();
});

test("Join session: student joins OPEN session and receives initialized AdaptiveInterview", async () => {
  const res = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: openSessionCode,
      displayName: "SYNTH-Etudiant 1",
      language: "fr",
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json() as any;

  // Verify response contract
  assert.ok(typeof data.token === "string" && data.token.length === 64);
  assert.equal(data.guestToken, data.token);
  assert.ok(typeof data.publicId === "string");
  assert.ok(typeof data.interviewId === "string");

  // Verify initial interview view
  assert.equal(data.interview.displayName, "SYNTH-Etudiant 1");
  assert.equal(data.interview.language, "fr");
  assert.equal(data.interview.status, "IN_PROGRESS");
  assert.equal(data.interview.answeredCount, 0);
  assert.equal(data.interview.totalQuestions, 31);
  assert.ok(data.interview.currentQuestion);
  assert.equal(data.interview.currentQuestion.choices.length, 4);

  // Verify database persistence and session relationship
  const savedInterview = await prisma.adaptiveInterview.findUnique({
    where: { tokenHash: hashGuestToken(data.token) },
  });
  assert.ok(savedInterview);
  assert.equal(savedInterview.sessionId, openSessionId);
  assert.equal(savedInterview.displayName, "SYNTH-Etudiant 1");

  // Verify participant persistence
  const savedParticipant = await prisma.participant.findUnique({
    where: { guestTokenHash: hashGuestToken(data.token) },
  });
  assert.ok(savedParticipant);
  assert.equal(savedParticipant.sessionId, openSessionId);
  assert.equal(savedParticipant.displayName, "SYNTH-Etudiant 1");
});

test("Join session: student can join in Arabic and interview is localized", async () => {
  const res = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: openSessionCode,
      displayName: "SYNTH-Etudiant Arabe",
      language: "ar",
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json() as any;
  assert.equal(data.interview.language, "ar");
  assert.equal(data.interview.answeredCount, 0);
  assert.equal(data.interview.totalQuestions, 31);
  assert.ok(data.interview.currentQuestion);
});

test("Join session: can advance adaptive questionnaire with returned token", async () => {
  // Join
  const joinRes = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: openSessionCode,
      displayName: "SYNTH-Avancement",
      language: "fr",
    }),
  });
  // Capacity of openSessionCode is 2, so 3rd attempt is rejected with 409
  assert.equal(joinRes.status, 409);
  const err = await joinRes.json() as any;
  assert.equal(err.error, "Cette session a atteint sa capacité maximale de participants.");
});

test("Join session: invalid session code returns 400", async () => {
  const res = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: "INVALD",
      displayName: "SYNTH-Testeur",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error, "Code invalide ou session indisponible.");
});

test("Join session: closed session returns 400", async () => {
  const res = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: closedSessionCode,
      displayName: "SYNTH-Testeur",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error, "Code invalide ou session indisponible.");
});

test("Join session: future scheduled session returns 400", async () => {
  const res = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: scheduledSessionCode,
      displayName: "SYNTH-Testeur",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error, "Code invalide ou session indisponible.");
});

test("Join session: concurrency test on 1-seat session guarantees single winner without race condition", async () => {
  // Launch 2 parallel requests on the 1-seat session
  const [res1, res2] = await Promise.all([
    fetch(`${base}/api/v1/sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationId: crypto.randomUUID(), code: limitedSessionCode,
        displayName: "SYNTH-Concurrent A",
        language: "fr",
      }),
    }),
    fetch(`${base}/api/v1/sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationId: crypto.randomUUID(), code: limitedSessionCode,
        displayName: "SYNTH-Concurrent B",
        language: "fr",
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  // Exactly one 201 Created and one 409 Conflict
  assert.deepEqual(statuses, [201, 409]);

  // Database count must be exactly 1
  const interviewCount = await prisma.adaptiveInterview.count({
    where: { sessionId: limitedSessionId },
  });
  assert.equal(interviewCount, 1);

  const participantCount = await prisma.participant.count({
    where: { sessionId: limitedSessionId },
  });
  assert.equal(participantCount, 1);
});

test("Join session: student can fetch profile and submit first answer via adaptive API", async () => {
  // 1. Create a fresh session
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const assessment = await prisma.assessment.findFirstOrThrow();
  const flowCode = "FLOW01";
  await prisma.assessmentSession.create({
    data: {
      label: "Session Progression",
      assessmentId: assessment.id,
      createdById: admin.id,
      codeHash: hashJoinCode(flowCode),
      codeCipher: encryptCode(flowCode),
      status: "OPEN",
    },
  });

  // 2. Join session
  const joinRes = await fetch(`${base}/api/v1/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationId: crypto.randomUUID(), code: flowCode,
      displayName: "SYNTH-Joueur 1",
      language: "fr",
    }),
  });
  assert.equal(joinRes.status, 201);
  const joinData = await joinRes.json() as any;
  const token = joinData.token;
  const q1 = joinData.interview.currentQuestion;
  assert.ok(q1);
  assert.equal(joinData.interview.answeredCount, 0);

  // 3. GET /api/v1/adaptive/me with token
  const meRes = await fetch(`${base}/api/v1/adaptive/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json() as any;
  assert.equal(meData.id, joinData.interviewId);
  assert.equal(meData.displayName, "SYNTH-Joueur 1");
  assert.equal(meData.answeredCount, 0);

  // 4. POST /api/v1/adaptive/answer with first choice
  const firstChoiceId = q1.choices[0].id;
  const answerRes = await fetch(`${base}/api/v1/adaptive/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      questionId: q1.id,
      choiceId: firstChoiceId,
    }),
  });
  assert.equal(answerRes.status, 200);
  const answerData = await answerRes.json() as any;
  assert.equal(answerData.answeredCount, 1);
  assert.ok(answerData.currentQuestion);
  assert.notEqual(answerData.currentQuestion.id, q1.id);
});

test("Join session: synthetic staging guard rejects non-SYNTH display names", async () => {
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
    const res = await fetch(`${base}/api/v1/sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationId: crypto.randomUUID(), code: openSessionCode,
        displayName: "Etudiant Réel Sans Synth",
      }),
    });

    const body = await res.json() as any;
    assert.equal(res.status, 400);
    assert.equal(body.code, "SYNTHETIC_IDENTITY_REQUIRED");
  } finally {
    process.env = previousEnv;
  }
});
