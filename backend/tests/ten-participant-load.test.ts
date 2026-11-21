import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";

// Opt-in only: the launcher owns and verifies a freshly initialized native PG cluster.
test("ten concurrent participants on isolated native PostgreSQL", {
  skip: process.env.SKILLQUEST_LOAD_TEST !== "1", timeout: 360000,
}, async t => {
  const owned = await connectLot4NativeDatabase();
  await owned.client.$disconnect();
  Object.assign(process.env, {
    NODE_ENV: "test", DOTENV_CONFIG_PATH: "__disabled__", JOIN_CODE_PEPPER: "load-five-local-only-0123456789abcdef",
    GROQ_API_KEY: "", BREVO_API_KEY: "", QSTASH_TOKEN: "", QSTASH_CURRENT_SIGNING_KEY: "", QSTASH_NEXT_SIGNING_KEY: "", EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_APP_DAILY_LIMIT: "50",
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
  const records: { phase: string; status: number; ms: number; expected: boolean; code?: string; reason?: string; retryAfter?: string | null }[] = [];
  const findings: Record<string, unknown> = {};
  const pdfs: unknown[] = [];
  let peakRss = process.memoryUsage().rss, peakHeap = process.memoryUsage().heapUsed;
  const sampler = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 25);
  const cpu = process.cpuUsage(), started = performance.now();
  async function request(phase: string, path: string, body?: unknown, token?: string, expected = [200]) {
    const at = performance.now();
    let recorded = false;
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(65000), method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const bytes = Buffer.from(await res.arrayBuffer());
      const json = res.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null;
      records.push({ phase, status: res.status, ms: performance.now() - at, expected: expected.includes(res.status), code: json?.code, reason: json?.reason, retryAfter: res.headers.get("retry-after") });
      recorded = true;
      assert.ok(expected.includes(res.status), `${phase}: ${res.status} ${json ? JSON.stringify(json) : bytes.toString().slice(0, 300)}`);
      return { status: res.status, body: json, bytes, retryAfter: res.headers.get("retry-after"), finishedAt: performance.now() };
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
      return prisma.assessmentSession.create({ data: { label: `SYNTH-${code}`, createdById: admin.id, status: "OPEN", maxParticipants: 10, codeHash: hashJoinCode(code), codeCipher: encryptCode(code) } });
    }
    const primary = await session("LOAD10");
    const joined = await Promise.all(Array.from({ length: 10 }, (_, i) => request("join-ten", "/sessions/join", { registrationId: crypto.randomUUID(), code: "LOAD10", displayName: `SYNTH-Load-${i}`, language: i % 2 ? "ar" : "fr" }, undefined, [201])));
    const people = joined.map((r, i) => ({ token: r.body.token as string, id: r.body.interview.id as string, view: r.body.interview, expected: [] as { questionId: string; choiceId: string }[], language: i % 2 ? "ar" : "fr" }));
    assert.equal(new Set(people.map(p => p.id)).size, 10);
    assert.equal(new Set(people.map(p => p.token)).size, 10);
    async function countSession(id: string) {
      assert.equal(await prisma.adaptiveInterview.count({ where: { sessionId: id } }), 10);
      assert.equal(await prisma.participant.count({ where: { sessionId: id } }), 10);
    }
    await countSession(primary.id);
    // Explicit synthetic email/opt-in fixtures, added locally after code-based join.
    // This is not an OTP registration test; the existing OTP suite remains separate.
    for (let i = 0; i < people.length; i++) await prisma.adaptiveInterview.update({ where: { id: people[i].id }, data: { email: 'load-' + i + '@example.test', reportEmailRequested: true } });
    await request("capacity-full", "/sessions/join", { registrationId: crypto.randomUUID(), code: "LOAD10", displayName: "SYNTH-Eleventh", language: "fr" }, undefined, [409]);
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
        findings.resume = "10/10 after HTTP listener restart, Prisma disconnect and loss of client views at answer 11; process not restarted";
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
    findings.answers = { participants: 10, persistedAnswers: seenQuestions.size, isolated: true, distinctSkillsEach: 31, duplicateReplayRejected: 10, concurrentDuplicateRejected: 10 };
    const summaries = await Promise.all(people.map(p => request("summary", "/adaptive/me/summary", {}, p.token)));
    for (let i = 0; i < people.length; i++) {
      assert.equal(summaries[i].body.report.skills.length, 31);
      const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: people[i].id } });
      assert.equal(job.status, "COMPLETE"); assert.equal(job.attempts, 1);
      assert.match(JSON.parse(job.summary!).fr, /sans appel IA/);
    }
    const beforePdfs = await prisma.adaptiveInterview.findMany({ where: { id: { in: people.map(p => p.id) } }, include: { reportJob: true }, orderBy: { id: "asc" } });
    async function batchPdf(phase: string, admin = false) {
      const started = performance.now();
      const results = await Promise.all(people.map(p => request(phase, admin ? '/admin/adaptive/participants/' + p.id + '/report.pdf' : '/adaptive/me/report.pdf', undefined, admin ? adminToken : p.token, [200, 503])));
      const attempts = people.map(() => 1);
      const initialRefusals = results.filter(r => r.status === 503).length;
      for (let wave = 1; wave <= 2; wave++) {
        const pending = results.map((r, i) => ({ r, i })).filter(({r}) => r.status === 503);
        if (!pending.length) break;
        for (const {r} of pending) {
          assert.equal(r.body.code, 'PDF_UNAVAILABLE'); assert.equal(r.body.retryable, true);
          assert.ok(['REPORT_PDF_QUEUE_FULL', 'REPORT_PDF_WAIT_TIMEOUT'].includes(r.body.reason));
          assert.match(r.retryAfter!, /^\d+$/); assert.ok(Number(r.retryAfter) > 0 && Number(r.retryAfter) <= 20);
        }
        // Retry only rejected requests, after the previous wave settled. Never more than 3 HTTP attempts per participant.
        const pause = Math.max(1000 * 2 ** (wave - 1), ...pending.map(({r}) => Number(r.retryAfter) * 1000));
        await new Promise(resolve => setTimeout(resolve, pause));
        await Promise.all(pending.map(async ({i}) => {
          attempts[i]++;
          results[i] = await request(phase + '-retry', admin ? '/admin/adaptive/participants/' + people[i].id + '/report.pdf' : '/adaptive/me/report.pdf', undefined, admin ? adminToken : people[i].token, [200, 503]);
        }));
      }
      assert.ok(results.every(r => r.status === 200), 'Bounded retries must obtain every PDF');
      const completionMs = results.map(r => r.finishedAt - started).sort((a,b) => a-b);
      findings[phase] = { initialRefusals, successes: 10, attempts, completionMeanMs: completionMs.reduce((a,b)=>a+b,0)/10, completionP95Ms: completionMs[9], completionMaxMs: completionMs[9] };
      return results;
    }
    const burst = await batchPdf('pdf-burst');
    const adminBurst = await batchPdf('pdf-admin-burst', true);
    for (let i = 0; i < people.length; i++) assert.deepEqual(adminBurst[i].bytes, burst[i].bytes);
    const afterPdfs = await prisma.adaptiveInterview.findMany({ where: { id: { in: people.map(p => p.id) } }, include: { reportJob: true }, orderBy: { id: "asc" } });
    assert.deepEqual(afterPdfs, beforePdfs, "PDF generation must not mutate answers, summaries or jobs");
    for (let i = 0; i < people.length; i++) {
      const res = burst[i].status === 200 ? burst[i] : await request("pdf-sequential-retry", "/adaptive/me/report.pdf", undefined, people[i].token);
      const pages = (res.bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
      assert.equal(pages, 9);
      pdfs.push({ participant: i, language: people[i].language, pages, bytes: res.bytes.length, sha256: createHash("sha256").update(res.bytes).digest("hex") });
    }
    const { processReportEmails } = await import('../src/services/report-email-queue.service.js');
    const { openSyntheticMail } = await import('../src/security/synthetic-staging.js');
    const emailDurationsMs: number[] = [];
    for (let i = 0; i < people.length; i++) {
      const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { interviewId: people[i].id } });
      const captures: Buffer[] = [], original = Buffer.prototype.toString;
      const spy = t.mock.method(Buffer.prototype, 'toString', function(this: Buffer, ...args: Parameters<Buffer['toString']>) {
        if (args[0] === 'base64' && original.call(this, 'ascii', 0, 5) === '%PDF-') captures.push(Buffer.from(this));
        return original.apply(this, args);
      });
      const start = performance.now();
      try { await processReportEmails(job.id); } finally { spy.mock.restore(); }
      emailDurationsMs.push(performance.now() - start);
      assert.equal(captures.length, 1); assert.deepEqual(captures[0], burst[i].bytes);
      const mail = await prisma.$queryRawUnsafe<{ciphertext: string}[]>('SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid', job.id);
      assert.equal(mail.length, 1);
      const message = openSyntheticMail(job.id, mail[0].ciphertext) as any;
      assert.equal(message.simulated, true); assert.equal(message.attachments[0].bytes, captures[0].length);
      assert.equal(message.htmlContent.match(/<section /g)?.length, 31);
      const saved = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(saved.emailStatus, 'SENT'); assert.equal(saved.emailAttempts, 1); assert.equal(saved.summary, job.summary);
      const persisted = await prisma.adaptiveInterview.findUniqueOrThrow({ where: { id: people[i].id } });
      assert.deepEqual(persisted.state, beforePdfs.find(p => p.id === people[i].id)!.state);
    }
    findings.email = { simulated: 10, sha256EqualAcrossThreeChannels: true, skillsPerReport: 31, emailDurationsMs };
    const limited = await session("RACE11");
    const race = await Promise.all(Array.from({ length: 11 }, (_, i) => request("eleven-for-ten", "/sessions/join", { registrationId: crypto.randomUUID(), code: "RACE11", displayName: `SYNTH-Race-${i}`, language: "fr" }, undefined, [201, 409])));
    assert.equal(race.filter(r => r.status === 201).length, 10); assert.equal(race.filter(r => r.status === 409).length, 1);
    await countSession(limited.id); await countSession(primary.id);
    findings.capacityRace = { attempted: 11, admitted: 10, refused: 1, persisted: 10 };
    assert.equal(await prisma.adaptiveReportJob.count({ where: { interviewId: { in: people.map(p => p.id) } } }), 10);
    assert.equal((await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count(*) AS count FROM "SyntheticMail"'))[0].count, 10n);
    assert.equal(externalAttempts, 0);
    findings.completed = true;
  } catch (error) {
    findings.failure = error instanceof Error ? error.stack : String(error); throw error;
  } finally {
    clearInterval(sampler);
    const elapsedMs = performance.now() - started, usedCpu = process.cpuUsage(cpu);
    const stats = (rows: typeof records) => {
      const sorted = rows.map(r => r.ms).sort((a, b) => a - b);
      return { requests: rows.length, meanMs: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1), maxMs: sorted.at(-1) ?? 0, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? 0, success2xx: rows.filter(r => r.status >= 200 && r.status < 300).length, non2xx: rows.filter(r => r.status < 200 || r.status >= 300).length, unexpected: rows.filter(r => !r.expected).length };
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
