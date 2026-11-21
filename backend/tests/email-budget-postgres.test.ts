// Optional native PostgreSQL validation. Never accepts DATABASE_URL or a DSN.
// LOT2_POSTGRES_BIN must point to a local directory containing the server tools.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { EmailBudget } from "../src/services/email-budget.service.js";

const bin = process.env.LOT2_POSTGRES_BIN;
const options = { skip: bin ? false : "Native PostgreSQL unavailable: set LOT2_POSTGRES_BIN to local initdb/pg_ctl/psql tools; PGlite is not a substitute", timeout: 60000 };
const run = promisify(execFile);
let owned: string, tempRoot: string, data: string, started = false;
let port: number, datasourceUrl: string;
let clients: PrismaClient[] = [], services: EmailBudget[] = [];
let now = new Date("2026-10-30T12:00:00Z");
const h = "a".repeat(64);
const input = (purpose: "OTP" | "REPORT") => ({ key: randomUUID(), requestHash: h, recipient: "native@example.test", purpose, networkOrigin: "127.0.0.1" });
const exe = (name: string) => join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
async function command(name: string, args: string[]) {
  try {
    return await run(exe(name), args, { windowsHide: true, timeout: 60000, env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    } });
  } catch { throw new Error(`Isolated PostgreSQL ${name} failed; no application connection settings were used`); }
}

before(async () => {
  if (!bin) return;
  for (const name of ["initdb", "pg_ctl", "psql"]) assert.ok(existsSync(exe(name)), `Missing local ${name}`);
  tempRoot = await realpath(tmpdir()); owned = await mkdtemp(join(tempRoot, "skillquest-lot2-pg-")); data = join(owned, "data");
  await command("initdb", ["-D", data, "-U", "lot2_synthetic", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
  const server = createServer(); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
  await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
  await command("pg_ctl", ["-D", data, "-l", join(owned, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -c timezone=UTC`, "-w", "start"]); started = true;
  datasourceUrl = `postgresql://lot2_synthetic@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable`;
  clients = [new PrismaClient({ datasourceUrl }), new PrismaClient({ datasourceUrl })];
  const destination = (await clients[0].$queryRawUnsafe<{ directory: string; tables: number }[]>(`SELECT current_setting('data_directory') AS directory,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables`))[0];
  assert.equal(await realpath(destination.directory), await realpath(data)); assert.equal(destination.tables, 0);
  // Migration destination was verified against our freshly initialized directory.
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of (await readdir(migrations, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await command("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "lot2_synthetic", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(new URL(entry.name + "/migration.sql", migrations))]);
  }
  process.env.JOIN_CODE_PEPPER = "native-synthetic-only-0123456789abcdefgh";
  services = clients.map(client => new EmailBudget(client, () => now));
}, { timeout: 180000 });

beforeEach(async () => {
  if (!bin) return;
  now = new Date("2026-10-30T12:00:00Z");
  process.env.EMAIL_ACCOUNT_DAILY_LIMIT = "300"; process.env.EMAIL_OTHER_USAGE_MARGIN = "60"; process.env.EMAIL_APP_DAILY_LIMIT = "240";
  await clients[0].$executeRawUnsafe('TRUNCATE "EmailBudgetReservation", "EmailProviderState", "EmailAbuseCounter", "EmailOtpThrottle"');
});
after(async () => {
  for (const client of clients) await client.$disconnect();
  if (started) { await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); started = false; }
  // Delete only the generated, verified synthetic cluster; never an input path.
  if (owned) { const target = resolve(owned); assert.ok(target.startsWith(tempRoot + sep + "skillquest-lot2-pg-")); await rm(target, { recursive: true }); }
});

test("Native PostgreSQL: distinct connections competing for last credit accept exactly one OTP/report", options, async () => {
  const pids = await Promise.all(clients.map(c => c.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid')));
  assert.notEqual(pids[0][0].pid, pids[1][0].pid);
  process.env.EMAIL_APP_DAILY_LIMIT = "1";
  const results = await Promise.allSettled([services[0].claim(input("OTP")), services[1].claim(input("REPORT"))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await clients[0].$queryRawUnsafe<unknown[]>('SELECT * FROM "EmailBudgetReservation"')).length, 1);
  assert.equal((await clients[0].$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
});

test("Native PostgreSQL: simultaneous same-key claims fence transport and transitions", options, async () => {
  const request = input("REPORT");
  const results = await Promise.allSettled(services.map(s => s.claim(request)));
  const successes = results.filter(r => r.status === "fulfilled"); assert.equal(successes.length, 1);
  const first = successes[0]; assert.equal(first.status, "fulfilled"); if (first.status !== "fulfilled") return;
  await services[0].finish(first.value, { uncertain: true });
  const second = await services[1].claim(request);
  await assert.rejects(services[0].finish(first.value, { accepted: true }), /EMAIL_STALE_ATTEMPT/);
  await services[1].finish(second, { accepted: true });
  assert.equal((await services[0].claim(request)).duplicate, true);
});

test("Native PostgreSQL: server and client restart retain budget and shared 429 breaker", options, async () => {
  const request = input("REPORT"), claim = await services[0].claim(request);
  await services[0].finish(claim, { uncertain: true, code: "BREVO_RATE_LIMIT", retryAfterSeconds: 60 });
  for (const client of clients) await client.$disconnect();
  await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); started = false;
  await command("pg_ctl", ["-D", data, "-l", join(owned, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -c timezone=UTC`, "-w", "start"]); started = true;
  clients = [new PrismaClient({ datasourceUrl }), new PrismaClient({ datasourceUrl })];
  services = clients.map(client => new EmailBudget(client, () => now));
  await assert.rejects(services[0].claim(input("OTP")), /BREVO_RATE_LIMIT/);
  now = new Date(now.getTime() + 61000);
  const retry = await services[0].claim(request); await services[0].finish(retry, { accepted: true });
  assert.equal((await clients[1].$queryRawUnsafe<{ count: number }[]>('SELECT count FROM "EmailAbuseCounter" WHERE metric=\'EMAIL_UNITS\''))[0].count, 1);
});
