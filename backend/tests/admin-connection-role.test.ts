import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { prisma } from "../src/db/prisma.js";
import { hashAdminToken } from "../src/security/adminAuth.js";
import { adminConnectionRoleRouter } from "../src/routes/admin/connection-role.routes.js";

test("existing admin sessions authorize only the fixed role SELECT, without any write", async t => {
  const tokens = { admin: "a".repeat(64), expired: "b".repeat(64), student: "c".repeat(64), unknown: "d".repeat(64) };
  let failAuth = false, failQuery = false;
  let queryResult: unknown = [{ is_app: true, is_runtime: false, secret: "NEVER_RETURN" }];
  const reads = t.mock.fn(async (args: any) => {
    if (failAuth) throw new Error("postgresql://SECRET");
    const entry = Object.entries(tokens).find(([, token]) => hashAdminToken(token) === args.where.tokenHash);
    if (!entry || entry[0] === "unknown") return null;
    return { id: "fixture", expiresAt: new Date(entry[0] === "expired" ? 0 : Date.now() + 60000), user: { role: entry[0] === "student" ? "STUDENT" : "ADMIN" } };
  });
  const writes = t.mock.fn(async () => { throw new Error("WRITE_FORBIDDEN"); });
  // Prisma model delegates are proxies, not ordinary methods mock.method can
  // replace. Override only this test's singleton delegate and restore it below.
  const descriptor = Object.getOwnPropertyDescriptor(prisma, "adminSession");
  Object.defineProperty(prisma, "adminSession", { configurable: true, value: { findUnique: reads, delete: writes } });
  const query = t.mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
    assert.equal(values.length, 0);
    assert.equal(sql.join(""), "SELECT\ncurrent_user = 'skillquest_app' AS is_app,\ncurrent_user = 'skillquest_runtime' AS is_runtime");
    if (failQuery) throw new Error("postgresql://SECRET");
    return queryResult;
  });
  const queryDescriptor = Object.getOwnPropertyDescriptor(prisma, "$queryRaw");
  Object.defineProperty(prisma, "$queryRaw", { configurable: true, value: query });
  const app = express(); app.use("/api/v1/admin/connection-role", adminConnectionRoleRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/admin/connection-role`;
  const request = (token?: string) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    await t.test("anonymous and malformed token: no database query", async () => {
      for (const token of [undefined, "malformed"]) assert.equal((await request(token)).status, 401);
      assert.equal(reads.mock.callCount(), 0); assert.equal(query.mock.callCount(), 0);
    });
    await t.test("expired, non-admin and unknown session: no diagnostic and no deletion", async () => {
      for (const token of [tokens.expired, tokens.student, tokens.unknown]) assert.equal((await request(token)).status, 401);
      assert.equal(writes.mock.callCount(), 0); assert.equal(query.mock.callCount(), 0);
    });
    await t.test("valid existing admin: only two booleans, no cache", async () => {
      for (const values of [{ is_app: true, is_runtime: false }, { is_app: false, is_runtime: true }, { is_app: false, is_runtime: false }]) {
        queryResult = [{ ...values, secret: "NEVER_RETURN" }];
        const response = await request(tokens.admin);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await response.json(), values);
      }
    });
    await t.test("SQL failure or malformed row: generic response only", async () => {
      failQuery = true;
      let response = await request(tokens.admin);
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "Diagnostic indisponible." });
      failQuery = false;
      for (const invalid of [[], [{ is_app: "true", is_runtime: false }]]) {
        queryResult = invalid; response = await request(tokens.admin);
        assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "Diagnostic indisponible." });
      }
    });
    await t.test("authentication database failure: generic response without credentials", async () => {
      failAuth = true;
      const before = query.mock.callCount();
      const response = await request(tokens.admin);
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "Diagnostic indisponible." });
      assert.equal(query.mock.callCount(), before);
    });
    assert.equal(writes.mock.callCount(), 0);
  } finally {
    if (descriptor) Object.defineProperty(prisma, "adminSession", descriptor);
    else Reflect.deleteProperty(prisma, "adminSession");
    if (queryDescriptor) Object.defineProperty(prisma, "$queryRaw", queryDescriptor);
    else Reflect.deleteProperty(prisma, "$queryRaw");
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
