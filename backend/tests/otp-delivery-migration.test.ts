import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedEmailDatabase } from "./helpers/isolated-email.js";

test("OTP outbox migration and isolated rollback preserve existing student reports and sessions", { timeout: 30000 }, async () => {
  const { db, names, migrate } = await createIsolatedEmailDatabase();
  const migration = "20261030030000_otp_delivery_outbox";
  try {
    for (const name of names.filter(n => n < migration)) await migrate(name);
    const id = randomUUID(), user = randomUUID();
    await db.query(`INSERT INTO "AdaptiveInterview" (id,"tokenHash","displayName",email,state,"expiresAt","updatedAt","retakeCodeHash","retakeCodeExpiresAt") VALUES ($1,$2,'Synthetic','synthetic@example.test','{}',now()+interval '7 days',now(),$2,now()+interval '10 minutes')`, [id, "a".repeat(64)]);
    await db.query(`INSERT INTO "AdaptiveReportJob" (id,"interviewId",status,summary,"emailStatus","updatedAt") VALUES ($1,$2,'COMPLETE','Synthetic old report','SENT',now())`, [randomUUID(), id]);
    await db.query(`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,'synthetic-admin@example.test','ADMIN',now())`, [user]);
    await db.query(`INSERT INTO "AdminSession" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()+interval '1 day')`, [randomUUID(), user, "b".repeat(64)]);
    const snapshot = async () => (await db.query(`SELECT row_to_json(t) AS value FROM "AdaptiveInterview" t UNION ALL SELECT row_to_json(r) FROM "AdaptiveReportJob" r UNION ALL SELECT row_to_json(s) FROM "AdminSession" s`)).rows;
    const before = await snapshot(); await migrate(migration); assert.deepEqual(await snapshot(), before);
    await assert.rejects(db.query(`INSERT INTO "OtpDeliveryJob" (id,"interviewId","codeHash",status,"encryptedPayload","expiresAt") VALUES ($1,$2,$3,'REJECTED','invalid',now())`, [randomUUID(), id, "a".repeat(64)]));
    await db.exec('DROP TABLE "OtpDeliveryJob"'); assert.deepEqual(await snapshot(), before);
    await migrate(migration); assert.deepEqual(await snapshot(), before);
  } finally { await db.close(); }
});
