import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const root = new URL("../prisma/migrations/", import.meta.url);
test(
  "Upgrading a populated legacy schema preserves students and reconstructs missing snapshots",
  { timeout: 30000 },
  async () => {
    const db = await PGlite.create();
    try {
      const names = (await readdir(root))
        .filter((n) => n !== "migration_lock.toml")
        .sort();
      const upgradeIndex = names.indexOf("20261026010000_reliable_assessment");
      assert.ok(upgradeIndex >= 0, "The legacy-to-reliable migration must exist");
      for (const name of names.slice(0, upgradeIndex))
        await db.exec(
          await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
        );
      const [
        user,
        assessment,
        mission,
        start,
        end,
        choice,
        comp,
        session,
        participant,
        attempt,
        decision,
      ] = Array.from({ length: 11 }, () => randomUUID());
      await db.query(
        `INSERT INTO "User"(id,email,role,"updatedAt") VALUES($1,'legacy@example.test','ADMIN',now())`,
        [user],
      );
      await db.query(
        `INSERT INTO "Assessment"(id,slug,title,status,"updatedAt") VALUES($1,'legacy','Legacy','PUBLISHED',now())`,
        [assessment],
      );
      await db.query(
        `INSERT INTO "Mission"(id,"assessmentId",position,title) VALUES($1,$2,1,'Legacy mission')`,
        [mission, assessment],
      );
      await db.query(
        `INSERT INTO "ScenarioNode"(id,"missionId",key,kind,title,story,question,"isStart") VALUES($1,$2,'start','QUESTION','Old title','Old story','What?',true),($3,$2,'end','ENDING','End','Done',null,false)`,
        [start, mission, end],
      );
      await db.query(
        `INSERT INTO "ScenarioChoice"(id,"nodeId","nextNodeId",position,label) VALUES($1,$2,$3,0,'Old choice')`,
        [choice, start, end],
      );
      await db.query(
        `INSERT INTO "Competency"(id,slug,label) VALUES($1,'communication','Communication')`,
        [comp],
      );
      await db.query(
        `INSERT INTO "ChoiceImpact"("choiceId","competencyId",indicator) VALUES($1,$2,2)`,
        [choice, comp],
      );
      await db.query(
        `INSERT INTO "AssessmentSession"(id,"assessmentId","createdById",label,"codeHash",status,"updatedAt") VALUES($1,$2,$3,'Legacy session',$4,'OPEN',now())`,
        [session, assessment, user, "b".repeat(64)],
      );
      await db.query(
        `INSERT INTO "Participant"(id,"sessionId","publicId","displayName","guestTokenHash","createdAt") VALUES($1,$2,'SQ-LEGACY','Old student',$3,now()-interval '8 days')`,
        [participant, session, "c".repeat(64)],
      );
      await db.query(
        `INSERT INTO "Attempt"(id,"participantId","currentNodeId",status) VALUES($1,$2,$3,'COMPLETED')`,
        [attempt, participant, end],
      );
      await db.query(
        `INSERT INTO "Decision"(id,"attemptId","nodeId","choiceId") VALUES($1,$2,$3,$4)`,
        [decision, attempt, start, choice],
      );
      for (const name of names.slice(upgradeIndex))
        await db.exec(
          await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
        );
      const people = await db.query<{ displayName: string; expired: boolean }>(
        `SELECT "displayName", "tokenExpiresAt"<now() AS expired FROM "Participant"`,
      );
      assert.equal(people.rows[0].displayName, "Old student");
      assert.equal(people.rows[0].expired, true);
      const versions = await db.query<{
        graphSnapshot: Array<{ title: string }>;
        changelog: string;
      }>(`SELECT "graphSnapshot",changelog FROM "MissionVersion"`);
      assert.equal(versions.rows.length, 1);
      assert.ok(
        versions.rows[0].graphSnapshot.some((n) => n.title === "Old title"),
      );
      assert.ok(versions.rows[0].changelog.startsWith("LEGACY_BACKFILL"));
      const impacts = await db.query<{
        impactSnapshot: Array<{ indicator: number }>;
      }>(`SELECT "impactSnapshot" FROM "Decision"`);
      assert.equal(impacts.rows[0].impactSnapshot[0].indicator, 2);
      assert.equal(
        (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM "Competency"`,
          )
        ).rows[0].n,
        7,
      );
    } finally {
      await db.close();
    }
  },
);
