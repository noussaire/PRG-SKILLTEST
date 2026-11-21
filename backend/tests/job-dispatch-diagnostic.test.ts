import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeDispatchErrorCode,
  wakeJobs,
  DispatchBusy,
} from "../src/services/job-dispatch.service.js";
import { ProviderDisabledError } from "../src/security/provider-mode.js";
import { QstashConfigurationError } from "../src/security/qstash-signature.js";
import { SyntheticStagingError } from "../src/security/synthetic-staging.js";
import { MaintenanceStopped } from "../src/services/maintenance-control.js";

test("sanitizeDispatchErrorCode translates typed and known dispatch errors into safe codes", () => {
  assert.equal(sanitizeDispatchErrorCode(new DispatchBusy()), "DISPATCH_BUSY");
  assert.equal(sanitizeDispatchErrorCode(new ProviderDisabledError("QSTASH")), "QSTASH_REAL_TRANSPORT_DISABLED");
  assert.equal(sanitizeDispatchErrorCode(new ProviderDisabledError("BREVO")), "BREVO_REAL_TRANSPORT_DISABLED");
  assert.equal(sanitizeDispatchErrorCode(new QstashConfigurationError()), "QSTASH_DISABLED_OR_INVALID");
  assert.equal(sanitizeDispatchErrorCode(new SyntheticStagingError()), "SYNTHETIC_STAGING_UNAVAILABLE");
  assert.equal(sanitizeDispatchErrorCode(new MaintenanceStopped("DEADLINE")), "MAINTENANCE_DEADLINE");
  assert.equal(sanitizeDispatchErrorCode(new MaintenanceStopped("ABORTED")), "MAINTENANCE_ABORTED");
  assert.equal(sanitizeDispatchErrorCode(new Error("DISPATCH_DISABLED")), "DISPATCH_DISABLED");
  assert.equal(sanitizeDispatchErrorCode(new Error("DISPATCH_DAILY_LIMIT_REQUIRED")), "DISPATCH_DAILY_LIMIT_REQUIRED");
  assert.equal(sanitizeDispatchErrorCode(new Error("DISPATCH_DAILY_LIMIT")), "DISPATCH_DAILY_LIMIT");
  assert.equal(sanitizeDispatchErrorCode(new Error("DISPATCH_LEASE_LOST")), "DISPATCH_LEASE_LOST");
  assert.equal(sanitizeDispatchErrorCode(new Error("DISPATCH_MIGRATION_REQUIRED")), "DISPATCH_MIGRATION_REQUIRED");
  assert.equal(sanitizeDispatchErrorCode(new SyntaxError("Unexpected token in JSON at position 0")), "CONFIG_SYNTAX_ERROR");
  assert.equal(sanitizeDispatchErrorCode(Object.assign(new Error("Query failed"), { code: "P2002" })), "DB_P2002");
  assert.equal(sanitizeDispatchErrorCode(Object.assign(new Error("Relation not found"), { code: "42P01" })), "DB_42P01");
});

test("sanitizeDispatchErrorCode neutralizes arbitrary and sensitive error messages without leaking data", () => {
  const sensitiveError1 = new Error("postgresql://neondb_owner:super_secret_pw@ep-wispy.neon.tech/neondb");
  assert.equal(sanitizeDispatchErrorCode(sensitiveError1), "UNEXPECTED_DISPATCH_ERROR");

  const sensitiveError2 = new Error("failed sending email to candidate@personal-domain.com with Bearer key_xyz");
  assert.equal(sanitizeDispatchErrorCode(sensitiveError2), "UNEXPECTED_DISPATCH_ERROR");

  assert.equal(sanitizeDispatchErrorCode("string error"), "UNEXPECTED_DISPATCH_ERROR");
  assert.equal(sanitizeDispatchErrorCode(null), "UNEXPECTED_DISPATCH_ERROR");
  assert.equal(sanitizeDispatchErrorCode(undefined), "UNEXPECTED_DISPATCH_ERROR");
});

test("wakeJobs() reports disabled dispatch without work or error logs when its flag is not 1", async t => {
  const original = process.env.SKILLQUEST_DISPATCH_ENABLED;
  const logged: string[] = [];
  t.mock.method(console, "error", (msg: string) => { logged.push(msg); });
  const events: { event: string; status: string; code?: string }[] = [];
  t.mock.method(console, "info", (line: string) => { events.push(JSON.parse(line)); });

  try {
    process.env.SKILLQUEST_DISPATCH_ENABLED = "0";
    await wakeJobs();
    assert.equal(logged.length, 0);
    assert.ok(events.some(event => event.event === "DISPATCH_FINISHED" && event.status === "disabled" && event.code === "DISPATCH_DISABLED"));

    delete process.env.SKILLQUEST_DISPATCH_ENABLED;
    await wakeJobs();
    assert.equal(logged.length, 0);
    assert.equal(events.filter(event => event.event === "DISPATCH_FINISHED").length, 2);
    assert.ok(!events.some(event => event.event === "DB_LEASE_ACQUIRED"));
  } finally {
    if (original !== undefined) process.env.SKILLQUEST_DISPATCH_ENABLED = original;
    else delete process.env.SKILLQUEST_DISPATCH_ENABLED;
  }
});

test("wakeJobs() logs sanitized diagnostic code and does not throw when configuredDispatch fails", async t => {
  const origEnabled = process.env.SKILLQUEST_DISPATCH_ENABLED;
  const origSecret = process.env.SKILLQUEST_DISPATCH_SECRET;
  const logged: string[] = [];
  t.mock.method(console, "error", (msg: string) => { logged.push(msg); });

  try {
    process.env.SKILLQUEST_DISPATCH_ENABLED = "1";
    process.env.SKILLQUEST_DISPATCH_SECRET = "invalid-short-secret";

    // Must resolve cleanly without throwing
    await wakeJobs();

    assert.equal(logged.length, 1);
    assert.equal(logged[0], "[DISPATCH_DIAGNOSTIC] code=DISPATCH_DISABLED");
  } finally {
    if (origEnabled !== undefined) process.env.SKILLQUEST_DISPATCH_ENABLED = origEnabled;
    else delete process.env.SKILLQUEST_DISPATCH_ENABLED;
    if (origSecret !== undefined) process.env.SKILLQUEST_DISPATCH_SECRET = origSecret;
    else delete process.env.SKILLQUEST_DISPATCH_SECRET;
  }
});
