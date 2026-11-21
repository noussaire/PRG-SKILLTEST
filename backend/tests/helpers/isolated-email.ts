import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

// No URL argument, environment access, socket, Prisma client or filesystem dataDir.
// The destination is a freshly allocated, in-memory PGlite instance owned here.
export async function createIsolatedEmailDatabase() {
  const db = await PGlite.create();
  try {
    const tables = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`);
    assert.equal(tables.rows[0].count, 0, "Destination must be a fresh in-memory database before migrations");
    const root = new URL("../../prisma/migrations/", import.meta.url);
    const names = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
    return { db, names, migrate: async (name: string) => {
      assert.ok(names.includes(name), "Only inventoried local migrations may run");
      await db.exec(await readFile(new URL(name + "/migration.sql", root), "utf8"));
    } };
  } catch (error) { await db.close(); throw error; }
}

// Transport-shaped fake. It never calls fetch or loads credentials.
// This models documented semantics; it is not proof of provider behavior.
export class SimulatedBrevo {
  private accepted = new Map<string, number>();
  deliveries = 0;
  async send(key: string, now: number, mode: "accept" | "quota" | "rate" | "uncertain" = "accept") {
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const acceptedAt = this.accepted.get(key);
    if (acceptedAt !== undefined && now - acceptedAt < 30 * 60000) return { status: 400, code: "duplicate_parameter" };
    if (mode === "quota") return { status: 402, code: "not_enough_credits" };
    if (mode === "rate") return { status: 429, code: "rate_limit", retryAfter: 60 };
    this.accepted.set(key, now); this.deliveries++;
    if (mode === "uncertain") throw new Error("SIMULATED_RESPONSE_UNKNOWN");
    return { status: 201, messageId: "synthetic-message" };
  }
}
