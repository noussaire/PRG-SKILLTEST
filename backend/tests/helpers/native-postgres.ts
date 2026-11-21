import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { PrismaClient } from "@prisma/client";

// No arbitrary DSN, no fallback database. Context is emitted only by the
// project-local launcher after checking a newly initialized empty cluster.
export async function connectLot4NativeDatabase() {
  const file = process.env.LOT4_NATIVE_CONTEXT;
  assert.ok(file, "Run the lot 4 native launcher from normal Windows PowerShell");
  const contextPath = await realpath(file);
  const projectOutput = await realpath(resolve("output"));
  assert.ok(contextPath.startsWith(projectOutput + sep + "lot4-"));
  const context = JSON.parse(await readFile(contextPath, "utf8")) as { nonce: string; data: string; port: number; systemId: string; root: string; migrationsVerified: boolean };
  const root = await realpath(context.root);
  assert.equal(dirname(contextPath), root);
  const owner = JSON.parse(await readFile(resolve(root, "owner.json"), "utf8"));
  assert.equal(owner.purpose, "skillquest-lot4-native"); assert.equal(owner.nonce, context.nonce);
  assert.equal(await realpath(context.data), await realpath(resolve(root, "data")));
  assert.ok(Number.isInteger(context.port) && context.port > 1024 && context.port < 65536 && context.port !== 5432);
  assert.equal(context.migrationsVerified, true);
  const url = `postgresql://lot4_synthetic@127.0.0.1:${context.port}/postgres?connection_limit=4&connect_timeout=5&pool_timeout=10&sslmode=disable`;
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    const row = (await client.$queryRawUnsafe<{ directory: string; systemId: string; address: string; port: number; username: string; db: string; listen: string }[]>(`SELECT current_setting('data_directory') AS directory,
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",inet_server_addr()::text AS address,inet_server_port() AS port,
      current_user AS username,current_database() AS db,current_setting('listen_addresses') AS listen`))[0];
    assert.equal(await realpath(row.directory), await realpath(context.data)); assert.equal(row.systemId, context.systemId);
    assert.ok(row.address === "127.0.0.1" || row.address === "127.0.0.1/32");
    assert.equal(row.port, context.port); assert.equal(row.listen, "127.0.0.1");
    assert.equal(row.username, "lot4_synthetic"); assert.equal(row.db, "postgres");
    // Only after identity checks may the application's singleton use this URL.
    process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
    return { client, context, url };
  } catch (error) { await client.$disconnect(); throw error; }
}
