import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { chromium } from "playwright";

// All services and data are temporary, local, and owned by this test process.
const project = fileURLToPath(new URL("../../", import.meta.url)),
  db = await PGlite.create();
const migrations = new URL("../prisma/migrations/", import.meta.url);
for (const name of (await readdir(migrations))
  .filter((n) => n !== "migration_lock.toml")
  .sort())
  await db.exec(
    await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"),
  );
const socket = new PGLiteSocketServer({
  db,
  port: 0,
  host: "127.0.0.1",
  maxConnections: 4,
});
await socket.start();
process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1`;
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JOIN_CODE_PEPPER = "browser-test-only-pepper-0123456789abcdef";
process.env.NODE_ENV = "test";
process.env.GROQ_API_KEY = "";
process.env.BREVO_API_KEY = "";
process.env.ALLOW_DEMO_SEED = "true";
process.env.ADMIN_EMAIL = "browser-teacher@example.test";
process.env.ADMIN_PASSWORD = "Browser-tests-only-2026!";
process.env.SEED_SESSION_CODE = "SQ-BROWSER-TEST";
await import("../prisma/seed.js");
assert.notEqual(process.exitCode, 1, "The isolated demo seed must succeed");
const { prisma } = await import("../src/db/prisma.js"),
  { app } = await import("../src/app.js");
const http = app.listen(0, "127.0.0.1");
await once(http, "listening");
const addr = http.address();
if (!addr || typeof addr === "string") throw Error("No HTTP port");
const { createServer } = await import("node:net");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const webAddr = reservation.address();
if (!webAddr || typeof webAddr === "string") throw Error("No web port");
const webPort = webAddr.port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = `http://127.0.0.1:${webPort}`;
const web = spawn(
  process.execPath,
  [
    `${project}node_modules/next/dist/bin/next`,
    "start",
    "-p",
    String(webPort),
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: `${project}frontend`,
    env: {
      ...process.env,
      NODE_ENV: "production",
      API_INTERNAL_URL: `http://127.0.0.1:${addr.port}`,
      PUBLIC_APP_ORIGIN: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let webLog = "";
web.stdout.on("data", (d) => (webLog += d.toString()));
web.stderr.on("data", (d) => (webLog += d.toString()));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const checks: string[] = [],
  errors: string[] = [];
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 99) throw Error(webLog);
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const output = process.env.SMOKE_OUTPUT_DIR;
  if (output) await mkdir(output, { recursive: true });
  const { runAdaptiveBrowserChecks } = await import('./browser-adaptive-checks.js');
  const result = await runAdaptiveBrowserChecks(browser, origin, prisma, output);
  if (output) await writeFile(output + '/browser-checks.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  const { runRetakeBrowserChecks } = await import("./browser-retake-checks.js");
  await runRetakeBrowserChecks(browser, origin, prisma, output);
} finally {
  await browser?.close();
  web.kill("SIGTERM");
  http.closeAllConnections();
  await new Promise<void>((r) => http.close(() => r()));
  await prisma.$disconnect();
  await socket.stop();
  await db.close();
}
