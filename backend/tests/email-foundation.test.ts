import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedEmailDatabase, SimulatedBrevo } from "./helpers/isolated-email.js";

const foundation = "20261030010000_email_security_foundation";
const h = "a".repeat(64);
test("Additive migration preserves populated student and admin tables and can be reapplied after isolated rollback", async () => {
 const { db, names, migrate } = await createIsolatedEmailDatabase();
 try {
  for (const name of names.filter(n => n < foundation)) await migrate(name);
  const id=randomUUID();
  await db.query(`INSERT INTO "AdaptiveInterview" (id,"tokenHash","displayName",email,state,"expiresAt","updatedAt") VALUES ($1,$2,'Synthetic student','synthetic@example.test','{}',now()+interval '7 days',now())`,[id,h]);
  const user=randomUUID();
  await db.query(`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,'admin@example.test','ADMIN',now())`,[user]);
  await db.query(`INSERT INTO "AdminSession" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()+interval '1 day')`,[randomUUID(),user,h]);
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT row_to_json(t) AS row FROM "AdaptiveInterview" t UNION ALL SELECT row_to_json(s) FROM "AdminSession" s`)).rows);
  const before=await snapshot(); await migrate(foundation); assert.equal(await snapshot(),before);
  // Rollback simulation is restricted to this owned in-memory database.
  await db.exec('DROP TABLE "EmailOtpChallenge", "EmailAbuseCounter", "EmailBudgetReservation", "EmailProviderState"');
  assert.equal(await snapshot(),before); await migrate(foundation); assert.equal(await snapshot(),before);
 } finally { await db.close(); }
});

test("Schema supports bounded atomic counter increments, unique reservations and OTP single consumption", async () => {
 const {db,migrate}=await createIsolatedEmailDatabase();
 try {
  await migrate(foundation);
  const results=await Promise.all(Array.from({length:20},()=>db.query(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count) VALUES ('GLOBAL',$1,'EMAIL_UNITS','2026-10-30','2026-10-31',1) ON CONFLICT (scope,"subjectHash",metric,"windowStart") DO UPDATE SET count="EmailAbuseCounter".count+1 WHERE "EmailAbuseCounter".count<5 RETURNING count`,[h])));
  assert.equal(results.filter(r=>r.rows.length).length,5);
  assert.equal((await db.query<{count:number}>('SELECT count FROM "EmailAbuseCounter"')).rows[0].count,5);
  const id=randomUUID(); await db.query(`INSERT INTO "EmailOtpChallenge" (id,"identityHash",purpose,"codeHash","expiresAt") VALUES ($1,$2,'INITIAL',$2,now()+interval '10 minutes')`,[id,h]);
  const consume=await Promise.all(Array.from({length:10},()=>db.query(`UPDATE "EmailOtpChallenge" SET "consumedAt"=now() WHERE id=$1 AND "consumedAt" IS NULL AND "expiresAt">now() RETURNING id`,[id])));
  assert.equal(consume.filter(r=>r.rows.length).length,1);
  const key=randomUUID();const insert=()=>db.query(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash","expiresAt") VALUES ($1,'synthetic-send','OTP',now(),$2,$3,now()+interval '1 day') ON CONFLICT ("logicalKey") DO NOTHING RETURNING id`,[randomUUID(),key,h]);
  assert.equal((await Promise.all(Array.from({length:10},insert))).filter(r=>r.rows.length).length,1);
  await assert.rejects(()=>db.query(`UPDATE "EmailAbuseCounter" SET count=-1`));
  await assert.rejects(()=>db.query(`UPDATE "EmailOtpChallenge" SET attempts=6`));
  await db.query(`UPDATE "EmailBudgetReservation" SET "providerAttemptedAt"=now(), status='UNCERTAIN'`);
  await assert.rejects(()=>db.query(`UPDATE "EmailBudgetReservation" SET status='RELEASED'`));
  await db.query(`INSERT INTO "EmailProviderState" (provider,"blockedUntil","reasonCode") VALUES ('BREVO',now()+interval '1 minute','RATE_LIMIT')`);
  assert.equal((await db.query('SELECT * FROM "EmailProviderState"')).rows.length,1);
 }finally{await db.close();}
});

test("Brevo simulator models deduplication, expiry, quota, rate limit and uncertain acceptance without network", async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_FORBIDDEN');});
 const fake=new SimulatedBrevo(),key=randomUUID();
 assert.equal((await fake.send(key,0)).status,201);
 assert.equal((await fake.send(key,1)).code,'duplicate_parameter'); assert.equal(fake.deliveries,1);
 assert.equal((await fake.send(key,30*60000)).status,201);
 assert.equal((await fake.send(randomUUID(),0,'quota')).status,402);
 assert.equal((await fake.send(randomUUID(),0,'rate')).status,429);
 const uncertain=randomUUID();await assert.rejects(()=>fake.send(uncertain,0,'uncertain'));
 assert.equal((await fake.send(uncertain,1)).code,'duplicate_parameter');assert.equal(fake.deliveries,3);
});
