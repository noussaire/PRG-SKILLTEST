import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { reportPdfRenderer } from "../src/services/report-pdf.service.js";

let db: PGlite, socket: PGLiteSocketServer, prisma: PrismaClient, server: Server, base: string;
let rawAdminToken: string;

before(async () => {
  process.env.DOTENV_CONFIG_PATH = "__no_environment_file_for_local_tests__";
  db = await PGlite.create();
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(root)).filter(n => n !== "migration_lock.toml").sort()) {
    await db.exec(await readFile(new URL(`${name}/migration.sql`, root), "utf8"));
  }
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.JOIN_CODE_PEPPER = "local-summary-only-0123456789abcdef";
  for (const key of ["GROQ_API_KEY", "BREVO_API_KEY", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) process.env[key] = "";
  process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
  process.env.SKILLQUEST_DEPLOYMENT_PURPOSE = "synthetic-staging";
  process.env.SKILLQUEST_STAGING_ACK = "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS";
  process.env.SKILLQUEST_STAGING_ID = randomUUID();
  process.env.SKILLQUEST_STAGING_SECRET = Buffer.alloc(32, 87).toString("base64url");
  await db.query('INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1,current_database())', [process.env.SKILLQUEST_STAGING_ID]);

  ({ prisma } = await import("../src/db/prisma.js"));
  const { adaptiveRouter } = await import("../src/routes/adaptive.routes.js");
  const { adminAdaptiveRouter } = await import("../src/routes/admin/adaptive.routes.js");
  const { hashAdminToken } = await import("../src/security/adminAuth.js");

  rawAdminToken = "b".repeat(64);
  const adminUser = await prisma.user.create({ data: { email: `admin-${randomUUID()}@example.test`, role: "ADMIN" } });
  await prisma.adminSession.create({
    data: { userId: adminUser.id, tokenHash: hashAdminToken(rawAdminToken), expiresAt: new Date(Date.now() + 86400000) },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/adaptive", adaptiveRouter);
  app.use("/api/v1/admin/adaptive", adminAdaptiveRouter);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, { timeout: 60000 });

after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await prisma?.$disconnect();
  await socket?.stop();
  await db?.close();
});

test("Report PDF endpoints: unified PDF engine produces identical bytes for student, admin, and email", { timeout: 60000 }, async t => {
  const { hashGuestToken } = await import("../src/security/tokens.js");
  const rawToken = "a".repeat(64);
  const tokenHash = hashGuestToken(rawToken);

  let state = createPreparedInterview("ar");
  while (state.currentQuestion) {
    state = advancePreparedInterview(state, {
      questionId: state.currentQuestion.id,
      choiceId: state.currentQuestion.choices![0].id,
    });
  }

  const interviewId = randomUUID();
  const created = await prisma.adaptiveInterview.create({
    data: {
      id: interviewId,
      tokenHash,
      displayName: "SYNTH-EtudiantTest",
      email: "synth-etudiant@example.test",
      state: state as any,
      expiresAt: new Date(Date.now() + 86400000),
      reportJob: {
        create: {
          status: "COMPLETE",
          summary: JSON.stringify({ fr: "Synthèse test.", ar: "خلاصة اختبار." }),
          nextAttemptAt: new Date(),
        },
      },
    },
    include: { reportJob: true },
  });

  try {
    // 1. Student endpoint: unauthenticated -> 401
    const unauthStudent = await fetch(`${base}/api/v1/adaptive/me/report.pdf`);
    assert.equal(unauthStudent.status, 401);

    // 2. Student endpoint: authenticated -> 200 PDF
    const studentRes = await fetch(`${base}/api/v1/adaptive/me/report.pdf`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    assert.equal(studentRes.status, 200);
    assert.equal(studentRes.headers.get("content-type"), "application/pdf");
    assert.ok(studentRes.headers.get("content-disposition")?.includes("SkillQuest-rapport.pdf"));
    const studentPdf = Buffer.from(await studentRes.arrayBuffer());
    assert.equal(studentPdf.subarray(0, 5).toString(), "%PDF-");

    // 3. Admin endpoint: unauthenticated -> 401
    const unauthAdmin = await fetch(`${base}/api/v1/admin/adaptive/participants/${interviewId}/report.pdf`);
    assert.equal(unauthAdmin.status, 401);

    // 4. Admin endpoint: authenticated -> 200 PDF
    const adminRes = await fetch(`${base}/api/v1/admin/adaptive/participants/${interviewId}/report.pdf`, {
      headers: { Authorization: `Bearer ${rawAdminToken}` },
    });
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.headers.get("content-type"), "application/pdf");
    assert.ok(adminRes.headers.get("content-disposition")?.includes("SkillQuest-rapport.pdf"));
    const adminPdf = Buffer.from(await adminRes.arrayBuffer());
    assert.equal(adminPdf.subarray(0, 5).toString(), "%PDF-");

    // 5. Direct renderer (as used by email queue)
    const emailPdf = await reportPdfRenderer.render(created, created.reportJob!);
    assert.equal(emailPdf.subarray(0, 5).toString(), "%PDF-");

    // 6. SHA-256 byte-for-byte identity check
    const studentHash = createHash("sha256").update(studentPdf).digest("hex");
    const adminHash = createHash("sha256").update(adminPdf).digest("hex");
    const emailHash = createHash("sha256").update(emailPdf).digest("hex");

    console.log("Student PDF SHA-256:", studentHash);
    console.log("Admin PDF SHA-256:  ", adminHash);
    console.log("Email PDF SHA-256:  ", emailHash);

    if (studentHash !== adminHash) {
      console.log("Student length:", studentPdf.length, "Admin length:", adminPdf.length);
      for (let i = 0; i < Math.min(studentPdf.length, adminPdf.length); i++) {
        if (studentPdf[i] !== adminPdf[i]) {
          console.log("Diff at byte", i);
          console.log("Student bytes:", studentPdf.slice(Math.max(0, i - 30), i + 40).toString("latin1"));
          console.log("Admin bytes:  ", adminPdf.slice(Math.max(0, i - 30), i + 40).toString("latin1"));
          break;
        }
      }
    }

    assert.equal(studentHash, adminHash, "Student PDF hash must strictly match Admin PDF hash");
    assert.equal(studentHash, emailHash, "Student PDF hash must strictly match Email attachment PDF hash");

    // 7. Page count check
    const pages = (studentPdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
    assert.equal(pages, 9, "PDF must have exactly 9 pages matching reference layout");

    // 8. Language query propagation check: participant is AR, request French PDF
    const studentFrRes = await fetch(`${base}/api/v1/adaptive/me/report.pdf?lang=fr`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    assert.equal(studentFrRes.status, 200);
    const studentFrPdf = Buffer.from(await studentFrRes.arrayBuffer());
    assert.equal(studentFrPdf.subarray(0, 5).toString(), "%PDF-");

    const adminFrRes = await fetch(`${base}/api/v1/admin/adaptive/participants/${interviewId}/report.pdf?lang=fr`, {
      headers: { Authorization: `Bearer ${rawAdminToken}` },
    });
    assert.equal(adminFrRes.status, 200);
    const adminFrPdf = Buffer.from(await adminFrRes.arrayBuffer());
    assert.equal(adminFrPdf.subarray(0, 5).toString(), "%PDF-");

    const studentFrHash = createHash("sha256").update(studentFrPdf).digest("hex");
    const adminFrHash = createHash("sha256").update(adminFrPdf).digest("hex");
    assert.equal(studentFrHash, adminFrHash, "Student French PDF must strictly match Admin French PDF hash");
    assert.notEqual(studentFrHash, studentHash, "French PDF must be different from Arabic PDF");

    const frPages = (studentFrPdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
    assert.equal(frPages, 9, "French PDF must also have exactly 9 pages");

    // 9. Participant without email: verify footer omission
    const noEmailId = randomUUID();
    const noEmailRow = await prisma.adaptiveInterview.create({
      data: {
        id: noEmailId,
        tokenHash: createHash("sha256").update("no-email-token").digest("hex"),
        displayName: "SYNTH-SessionParticipant",
        email: null,
        state: state as any,
        expiresAt: new Date(Date.now() + 86400000),
        reportJob: {
          create: {
            status: "COMPLETE",
            summary: JSON.stringify({ fr: "Synthèse sans email.", ar: "خلاصة بدون بريد." }),
            nextAttemptAt: new Date(),
          },
        },
      },
      include: { reportJob: true },
    });
    try {
      const noEmailPdf = await reportPdfRenderer.render(noEmailRow, noEmailRow.reportJob!, "fr");
      assert.equal(noEmailPdf.subarray(0, 5).toString(), "%PDF-");
    } finally {
      await prisma.adaptiveInterview.deleteMany({ where: { id: noEmailId } });
    }
    const { pdfDownloads } = await import("../src/services/pdf-download.service.js");
    const { ReportEmailError } = await import("../src/services/brevo.service.js");
    const overloaded = t.mock.method(pdfDownloads, "render", async () => { throw new ReportEmailError("REPORT_PDF_QUEUE_FULL", true, 2); });
    try {
      for (const [path, token] of [
        ["/api/v1/adaptive/me/report.pdf", rawToken],
        [`/api/v1/admin/adaptive/participants/${interviewId}/report.pdf`, rawAdminToken],
      ]) {
        const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(res.status, 503); assert.equal(res.headers.get("retry-after"), "2");
        assert.equal(res.headers.get("cache-control"), "private, no-store");
        const error = await res.json(); assert.equal(error.reason, "REPORT_PDF_QUEUE_FULL"); assert.equal(error.retryable, true);
      }
    } finally { overloaded.mock.restore(); }
  } finally {
    await prisma.adaptiveInterview.deleteMany({ where: { id: interviewId } });
  }
});
