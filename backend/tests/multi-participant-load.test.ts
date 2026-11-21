import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";

// Opt-in only: the launcher owns and verifies a freshly initialized native PG cluster.
test("five concurrent participants on isolated native PostgreSQL", {
  skip: process.env.SKILLQUEST_LOAD_TEST !== "1", timeout: 180000,
}, async () => {
  const owned = await connectLot4NativeDatabase();
  await owned.client.$disconnect();
  Object.assign(process.env, {
    NODE_ENV: "test", DOTENV_CONFIG_PATH: "__disabled__", JOIN_CODE_PEPPER: "load-five-local-only-0123456789abcdef",
    GROQ_API_KEY: "", BREVO_API_KEY: "", QSTASH_TOKEN: "", QSTASH_CURRENT_SIGNING_KEY: "", QSTASH_NEXT_SIGNING_KEY: "",
    SKILLQUEST_STAGING_MODE: "synthetic-v1", SKILLQUEST_DEPLOYMENT_PURPOSE: "synthetic-staging",
    SKILLQUEST_STAGING_ACK: "SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS", SKILLQUEST_STAGING_ID: randomUUID(),
    SKILLQUEST_STAGING_SECRET: Buffer.alloc(32, 93).toString("base64url"),
  });
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.$executeRawUnsafe('INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","databaseName") VALUES (1,$1::uuid,current_database())', process.env.SKILLQUEST_STAGING_ID);
  const { app } = await import("../src/app.js");
  const { hashJoinCode, encryptCode } = await import("../src/security/tokens.js");
  let server: Server, base = "";
  async function start() {
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  }
  async function stop() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const realFetch = globalThis.fetch;
  let externalAttempts = 0;
  globalThis.fetch = ((input, init) => {
    if (!String(input).startsWith(base + "/")) { externalAttempts++; throw Error("EXTERNAL_NETWORK_FORBIDDEN"); }
    return realFetch(input, init);
  }) as typeof fetch;
  const records: { phase: string; status: number; ms: number; expected: boolean; code?: string }[] = [];
  const findings: Record<string, unknown> = {};
  const pdfs: unknown[] = [];
  let peakRss = process.memoryUsage().rss, peakHeap = process.memoryUsage().heapUsed;
  const sampler = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 25);
  const cpu = process.cpuUsage(), started = performance.now();
  async function request(phase: string, path: string, body?: unknown, token?: string, expected = [200]) {
    const at = performance.now();
    let recorded = false;
    try {
      const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const bytes = Buffer.from(await res.arrayBuffer());
      const json = res.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null;
      records.push({ phase, status: res.status, ms: performance.now() - at, expected: expected.includes(res.status), code: json?.code });
      recorded = true;
      assert.ok(expected.includes(res.status), `${phase}: ${res.status} ${json ? JSON.stringify(json) : bytes.toString().slice(0, 300)}`);
      return { status: res.status, body: json, bytes };
    } catch (error) {
      if (!recorded) records.push({ phase, status: 0, ms: performance.now() - at, expected: false });
      throw error;
    }
  }
  try {
    await start();
    const admin = await prisma.user.create({ data: { email: "load-admin@example.test", role: "ADMIN" } });
    const adminToken = "a".repeat(64);
    const { hashAdminToken } = await import("../src/security/adminAuth.js");
    await prisma.adminSession.create({ data: { userId: admin.id, tokenHash: hashAdminToken(adminToken), expiresAt: new Date(Date.now() + 3600000) } });
    async function session(code: string) {
      return prisma.assessmentSession.create({ data: { label: `SYNTH-${code}`, createdById: admin.id, status: "OPEN", maxParticipants: 5, codeHash: hashJoinCode(code), codeCipher: encryptCode(code) } });
    }
    const primary = await session("LOAD05");
    const joined = await Promise.all(Array.from({ length: 5 }, (_, i) => request("join-five", "/sessions/join", { registrationId: crypto.randomUUID(), code: "LOAD05", displayName: `SYNTH-Load-${i}`, language: i % 2 ? "ar" : "fr" }, undefined, [201])));
    const people = joined.map((r, i) => ({ token: r.body.token as string, id: r.body.interview.id as string, view: r.body.interview, expected: [] as { questionId: string; choiceId: string }[], language: i % 2 ? "ar" : "fr" }));
    assert.equal(new Set(people.map(p => p.id)).size, 5);
    assert.equal(new Set(people.map(p => p.token)).size, 5);
    async function countSession(id: string) {
      assert.equal(await prisma.adaptiveInterview.count({ where: { sessionId: id } }), 5);
      assert.equal(await prisma.participant.count({ where: { sessionId: id } }), 5);
    }
    await countSession(primary.id);
    await request("capacity-full", "/sessions/join", { registrationId: crypto.randomUUID(), code: "LOAD05", displayName: "SYNTH-Sixth", language: "fr" }, undefined, [409]);
    const foreign = people[0].view.currentQuestion;
    await request("isolation-rejection", "/adaptive/answer", { questionId: foreign.id, choiceId: foreign.choices[0].id }, people[1].token, [409]);
    for (let round = 0; round < 31; round++) {
      await Promise.all(people.map(async (p, i) => {
        const q = p.view.currentQuestion;
        const answer = { questionId: q.id, choiceId: q.choices[(i + round) % 4].id };
        p.expected.push(answer);
        let res;
        if (round === 6) {
          const pair = await Promise.all([0, 1].map(() => request("concurrent-double-submit", "/adaptive/answer", answer, p.token, [200, 409])));
          assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
          res = pair.find(r => r.status === 200)!;
        } else res = await request("answer", "/adaptive/answer", answer, p.token);
        p.view = res.body;
        assert.equal(p.view.answeredCount, round + 1);
      }));
      if (round === 6) {
        await Promise.all(people.map(p => request("duplicate-replay", "/adaptive/answer", p.expected[6], p.token, [409])));
      }
      if (round === 10) {
        // Lose all client views and server connections; retain only bearer tokens.
        const checkpoints = people.map(p => p.view.currentQuestion.id);
        people.forEach(p => { p.view = null; });
        await stop(); await prisma.$disconnect(); await start();
        await Promise.all(people.map(async (p, i) => {
          p.view = (await request("resume", "/adaptive/me", undefined, p.token)).body;
          assert.equal(p.view.answeredCount, 11); assert.equal(p.view.currentQuestion.id, checkpoints[i]);
        }));
        findings.resume = "5/5 after HTTP listener restart, Prisma disconnect and loss of client views at answer 11; process not restarted";
      }
    }
    const seenQuestions = new Set<string>();
    for (const p of people) {
      const saved = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: p.id } });
      const state = saved.state as any;
      assert.equal(state.answers.length, 31); assert.equal(state.currentQuestion, null);
      assert.equal(new Set(state.answers.map((a: any) => a.question.skillId)).size, 31);
      assert.deepEqual(state.answers.map((a: any) => ({ questionId: a.question.id, choiceId: a.choiceId })), p.expected);
      for (const a of state.answers) { assert.ok(!seenQuestions.has(a.question.id)); seenQuestions.add(a.question.id); }
    }
    findings.answers = { participants: 5, persistedAnswers: seenQuestions.size, isolated: true, distinctSkillsEach: 31, duplicateReplayRejected: 5, concurrentDuplicateRejected: 5 };
    const summaries = await Promise.all(people.map(p => request("summary", "/adaptive/me/summary", {}, p.token)));
    for (let i = 0; i < people.length; i++) {
      assert.equal(summaries[i].body.report.skills.length, 31);
      const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: people[i].id } });
      assert.equal(job.status, "COMPLETE"); assert.equal(job.attempts, 1);
      assert.match(JSON.parse(job.summary!).fr, /sans appel IA/);
    }
    const beforePdfs = await prisma.adaptiveInterview.findMany({ where: { id: { in: people.map(p => p.id) } }, include: { reportJob: true }, orderBy: { id: "asc" } });
    const burst = await Promise.all(people.map(p => request("pdf-burst", "/adaptive/me/report.pdf", undefined, p.token, [200])));
    findings.pdfBurst = { succeeded: burst.filter(r => r.status === 200).length, busy: burst.filter(r => r.status === 503).length };
    assert.equal(burst.filter(r => r.status === 200).length, 5);
    const adminBurst = await Promise.all(people.map(p => request("pdf-admin-burst", `/admin/adaptive/participants/${p.id}/report.pdf`, undefined, adminToken, [200])));
    for (let i = 0; i < people.length; i++) assert.deepEqual(adminBurst[i].bytes, burst[i].bytes, "Concurrent student/admin downloads must remain byte-identical");
    findings.adminPdfBurst = { succeeded: adminBurst.length, byteIdenticalToStudent: true };
    const afterPdfs = await prisma.adaptiveInterview.findMany({ where: { id: { in: people.map(p => p.id) } }, include: { reportJob: true }, orderBy: { id: "asc" } });
    assert.deepEqual(afterPdfs, beforePdfs, "PDF generation must not mutate answers, summaries or jobs");
    for (let i = 0; i < people.length; i++) {
      const res = burst[i].status === 200 ? burst[i] : await request("pdf-sequential-retry", "/adaptive/me/report.pdf", undefined, people[i].token);
      const pages = (res.bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
      assert.equal(pages, 9);
      pdfs.push({ participant: i, language: people[i].language, pages, bytes: res.bytes.length, sha256: createHash("sha256").update(res.bytes).digest("hex") });
    }
    const limited = await session("RACE06");
    const race = await Promise.all(Array.from({ length: 6 }, (_, i) => request("six-for-five", "/sessions/join", { registrationId: crypto.randomUUID(), code: "RACE06", displayName: `SYNTH-Race-${i}`, language: "fr" }, undefined, [201, 409])));
    assert.equal(race.filter(r => r.status === 201).length, 5); assert.equal(race.filter(r => r.status === 409).length, 1);
    await countSession(limited.id); await countSession(primary.id);
    findings.capacityRace = { attempted: 6, admitted: 5, refused: 1, persisted: 5 };
    assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: { in: people.map(p => p.id) } } }), 5);
    assert.equal((await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count(*) AS count FROM "SyntheticMail"'))[0].count, 0n);
    assert.equal(externalAttempts, 0);
    findings.completed = true;
  } catch (error) {
    findings.failure = error instanceof Error ? error.stack : String(error); throw error;
  } finally {
    clearInterval(sampler);
    const elapsedMs = performance.now() - started, usedCpu = process.cpuUsage(cpu);
    const stats = (rows: typeof records) => {
      const sorted = rows.map(r => r.ms).sort((a, b) => a - b);
      return { requests: rows.length, meanMs: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1), p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? 0, success2xx: rows.filter(r => r.status >= 200 && r.status < 300).length, non2xx: rows.filter(r => r.status < 200 || r.status >= 300).length, unexpected: rows.filter(r => !r.expected).length };
    };
    const postgresLog = await readFile(join(owned.context.root, "postgres.log"), "utf8");
    const result = { at: new Date().toISOString(), database: "isolated native PostgreSQL; pool=4", findings, pdfs,
      overall: stats(records), byPhase: Object.fromEntries([...new Set(records.map(r => r.phase))].map(phase => [phase, stats(records.filter(r => r.phase === phase))])),
      resources: { elapsedMs, cpuUserMs: usedCpu.user / 1000, cpuSystemMs: usedCpu.system / 1000, cpuPercentOneCore: (usedCpu.user + usedCpu.system) / elapsedMs / 10, peakRssMiB: peakRss / 1048576, peakHeapMiB: peakHeap / 1048576, scope: "Node application + load driver only; excludes PostgreSQL and Chromium children; 25ms samples" },
      postgresErrors: postgresLog.split(/\r?\n/).filter(line => /\b(ERROR|FATAL|PANIC):/.test(line)), externalAttempts, records };
    await writeFile(join(owned.context.root, "load-results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ overall: result.overall, findings, resources: result.resources, postgresErrors: result.postgresErrors }));
    globalThis.fetch = realFetch;
    if (server!?.listening) await stop();
    await prisma.$disconnect();
  }
});
