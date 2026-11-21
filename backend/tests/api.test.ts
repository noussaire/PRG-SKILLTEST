import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";

let db: PGlite,
  socket: PGLiteSocketServer,
  http: Server,
  prisma: PrismaClient,
  base: string,
  teacher: string,
  assessmentId: string,
  missionId: string,
  revision: number,
  communicationId: string;
const adminToken = "a".repeat(64),
  password = "Only-for-isolated-tests-2026!";
let hashJoinCode: (s: string) => string, encryptCode: (s: string) => string;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
}
before(
  async () => {
    db = await PGlite.create();
    const root = new URL("../prisma/migrations/", import.meta.url);
    for (const name of (await readdir(root))
      .filter((n) => n !== "migration_lock.toml")
      .sort())
      await db.exec(
        await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
      );
    socket = new PGLiteSocketServer({
      db,
      port: 0,
      host: "127.0.0.1",
      maxConnections: 4,
    });
    await socket.start();
    // Always overwrite external configuration before importing application code. No user database can be used.
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=20`;
    process.env.DIRECT_URL = process.env.DATABASE_URL;
    process.env.JOIN_CODE_PEPPER = "isolated-test-only-pepper-0123456789abcdef";
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGIN = "http://localhost:3000";
    ({ prisma } = await import("../src/db/prisma.js"));
    const tokens = await import("../src/security/tokens.js");
    hashJoinCode = tokens.hashJoinCode;
    encryptCode = tokens.encryptCode;
    const { hashAdminToken } = await import("../src/security/adminAuth.js");
    const admin = await prisma.user.create({
      data: {
        email: "teacher@example.test",
        role: "ADMIN",
        passwordHash: await tokens.hashPassword(password),
      },
    });
    teacher = admin.id;
    await prisma.adminSession.create({
      data: {
        userId: teacher,
        tokenHash: hashAdminToken(adminToken),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const { app } = await import("../src/app.js");
    http = app.listen(0, "127.0.0.1");
    await once(http, "listening");
    const address = http.address();
    if (!address || typeof address === "string")
      throw Error("No test HTTP address");
    base = `http://127.0.0.1:${address.port}`;
    communicationId = (
      await prisma.competency.findUniqueOrThrow({
        where: { slug: "communication" },
      })
    ).id;
  },
  { timeout: 60000 },
);
after(async () => {
  http?.closeAllConnections();
  await new Promise<void>((resolve) =>
    http ? http.close(() => resolve()) : resolve(),
  );
  await prisma?.$disconnect();
  await socket?.stop();
  await db?.close();
});
const draft = (label = "Original choice", delta = 2) => [
  {
    key: "start",
    kind: "QUESTION",
    title: "Original situation",
    story: "Original story",
    question: "What now?",
    isStart: true,
    posX: 0,
    posY: 0,
    choices: [
      {
        position: 0,
        label,
        targetKey: "second",
        impacts: [{ competencyId: communicationId, delta }],
      },
    ],
  },
  {
    key: "second",
    kind: "QUESTION",
    title: "Second situation",
    story: "Second story",
    question: "Next?",
    isStart: false,
    posX: 100,
    posY: 0,
    choices: [
      {
        position: 0,
        label: "Finish",
        targetKey: "end",
        impacts: [{ competencyId: communicationId, delta }],
      },
    ],
  },
  {
    key: "end",
    kind: "ENDING",
    title: "End",
    story: "Conclusion",
    question: null,
    isStart: false,
    posX: 200,
    posY: 0,
    choices: [],
  },
];
async function createSession(
  code: string,
  extra: Record<string, unknown> = {},
) {
  return prisma.assessmentSession.create({
    data: {
      assessmentId,
      createdById: teacher,
      label: code,
      codeHash: hashJoinCode(code),
      codeCipher: encryptCode(code),
      status: "OPEN",
      ...extra,
    },
  });
}
async function join(code: string, name: string) {
  return request("/sessions/join", "POST", { code, displayName: name, registrationId: crypto.randomUUID() });
}
async function view(token: string) {
  return request("/participants/me", "GET", undefined, token);
}
async function complete(token: string) {
  for (let i = 0; i < 10; i++) {
    const v = await view(token);
    assert.equal(v.status, 200);
    if (v.body.attempt.status === "COMPLETED") return;
    const r = await request(
      "/participants/decisions",
      "POST",
      { choiceId: v.body.attempt.currentNode.choices[0].id },
      token,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  throw Error("Non-terminating test mission");
}

test("All migrations create a schema compatible with Prisma", async () => {
  assert.equal(await prisma.missionVersion.count(), 0);
  assert.equal(await prisma.competency.count(), 7);
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Participant'`,
  );
  assert.ok(cols.rows.some((c) => c.column_name === "tokenExpiresAt"));
});
test("Administrative routes refuse an unauthenticated visitor", async () =>
  assert.equal((await request("/admin/missions")).status, 401));
test("Login verifies passwords, normalizes email and revokes logout tokens", async () => {
  assert.equal(
    (
      await request("/admin/auth/login", "POST", {
        email: "teacher@example.test",
        password: "wrong",
      })
    ).status,
    401,
  );
  const login = await request("/admin/auth/login", "POST", {
    email: "TEACHER@example.test",
    password,
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await request("/admin/auth/me", "GET", undefined, login.body.token))
      .status,
    200,
  );
  await request("/admin/auth/logout", "POST", undefined, login.body.token);
  assert.equal(
    (await request("/admin/auth/me", "GET", undefined, login.body.token))
      .status,
    401,
  );
});
test("Create, save and publish a coherent mission", async () => {
  const created = await request(
    "/admin/missions",
    "POST",
    { title: "Testing mission" },
    adminToken,
  );
  assert.equal(created.status, 201);
  missionId = created.body.mission.id;
  assessmentId = created.body.mission.assessmentId;
  const saved = await request(
    `/admin/missions/${missionId}/graph`,
    "PUT",
    { nodes: draft(), expectedRevision: 0 },
    adminToken,
  );
  assert.equal(saved.status, 200);
  revision = saved.body.editRevision;
  const published = await request(
    `/admin/missions/${missionId}/publish`,
    "POST",
    { expectedRevision: revision },
    adminToken,
  );
  assert.equal(published.status, 200);
  assert.equal(published.body.mission.version, 1);
  revision = published.body.mission.editRevision;
});
test("Stale and missing revisions cannot overwrite a draft or publish it", async () => {
  assert.equal(
    (
      await request(
        `/admin/missions/${missionId}/graph`,
        "PUT",
        { nodes: draft(), expectedRevision: 0 },
        adminToken,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/admin/missions/${missionId}/publish`,
        "POST",
        {},
        adminToken,
      )
    ).status,
    400,
  );
});
test("Published snapshots reject updates at database level", async () => {
  await assert.rejects(
    prisma.missionVersion.update({
      where: { missionId_version: { missionId, version: 1 } },
      data: { title: "tampered" },
    }),
  );
});
let oldToken: string, oldChoice: string;
test("Joining pins a version and refuses an unfinished final report", async () => {
  await createSession("SQ-VERSION-TEST");
  const joined = await join("SQ-VERSION-TEST", "Old participant");
  assert.equal(joined.status, 201);
  oldToken = joined.body.guestToken;
  const v = await view(oldToken);
  assert.equal(v.body.attempt.missionVersion, 1);
  assert.equal(v.body.attempt.completedDecisions, 0);
  oldChoice = v.body.attempt.currentNode.choices[0].id;
  assert.equal(
    (await request("/participants/me/report", "GET", undefined, oldToken))
      .status,
    409,
  );
});
test("Draft editing and publication cannot alter an in-progress version", async () => {
  const g = draft("New choice", -2);
  g[0].title = "New situation";
  const saved = await request(
    `/admin/missions/${missionId}/graph`,
    "PUT",
    { nodes: g, expectedRevision: revision },
    adminToken,
  );
  assert.equal(saved.status, 200);
  revision = saved.body.editRevision;
  assert.equal(
    (await view(oldToken)).body.attempt.currentNode.title,
    "Original situation",
  );
  const published = await request(
    `/admin/missions/${missionId}/publish`,
    "POST",
    { expectedRevision: revision },
    adminToken,
  );
  assert.equal(published.status, 200);
  revision = published.body.mission.editRevision;
  assert.equal(published.body.mission.version, 2);
  const v = await view(oldToken);
  assert.equal(v.body.attempt.currentNode.title, "Original situation");
  assert.equal(v.body.attempt.currentNode.choices[0].label, "Original choice");
  assert.equal(v.body.attempt.currentNode.choices[0].id, oldChoice);
  const newUser = await join("SQ-VERSION-TEST", "New participant");
  assert.equal(
    (await view(newUser.body.guestToken)).body.attempt.missionVersion,
    2,
  );
});
test("An unavailable destination blocks publication without altering the current version", async () => {
  const g = draft();
  g[0].choices[0].targetKey = "start";
  const saved = await request(
    `/admin/missions/${missionId}/graph`,
    "PUT",
    { nodes: g, expectedRevision: revision },
    adminToken,
  );
  revision = saved.body.editRevision;
  const published = await request(
    `/admin/missions/${missionId}/publish`,
    "POST",
    { expectedRevision: revision },
    adminToken,
  );
  assert.equal(published.status, 400);
  assert.equal(
    (await prisma.mission.findUniqueOrThrow({ where: { id: missionId } }))
      .version,
    2,
  );
});
test("Concurrent answers create only one decision and preserve the saved progress", async () => {
  const results = await Promise.all(
    [1, 2].map(() =>
      request(
        "/participants/decisions",
        "POST",
        { choiceId: oldChoice },
        oldToken,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const v = await view(oldToken);
  assert.equal(v.body.attempt.completedDecisions, 1);
  assert.equal(v.body.attempt.remainingQuestions.max, 1);
});
test("Capacity remains within the maximum during a burst of joins", async () => {
  const s = await createSession("SQ-CAPACITY-TEST", { maxParticipants: 1 });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      join("SQ-CAPACITY-TEST", `Student ${i}`),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(
    await prisma.participant.count({ where: { sessionId: s.id } }),
    1,
  );
});
test("Deadline applies to existing participants at the exact closing boundary", async () => {
  const s = await createSession("SQ-DEADLINE-TEST");
  const j = await join("SQ-DEADLINE-TEST", "Deadline student"),
    v = await view(j.body.guestToken);
  await prisma.assessmentSession.update({
    where: { id: s.id },
    data: { closesAt: new Date() },
  });
  assert.equal(
    (
      await request(
        "/participants/decisions",
        "POST",
        { choiceId: v.body.attempt.currentNode.choices[0].id },
        j.body.guestToken,
      )
    ).status,
    403,
  );
  assert.equal((await join("SQ-DEADLINE-TEST", "Late student")).status, 400);
});
test("Expired and revoked guest tokens are rejected by view, decisions and report", async () => {
  await createSession("SQ-EXPIRY-TEST");
  const j = await join("SQ-EXPIRY-TEST", "Expiry student");
  const p = await prisma.participant.findFirstOrThrow({
    where: { displayName: "Expiry student" },
  });
  await prisma.participant.update({
    where: { id: p.id },
    data: { tokenExpiresAt: new Date(Date.now() - 1) },
  });
  assert.equal((await view(j.body.guestToken)).status, 401);
  assert.equal(
    (
      await request(
        "/participants/me/report",
        "GET",
        undefined,
        j.body.guestToken,
      )
    ).status,
    401,
  );
  const revoked = await join("SQ-EXPIRY-TEST", "Revoked student");
  await request(
    "/participants/logout",
    "POST",
    undefined,
    revoked.body.guestToken,
  );
  assert.equal((await view(revoked.body.guestToken)).status, 401);
});
test("A scheduled session opens and closes from its configured dates", async () => {
  const s = await createSession("SQ-SCHEDULE-TEST", {
    status: "SCHEDULED",
    opensAt: new Date(Date.now() - 1000),
  });
  assert.equal(
    (await join("SQ-SCHEDULE-TEST", "Scheduled student")).status,
    201,
  );
  const { refreshSessionWindows } = await import(
    "../src/services/session-scheduler.js"
  );
  await refreshSessionWindows();
  assert.equal(
    (await prisma.assessmentSession.findUniqueOrThrow({ where: { id: s.id } }))
      .status,
    "OPEN",
  );
  await prisma.assessmentSession.update({
    where: { id: s.id },
    data: { closesAt: new Date(Date.now() - 1) },
  });
  await refreshSessionWindows();
  assert.equal(
    (await prisma.assessmentSession.findUniqueOrThrow({ where: { id: s.id } }))
      .status,
    "CLOSED",
  );
});
test("Reports preserve the old wording and scoring after a new version is published", async () => {
  await complete(oldToken);
  const r = await request(
    "/participants/me/report",
    "GET",
    undefined,
    oldToken,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.mission.version, 1);
  assert.equal(r.body.decisionTimeline[0].chosenOption, "Original choice");
  const score = r.body.indicators.find((i: any) => i.slug === "communication");
  assert.equal(score.averageValue, 2);
  assert.equal(score.cumulativeValue, 4);
  const p = await prisma.participant.findFirstOrThrow({
    where: { displayName: "Old participant" },
  });
  const admin = await request(
    `/admin/participants/${p.id}/competencies`,
    "GET",
    undefined,
    adminToken,
  );
  assert.equal(admin.body.competencies[0].totalScore, 4);
  assert.equal(admin.body.competencies[0].averageIndicator, 2);
  const journey = await request(
    `/admin/participants/${p.id}/decisions`,
    "GET",
    undefined,
    adminToken,
  );
  assert.equal(journey.body.decisions[0].chosenOption.label, "Original choice");
});
test("Small cohorts hide their detailed distributions", async () => {
  const s = await createSession("SQ-GROUP-TEST");
  const j = await join("SQ-GROUP-TEST", "Group 1");
  await complete(j.body.guestToken);
  const r = await request(
    `/admin/reports/sessions/${s.id}/collective`,
    "GET",
    undefined,
    adminToken,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.isSmallCohort, true);
  assert.deepEqual(r.body.competencyAverages, []);
  assert.deepEqual(r.body.profileDistribution, {});
});
test("Collective reports count completed profiles and use participant means", async () => {
  const s = await prisma.assessmentSession.findUniqueOrThrow({
    where: { codeHash: hashJoinCode("SQ-GROUP-TEST") },
  });
  for (const name of ["Group 2", "Group 3"]) {
    const j = await join("SQ-GROUP-TEST", name);
    await complete(j.body.guestToken);
  }
  const r = await request(
    `/admin/reports/sessions/${s.id}/collective`,
    "GET",
    undefined,
    adminToken,
  );
  assert.equal(r.body.isSmallCohort, false);
  assert.equal(r.body.competencyAverages[0].averageScore, -2);
  assert.equal(
    Object.values(r.body.profileDistribution).reduce(
      (s: any, n: any) => s + n,
      0,
    ),
    3,
  );
});
test("Clearing nullable session fields works and errors never reveal internals", async () => {
  const s = await createSession("SQ-NULL-TEST", {
    description: "Text",
    maxParticipants: 5,
  });
  const r = await request(
    `/admin/sessions/${s.id}`,
    "PATCH",
    { description: null, maxParticipants: null },
    adminToken,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.session.description, null);
  assert.equal(r.body.session.maxParticipants, null);
  const bad = await request(
    "/admin/missions/not-a-uuid",
    "GET",
    undefined,
    adminToken,
  );
  assert.equal(bad.status, 400);
  assert.equal(bad.body.details, undefined);
  assert.equal(bad.body.stack, undefined);
  assert.ok(!JSON.stringify(bad.body).includes("prisma"));
});
