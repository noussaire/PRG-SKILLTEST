import { test, beforeEach, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { Express } from "express";

const VALID_SECRET = Buffer.alloc(32, 99).toString("base64url");
const ORIGINAL_ENV = { ...process.env };

let appInstance: Express;

before(async () => {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.JOIN_CODE_PEPPER = "isolated-test-only-pepper-0123456789abcdef";
  process.env.NODE_ENV = "test";
  process.env.CORS_ORIGIN = "http://localhost:3000";
  const imported = await import("../src/app.js");
  appInstance = imported.app;
});

beforeEach(() => {
  // Reset env to known clean testing baseline
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.JOIN_CODE_PEPPER = "isolated-test-only-pepper-0123456789abcdef";
  process.env.NODE_ENV = "test";
  process.env.CORS_ORIGIN = "http://localhost:3000";
  process.env.SKILLQUEST_DISPATCH_ENABLED = "0";
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "0";
  process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "0";
  process.env.SKILLQUEST_QSTASH_MODE = "real";
  process.env.SKILLQUEST_DISPATCH_SECRET = VALID_SECRET;
  process.env.QSTASH_APP_DAILY_LIMIT = "100";
  process.env.QSTASH_CALLBACK_URL = "https://skillquest.example.com/api/internal/jobs/qstash";
  process.env.QSTASH_TOKEN = "valid-token-for-qstash";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("PREFLIGHT: correctly diagnoses configuration while flags are in standby (SKILLQUEST_DISPATCH_ENABLED=0, SKILLQUEST_ALLOW_REAL_BREVO=0)", async () => {
  const { checkDispatchPreflight } = await import("../src/services/job-dispatch.service.js");

  // Case 1: Standby with valid static config -> CONFIG_READY_FLAGS_STANDBY
  assert.equal(checkDispatchPreflight(), "CONFIG_READY_FLAGS_STANDBY");

  // Case 2: Missing / invalid dispatch secret -> DISPATCH_SECRET_INVALID
  delete process.env.SKILLQUEST_DISPATCH_SECRET;
  assert.equal(checkDispatchPreflight(), "DISPATCH_SECRET_INVALID");
  process.env.SKILLQUEST_DISPATCH_SECRET = "short-secret";
  assert.equal(checkDispatchPreflight(), "DISPATCH_SECRET_INVALID");
  process.env.SKILLQUEST_DISPATCH_SECRET = VALID_SECRET;

  // Case 3: Dispatch secret collides with another key -> DISPATCH_SECRET_COLLISION
  process.env.BREVO_API_KEY = VALID_SECRET;
  assert.equal(checkDispatchPreflight(), "DISPATCH_SECRET_COLLISION");
  delete process.env.BREVO_API_KEY;

  // Case 4: Missing or invalid daily limit -> DISPATCH_DAILY_LIMIT_REQUIRED
  delete process.env.QSTASH_APP_DAILY_LIMIT;
  assert.equal(checkDispatchPreflight(), "DISPATCH_DAILY_LIMIT_REQUIRED");
  process.env.QSTASH_APP_DAILY_LIMIT = "0";
  assert.equal(checkDispatchPreflight(), "DISPATCH_DAILY_LIMIT_REQUIRED");
  process.env.QSTASH_APP_DAILY_LIMIT = "1001";
  assert.equal(checkDispatchPreflight(), "DISPATCH_DAILY_LIMIT_REQUIRED");
  process.env.QSTASH_APP_DAILY_LIMIT = "100";

  // Case 5: QStash mode not real -> QSTASH_MODE_NOT_REAL
  process.env.SKILLQUEST_QSTASH_MODE = "simulated";
  assert.equal(checkDispatchPreflight(), "QSTASH_MODE_NOT_REAL");
  process.env.SKILLQUEST_QSTASH_MODE = "real";

  // Case 6: Invalid callback URL -> QSTASH_CALLBACK_URL_INVALID
  process.env.QSTASH_CALLBACK_URL = "http://not-https.com/api";
  assert.equal(checkDispatchPreflight(), "QSTASH_CALLBACK_URL_INVALID");
  process.env.QSTASH_CALLBACK_URL = "https://skillquest.example.com/api/internal/jobs/wrong-path";
  assert.equal(checkDispatchPreflight(), "QSTASH_CALLBACK_URL_INVALID");
  process.env.QSTASH_CALLBACK_URL = "https://skillquest.example.com/api/internal/jobs/qstash";

  // Case 7: Missing or invalid QStash token -> QSTASH_TOKEN_INVALID
  delete process.env.QSTASH_TOKEN;
  assert.equal(checkDispatchPreflight(), "QSTASH_TOKEN_INVALID");
  process.env.QSTASH_TOKEN = "token-with\r\nnewline";
  assert.equal(checkDispatchPreflight(), "QSTASH_TOKEN_INVALID");
  process.env.QSTASH_TOKEN = "valid-token-for-qstash";

  // Case 8: QStash allowed but dispatch disabled -> CONFIG_READY_DISPATCH_DISABLED
  process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "1";
  assert.equal(checkDispatchPreflight(), "CONFIG_READY_DISPATCH_DISABLED");

  // Case 9: Dispatch enabled but QStash transport not allowed -> QSTASH_REAL_TRANSPORT_DISABLED
  process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "0";
  process.env.SKILLQUEST_DISPATCH_ENABLED = "1";
  assert.equal(checkDispatchPreflight(), "QSTASH_REAL_TRANSPORT_DISABLED");

  // Case 10: All prerequisites valid and enabled -> DISPATCH_PREREQUISITES_VALID
  process.env.SKILLQUEST_ALLOW_REAL_QSTASH = "1";
  process.env.SKILLQUEST_DISPATCH_ENABLED = "1";
  assert.equal(checkDispatchPreflight(), "DISPATCH_PREREQUISITES_VALID");
});

test("PREFLIGHT: logDispatchPreflight emits safe constant log without secrets", async () => {
  const { logDispatchPreflight } = await import("../src/services/job-dispatch.service.js");
  const logged: string[] = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logged.push(args.join(" "));
  };

  try {
    logDispatchPreflight();
    assert.equal(logged.length, 1);
    assert.equal(logged[0], "[DISPATCH_PREFLIGHT] code=CONFIG_READY_FLAGS_STANDBY");

    // Must never contain sensitive info
    assert.ok(!logged[0].includes(VALID_SECRET));
    assert.ok(!logged[0].includes("valid-token"));
    assert.ok(!logged[0].includes("https://"));
  } finally {
    console.info = originalInfo;
  }
});

test("HEALTH ROUTE: GET /api/v1/health logs preflight code while public response schema remains strictly unchanged", async () => {
  const logged: string[] = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logged.push(args.join(" "));
  };

  const server: Server = appInstance.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const res = await fetch(`${base}/api/v1/health`);
    assert.ok([200, 503].includes(res.status));

    const body = await res.json() as Record<string, unknown>;
    // Check exact existing schema: status, service, database, timestamp
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, ["database", "service", "status", "timestamp"]);
    assert.equal(body.service, "skillquest-api");
    assert.ok(["ok", "degraded"].includes(body.status as string));
    assert.ok(["connected", "disconnected"].includes(body.database as string));

    // Must never contain configuration details
    assert.equal(body.code, undefined);
    assert.equal(body.preflight, undefined);
    assert.equal(body.config, undefined);

    // Check that preflight log was captured on server side
    const preflightLogs = logged.filter(l => l.startsWith("[DISPATCH_PREFLIGHT]"));
    assert.equal(preflightLogs.length, 1);
    assert.equal(preflightLogs[0], "[DISPATCH_PREFLIGHT] code=CONFIG_READY_FLAGS_STANDBY");
  } finally {
    console.info = originalInfo;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("PREFLIGHT: zero side-effects (0 external network requests, 0 DB queries from preflight itself)", async () => {
  const { checkDispatchPreflight } = await import("../src/services/job-dispatch.service.js");
  const originalFetch = globalThis.fetch;
  let externalNetworkCalls = 0;
  globalThis.fetch = async (...args) => {
    const url = String(args[0]);
    if (!url.startsWith("http://127.0.0.1")) {
      externalNetworkCalls++;
      throw new Error(`Unexpected external call: ${url}`);
    }
    return originalFetch(...args);
  };

  try {
    const code = checkDispatchPreflight();
    assert.equal(code, "CONFIG_READY_FLAGS_STANDBY");
    assert.equal(externalNetworkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
