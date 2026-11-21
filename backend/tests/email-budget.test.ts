import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createIsolatedEmailDatabase } from "./helpers/isolated-email.js";
import { EmailBudget } from "../src/services/email-budget.service.js";
import { emailLimits } from "../src/services/email-limits.js";

let db: PGlite, socket: PGLiteSocketServer, client: PrismaClient, budget: EmailBudget;
let now = new Date("2026-10-30T12:00:00Z");
const h = "a".repeat(64), email = "synthetic@example.test";
const input = (purpose: "OTP" | "REPORT" = "OTP") => ({ key: randomUUID(), requestHash: h, recipient: email, purpose, networkOrigin: "127.0.0.1" });
async function connect() {
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 }); await socket.start();
  client = new PrismaClient({ datasourceUrl: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1` });
  budget = new EmailBudget(client, () => now);
}
before(async () => {
  const isolated = await createIsolatedEmailDatabase(); db = isolated.db;
  for (const name of isolated.names) await isolated.migrate(name);
  await connect();
  process.env.JOIN_CODE_PEPPER = "synthetic-budget-tests-only-0123456789abcdef";
}, { timeout: 60000 });
beforeEach(async () => {
  now = new Date("2026-10-30T12:00:00Z");
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300"; process.env.EMAIL_OTHER_USAGE_MARGIN = "60"; process.env.EMAIL_APP_DAILY_LIMIT = "240";
  process.env.OTP_IDENTITY_DAILY_FAILURES = "15"; process.env.OTP_IDENTITY_DAILY_SENDS = "5";
  process.env.OTP_NETWORK_DAILY_SENDS = "100"; process.env.OTP_GLOBAL_DAILY_SENDS = "120";
  await client.$executeRawUnsafe('TRUNCATE "EmailBudgetReservation", "EmailProviderState", "EmailAbuseCounter", "EmailOtpThrottle", "AdaptiveInterview" CASCADE');
});
after(async () => { await client?.$disconnect(); await socket?.stop(); await db?.close(); });

test("Configuration fails closed without declared account allowance and preserves margin", () => {
  assert.equal(emailLimits({}).dailyBudget, 0);
  assert.equal(emailLimits({ EMAIL_ACCOUNT_DAILY_LIMIT: "100", EMAIL_OTHER_USAGE_MARGIN: "60" }).dailyBudget, 40);
  assert.equal(emailLimits({ EMAIL_ACCOUNT_DAILY_LIMIT: "30" }).dailyBudget, 0);
  assert.throws(() => emailLimits({ EMAIL_ACCOUNT_DAILY_LIMIT: "NaN" }));
});

test("PGlite functional check: OTP and report share the last unit; rejected transaction leaves no partial counters", async () => {
  process.env.EMAIL_APP_DAILY_LIMIT = "1";
  const claims = await Promise.allSettled([budget.claim(input("OTP")), budget.claim(input("REPORT"))]);
  assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await client.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
  assert.equal((await client.$queryRawUnsafe<unknown[]>('SELECT * FROM "EmailBudgetReservation"')).length, 1);
  process.env.EMAIL_APP_DAILY_LIMIT = "240";
  process.env.OTP_IDENTITY_DAILY_SENDS = "0";
  const before = await client.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" ORDER BY scope,metric');
  await assert.rejects(budget.claim({ ...input(), recipient: "other@example.test" }), /EMAIL_LOCAL_LIMIT/);
  assert.deepEqual(await client.$queryRawUnsafe('SELECT * FROM "EmailAbuseCounter" ORDER BY scope,metric'), before);
});

test("Resends preserve cumulative failures and enforce 60-second cooldown", async () => {
  process.env.OTP_IDENTITY_DAILY_FAILURES = "2";
  const first = await budget.claim(input()); await budget.finish(first, { accepted: true });
  await assert.rejects(budget.claim(input()), /EMAIL_OTP_COOLDOWN/);
  const id = randomUUID();
  await client.$executeRawUnsafe(`INSERT INTO "AdaptiveInterview" (id,"tokenHash","displayName",email,state,"expiresAt","updatedAt","retakeCodeHash","retakeCodeExpiresAt")
    VALUES ($1::uuid,$2,'Synthetic',$3,'{}', $4,$5,$2,$4)`, id, h, email, new Date(now.getTime() + 600000), now);
  assert.equal(await budget.retakeAttempt({ id, hash: h, correct: false, email, networkOrigin: "127.0.0.1" }), true);
  now = new Date(now.getTime() + 60000);
  const resend = await budget.claim(input()); await budget.finish(resend, { accepted: true });
  // Model the existing resend replacing a code and resetting only per-code attempts.
  await client.$executeRawUnsafe('UPDATE "AdaptiveInterview" SET "retakeCodeAttempts"=0');
  assert.equal(await budget.retakeAttempt({ id, hash: h, correct: false, email, networkOrigin: "127.0.0.1" }), true);
  now = new Date(now.getTime() + 60000);
  await assert.rejects(budget.claim(input()), /EMAIL_LOCAL_LIMIT/);
  await assert.rejects(budget.retakeAttempt({ id, hash: h, correct: true, email }), /EMAIL_LOCAL_LIMIT/);
  assert.equal((await client.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE scope=\'IDENTITY\' AND metric=\'OTP_FAILURE\''))[0].count, 2);
});

test("Uncertain delivery reuses reservation, fences stale completions and stops after ten minutes", async () => {
  const request = input("REPORT"), a = await budget.claim(request);
  await assert.rejects(budget.claim(request), /EMAIL_SEND_BUSY/);
  await budget.finish(a, { uncertain: true });
  now = new Date(now.getTime() + 30000);
  const b = await budget.claim(request);
  await assert.rejects(budget.finish(a, { accepted: true }), /EMAIL_STALE_ATTEMPT/);
  await budget.finish(b, { code: "BREVO_RATE_LIMIT", retryAfterSeconds: 1 });
  assert.equal((await client.$queryRawUnsafe<{ status: string }[]>('SELECT status FROM "EmailBudgetReservation"'))[0].status, "UNCERTAIN");
  now = new Date(now.getTime() + 600000);
  await assert.rejects(budget.claim(request), /BREVO_ACCEPTANCE_UNKNOWN/);
  assert.equal((await client.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
  await assert.rejects(budget.claim({ ...request, requestHash: "b".repeat(64) }), /EMAIL_REQUEST_CHANGED/);
});

test("Address aliases, network and global OTP caps remain independent", async () => {
  process.env.OTP_IDENTITY_DAILY_SENDS = "1";
  const first = await budget.claim({ ...input(), recipient: "test.name+one@gmail.com" }); await budget.finish(first, { accepted: true });
  now = new Date(now.getTime() + 61000);
  await assert.rejects(budget.claim({ ...input(), recipient: "testname+two@googlemail.com" }), /EMAIL_LOCAL_LIMIT/);
  process.env.OTP_NETWORK_DAILY_SENDS = "1";
  await assert.rejects(budget.claim({ ...input(), recipient: "different@example.test" }), /EMAIL_LOCAL_LIMIT/);
  process.env.OTP_NETWORK_DAILY_SENDS = "100"; process.env.OTP_GLOBAL_DAILY_SENDS = "1";
  await assert.rejects(budget.claim({ ...input(), recipient: "third@example.test", networkOrigin: "127.0.0.2" }), /EMAIL_LOCAL_LIMIT/);
  assert.equal((await client.$queryRawUnsafe<unknown[]>('SELECT * FROM "EmailBudgetReservation"')).length, 1);
});

test("Uncertain send at UTC midnight retains its reservation without a second daily debit", async () => {
  now = new Date("2026-10-30T23:59:50Z");
  const request = input("REPORT"), claim = await budget.claim(request);
  await budget.finish(claim, { uncertain: true });
  now = new Date("2026-10-31T00:00:01Z");
  await assert.rejects(budget.claim(request), /BREVO_ACCEPTANCE_UNKNOWN/);
  const rows = await client.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\'');
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 1);
});

test("429 and quota circuit breakers are shared by service instances and never shortened", async () => {
  const a = await budget.claim(input("REPORT")), b = await budget.claim(input("REPORT"));
  await budget.finish(a, { code: "BREVO_QUOTA", retryAfterSeconds: 86400 });
  await budget.finish(b, { code: "BREVO_RATE_LIMIT", retryAfterSeconds: 60 });
  const other = new EmailBudget(client, () => now);
  await assert.rejects(other.claim(input()), /BREVO_QUOTA/);
  const state = (await client.$queryRawUnsafe<{ blockedUntil: Date }[]>('SELECT "blockedUntil" FROM "EmailProviderState"'))[0];
  assert.equal(state.blockedUntil.getTime(), now.getTime() + 86400000);
});

test("PGlite storage reload: counters, uncertain reservations and breaker survive database and client recreation", { timeout: 30000 }, async () => {
  const request = input("REPORT"), claim = await budget.claim(request);
  await budget.finish(claim, { uncertain: true, code: "BREVO_RATE_LIMIT", retryAfterSeconds: 60 });
  await client.$disconnect(); await socket.stop();
  const snapshot = await db.dumpDataDir(); await db.close();
  db = await PGlite.create({ loadDataDir: snapshot }); await connect();
  await assert.rejects(budget.claim(input()), /BREVO_RATE_LIMIT/);
  now = new Date(now.getTime() + 61000);
  const retried = await budget.claim(request); await budget.finish(retried, { accepted: true });
  assert.equal((await client.$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
  assert.equal((await budget.claim(request)).duplicate, true);
});
