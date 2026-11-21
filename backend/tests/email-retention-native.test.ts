import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { EmailBudget, EMAIL_RETENTION_BATCH_SIZE } from "../src/services/email-budget.service.js";
import { emailSubjectHash, normalizedEmailIdentity } from "../src/services/email-limits.js";
import { encryptOtpPayload } from "../src/security/otp-payload.js";

const options = { skip: process.env.LOT4_NATIVE_CONTEXT ? false : "Owned native PostgreSQL context required", timeout: 60000 };
const day = 86400000, h = "a".repeat(64);
let db: PrismaClient, other: PrismaClient, now: Date, budget: EmailBudget;
const ago = (ms: number) => new Date(now.getTime() - ms);

before(async () => {
  if (options.skip) return;
  other = (await connectLot4NativeDatabase()).client;
  process.env.JOIN_CODE_PEPPER = "lot1-retention-synthetic-only-pepper-0123456789abcdef";
  Object.assign(process.env, { NODE_ENV: "test", BREVO_API_KEY: "synthetic-never-used", BREVO_SENDER_EMAIL: "sender@example.test", GROQ_API_KEY: "" });
  ({ prisma: db } = await import("../src/db/prisma.js"));
  budget = new EmailBudget(db);
});
beforeEach(async t => {
  if (options.skip) return;
  (t as import("node:test").TestContext).mock.method(globalThis, "fetch", async () => { throw Error("ALL_EXTERNAL_TRANSPORT_FORBIDDEN"); });
  Object.assign(process.env, { EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_OTHER_USAGE_MARGIN: "60", EMAIL_APP_DAILY_LIMIT: "240",
    OTP_IDENTITY_DAILY_SENDS: "5", OTP_NETWORK_DAILY_SENDS: "100", OTP_GLOBAL_DAILY_SENDS: "120",
    OTP_IDENTITY_DAILY_FAILURES: "15", OTP_NETWORK_DAILY_FAILURES: "150", OTP_GLOBAL_DAILY_FAILURES: "1000" });
  await db.$executeRawUnsafe(`TRUNCATE "User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
  now = (await db.$queryRawUnsafe<{ now: Date }[]>(`SELECT clock_timestamp() AS now`))[0].now;
});
after(async () => { await db?.$disconnect(); await other?.$disconnect(); });

async function job(kind: "initial" | "retake", status: string, age = 3 * day, leased = false) {
  const id = randomUUID(), ownerId = randomUUID(), email = `${id}@example.test`;
  const identity = emailSubjectHash("IDENTITY", normalizedEmailIdentity(email));
  const expiresAt = ago(age);
  const table = kind === "initial" ? "ParticipantEmailDeliveryJob" : "OtpDeliveryJob";
  if (kind === "initial") {
    await db.$executeRawUnsafe(`INSERT INTO "EmailOtpChallenge" (id,"identityHash",purpose,"codeHash","createdAt","expiresAt")
      VALUES ($1::uuid,$2,'INITIAL',$3,$4,$5)`, ownerId, identity, h, ago(100 * day), expiresAt);
    await db.$executeRawUnsafe(`INSERT INTO "ParticipantEmailGate" ("identityHash","challengeId","nextIssueAt") VALUES ($1,$2::uuid,$3)`, identity, ownerId, ago(3 * day));
  } else {
    await db.adaptiveInterview.create({ data: { id: ownerId, displayName: "Synthetic historical", email, emailIdentity: email,
      tokenHash: id.replaceAll("-", "").repeat(2), state: {}, expiresAt: ago(-day), retakeCodeHash: h, retakeCodeExpiresAt: expiresAt } });
  }
  const payload = ["ACCEPTED", "REJECTED"].includes(status) ? null : encryptOtpPayload({ recipient: email, recipientName: "Synthetic", subject: "OTP", htmlContent: "<p>123456</p>" }, id);
  await db.$executeRawUnsafe(`INSERT INTO "${table}" (id,"${kind === "initial" ? "challengeId" : "interviewId"}","codeHash",status,
    "encryptedPayload","expiresAt","nextAttemptAt","leaseUntil","attemptToken","createdAt")
    VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::uuid,$10)`, id, ownerId, h, status, payload, expiresAt,
    payload ? ago(60000) : null, leased ? ago(-120000) : null, leased ? randomUUID() : null, ago(100 * day));
  return { id, ownerId, identity, table, email };
}
async function reservation(key: string, status: string, leased = false) {
  await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation"
    (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","leaseUntil","attemptToken","createdAt","expiresAt")
    VALUES ($1::uuid,$2,'OTP',$3,$2::uuid,$4,$5,$6,$7,$8,$9::uuid,$10,$11)`, randomUUID(), key, ago(70 * day), h,
    status, status === "RELEASED" ? null : ago(70 * day), status === "RELEASED" ? null : ago(69 * day),
    leased ? ago(-120000) : null, leased ? randomUUID() : null, ago(100 * day), ago(10 * day));
}
async function counter(subject: string, expiry: Date) {
  await db.$executeRawUnsafe(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count)
    VALUES ('IDENTITY',$1,'OTP_FAILURE',$2,$3,15)`, subject, new Date(expiry.getTime() - day), expiry);
}

test("Native retention preserves active/recent OTP counters and cooldowns, with bounded counter batches", options, async () => {
  await counter("1".repeat(64), ago(-day));
  await counter("2".repeat(64), ago(day));
  await db.$executeRawUnsafe(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count)
    SELECT 'IDENTITY',lpad(to_hex(n),64,'0'),'OTP_SEND',$1::timestamp,$2::timestamp,5 FROM generate_series(10,$3::int) n`,
    ago(4 * day), ago(3 * day), EMAIL_RETENTION_BATCH_SIZE + 10);
  await db.$executeRawUnsafe(`INSERT INTO "EmailOtpThrottle" ("identityHash","nextSendAt") VALUES ($1,$2),($3,$4),($5,$6)`,
    "1".repeat(64), ago(-60000), "2".repeat(64), ago(1800000), "3".repeat(64), ago(7200000));
  const result = await budget.purgeExpiredData();
  assert.equal(result.deletedCounters, EMAIL_RETENTION_BATCH_SIZE); assert.equal(result.deletedThrottles, 1);
  assert.equal(await db.emailAbuseCounter.count(), 3); assert.equal(await db.emailOtpThrottle.count(), 2);
  assert.equal((await db.emailAbuseCounter.findFirstOrThrow({ where: { subjectHash: "1".repeat(64) } })).count, 15);
  // Even an explicitly future cutoff cannot remove protected counters.
  assert.equal((await budget.purgeExpiredCounters(ago(-100 * day))).deletedCounters, 1);
  assert.equal(await db.emailAbuseCounter.count(), 2);
});

test("Native purge cannot reset active OTP limits, failures or accepted budget idempotency", options, async () => {
  const savedSends = process.env.OTP_IDENTITY_DAILY_SENDS, savedFailures = process.env.OTP_IDENTITY_DAILY_FAILURES;
  process.env.OTP_IDENTITY_DAILY_SENDS = "1"; process.env.OTP_IDENTITY_DAILY_FAILURES = "1";
  try {
    const key = randomUUID(), email = "protected@example.test";
    const input = { key, requestHash: h, recipient: email, purpose: "OTP" as const, networkOrigin: "127.0.0.1" };
    const claim = await budget.claim(input); await budget.finish(claim, { accepted: true });
    await budget.withOtpAttempt("failed@example.test", "127.0.0.1", async (_tx, _now, recordFailure) => { await recordFailure(); });
    const before = JSON.stringify(await db.emailAbuseCounter.findMany({ orderBy: [{ scope: "asc" }, { subjectHash: "asc" }, { metric: "asc" }] }));
    await budget.purgeExpiredData();
    assert.equal(JSON.stringify(await db.emailAbuseCounter.findMany({ orderBy: [{ scope: "asc" }, { subjectHash: "asc" }, { metric: "asc" }] })), before);
    assert.equal((await budget.claim(input)).duplicate, true);
    await assert.rejects(budget.claim({ ...input, key: randomUUID() }), /EMAIL_LOCAL_LIMIT/);
    await assert.rejects(budget.withOtpAttempt("failed@example.test", "127.0.0.1", async () => { assert.fail("Failure limit was reset"); }), /EMAIL_LOCAL_LIMIT/);
    assert.equal(await db.emailBudgetReservation.count(), 1);
  } finally {
    if (savedSends === undefined) delete process.env.OTP_IDENTITY_DAILY_SENDS; else process.env.OTP_IDENTITY_DAILY_SENDS = savedSends;
    if (savedFailures === undefined) delete process.env.OTP_IDENTITY_DAILY_FAILURES; else process.env.OTP_IDENTITY_DAILY_FAILURES = savedFailures;
  }
});

test("Two native cleanup clients serialize without double deletion or partial batches", options, async () => {
  await db.$executeRawUnsafe(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count)
    SELECT 'IDENTITY',lpad(to_hex(n),64,'0'),'OTP_SEND',$1::timestamp,$2::timestamp,5 FROM generate_series(1,150) n`, ago(4 * day), ago(3 * day));
  const a = new EmailBudget(db), b = new EmailBudget(other);
  const results = await Promise.all([a.purgeExpiredData(), b.purgeExpiredData()]);
  assert.deepEqual(results.map(r => r.deletedCounters).sort((x, y) => x - y), [50, 100]);
  assert.equal(await db.emailAbuseCounter.count(), 0);
});

test("Native retention erases only expired unleased payloads and retains uncertain evidence in both outboxes", options, async () => {
  for (const kind of ["initial", "retake"] as const) {
    const uncertain = await job(kind, "UNCERTAIN"); await reservation(uncertain.id, "UNCERTAIN");
    const pending = await job(kind, "PENDING"); await reservation(pending.id, "UNCERTAIN");
    const active = await job(kind, "PENDING", -600000);
    const leased = await job(kind, "UNCERTAIN", 3 * day, true);
    const first = await budget.purgeExpiredData(); assert.ok(first.clearedPayloads >= 2);
    const rows = await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${uncertain.table}" ORDER BY id`);
    const byId = new Map(rows.map(r => [r.id, r]));
    assert.equal(byId.get(uncertain.id).status, "UNCERTAIN"); assert.equal(byId.get(uncertain.id).encryptedPayload, null);
    assert.equal(byId.get(pending.id).status, "REJECTED"); assert.equal(byId.get(pending.id).encryptedPayload, null);
    assert.ok(byId.get(active.id).encryptedPayload); assert.ok(byId.get(leased.id).encryptedPayload); assert.ok(byId.get(leased.id).attemptToken);
    assert.equal(await db.emailBudgetReservation.count({ where: { logicalKey: { in: [uncertain.id, pending.id] } } }), 2);
  }
});

test("Native retention removes old terminal metadata without cascading uncertain jobs or touching participants/admin/reports", options, async () => {
  const old = await job("initial", "ACCEPTED"); await reservation(old.id, "ACCEPTED");
  const retained = await job("initial", "UNCERTAIN"); await reservation(retained.id, "UNCERTAIN");
  const legacy = await job("retake", "REJECTED"); await reservation(legacy.id, "REJECTED");
  await job("initial", "ACCEPTED", day); // 48-hour metadata safety margin
  const user = await db.user.create({ data: { email: "synthetic-admin@example.test", role: "ADMIN" } });
  await db.adminSession.create({ data: { userId: user.id, tokenHash: "d".repeat(64), expiresAt: ago(-day) } });
  await db.adaptiveReportJob.create({ data: { interviewId: legacy.ownerId, status: "COMPLETE", summary: "Synthetic preserved report", emailStatus: "SENT" } });
  const snapshot = JSON.stringify([await db.adaptiveInterview.findMany(), await db.adaptiveReportJob.findMany(), await db.adminSession.findMany()]);
  const r = await budget.purgeExpiredData();
  assert.equal(r.deletedJobs, 2); assert.equal(r.deletedGates, 1); assert.equal(r.deletedChallenges, 1);
  assert.equal(await db.emailOtpChallenge.count({ where: { id: old.ownerId } }), 0);
  assert.equal(await db.emailOtpChallenge.count({ where: { id: retained.ownerId } }), 1);
  assert.equal(await db.participantEmailGate.count({ where: { identityHash: retained.identity } }), 1);
  assert.equal(await db.emailBudgetReservation.count(), 3);
  assert.equal(JSON.stringify([await db.adaptiveInterview.findMany(), await db.adaptiveReportJob.findMany(), await db.adminSession.findMany()]), snapshot);
  assert.deepEqual(await budget.purgeExpiredData(), { deletedCounters: 0, deletedThrottles: 0, clearedPayloads: 0, deletedJobs: 0, deletedGates: 0, deletedChallenges: 0 });
});

test("Native retention retains all reservation states, leases and provider circuit breaker even past reservation expiry", options, async () => {
  for (const status of ["RESERVED", "UNCERTAIN", "ACCEPTED", "REJECTED", "RELEASED"]) await reservation(randomUUID(), status);
  const active = await job("initial", "REJECTED"); await reservation(active.id, "ACCEPTED", true);
  await db.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider,"blockedUntil","reasonCode") VALUES ('BREVO',$1,'BREVO_QUOTA')`, ago(-day));
  const before = JSON.stringify(await db.emailBudgetReservation.findMany({ orderBy: { logicalKey: "asc" } }));
  await budget.purgeExpiredData();
  assert.equal(JSON.stringify(await db.emailBudgetReservation.findMany({ orderBy: { logicalKey: "asc" } })), before);
  assert.equal((await db.emailProviderState.findUniqueOrThrow({ where: { provider: "BREVO" } })).reasonCode, "BREVO_QUOTA");
  assert.equal(await db.participantEmailDeliveryJob.count({ where: { id: active.id } }), 1);
});

test("Native cleanup SQL failure rolls back every earlier deletion and payload erasure", options, async () => {
  const old = await job("initial", "PENDING"); await counter(h, ago(3 * day));
  await db.$executeRawUnsafe(`CREATE FUNCTION lot1_fail_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cleanup failure'; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER lot1_fail_cleanup BEFORE DELETE ON "EmailOtpChallenge" FOR EACH ROW EXECUTE FUNCTION lot1_fail_cleanup()`);
    await assert.rejects(budget.purgeExpiredData());
    assert.equal(await other.emailAbuseCounter.count(), 1);
    assert.ok((await other.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: old.id } })).encryptedPayload);
    assert.equal(await other.participantEmailGate.count(), 1); assert.equal(await other.emailOtpChallenge.count(), 1);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lot1_fail_cleanup ON "EmailOtpChallenge"`);
    await db.$executeRawUnsafe(`DROP FUNCTION lot1_fail_cleanup()`);
  }
});

test("Native independent connection holds a worker lease/row while cleanup skips it and preserves reconciliation", options, async () => {
  const old = await job("initial", "UNCERTAIN"); await reservation(old.id, "ACCEPTED");
  const firstPid = (await db.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
  await other.$transaction(async tx => {
    const secondPid = (await tx.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
    assert.notEqual(firstPid, secondPid);
    await tx.$queryRawUnsafe(`SELECT id FROM "ParticipantEmailDeliveryJob" WHERE id=$1::uuid FOR UPDATE`, old.id);
    const r = await budget.purgeExpiredData(); assert.equal(r.clearedPayloads, 0); assert.equal(r.deletedChallenges, 0);
  });
  await budget.purgeExpiredData();
  const { OtpDeliveryQueue } = await import("../src/services/otp-delivery.service.js");
  let sends = 0;
  const send = async () => { sends++; return { messageId: "synthetic", duplicate: false }; };
  await new OtpDeliveryQueue(db, send).runOnce();
  assert.equal(sends, 0);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({ where: { id: old.id } })).status, "ACCEPTED");
  assert.equal(await db.emailBudgetReservation.count(), 1);
  await budget.purgeExpiredData();
  assert.equal(await db.participantEmailDeliveryJob.count(), 0); assert.equal(await db.emailBudgetReservation.count(), 1);
});

test("Native purge and initial issuance serialize on the gate without losing OTP validity or creating participants", options, async () => {
  const old = await job("initial", "REJECTED");
  const { startEmailVerifiedParticipant } = await import("../src/services/participant-email.service.js");
  await other.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT "identityHash" FROM "ParticipantEmailGate" WHERE "identityHash"=$1 FOR UPDATE`, old.identity);
    await budget.purgeExpiredData(); // locked gate and its challenge must survive
    assert.equal(await db.emailOtpChallenge.count({ where: { id: old.ownerId } }), 1);
  });
  const p = { fullName: "Synthetic", email: old.email, language: "fr" as const, emailReport: false };
  const [issued] = await Promise.all([startEmailVerifiedParticipant(p), budget.purgeExpiredData()]);
  assert.equal(issued.status, 409); assert.equal(issued.body.verificationStatus, "PENDING"); assert.equal(issued.body.token, undefined);
  const gate = await db.participantEmailGate.findUniqueOrThrow({ where: { identityHash: old.identity } });
  assert.equal(gate.challengeId, issued.body.challengeId);
  const challenge = await db.emailOtpChallenge.findUniqueOrThrow({ where: { id: gate.challengeId! } });
  assert.ok(challenge.expiresAt > now); assert.equal(await db.adaptiveInterview.count(), 0);
});
