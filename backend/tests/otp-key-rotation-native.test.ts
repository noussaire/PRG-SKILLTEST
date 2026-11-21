import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { legacyOtpFixture } from "./helpers/legacy-otp-payload.js";
import { decryptOtpPayload } from "../src/security/otp-payload.js";
import { inspectOtpKeyUsage, assertOtpKeyRetirable } from "../src/services/otp-key-usage.service.js";
import { EmailBudget } from "../src/services/email-budget.service.js";

const options = { skip: process.env.LOT4_NATIVE_CONTEXT ? false : "Owned native PostgreSQL context required", timeout: 60000 };
const pepper = "synthetic-native-rotation-pepper-0123456789abcdef";
const a = Buffer.alloc(32, 29).toString("base64"), b = Buffer.alloc(32, 67).toString("base64");
let db: PrismaClient, other: PrismaClient;
let OtpQueue: typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let send: typeof import("../src/services/brevo.service.js").sendReportEmail;
let entry: typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let retake: typeof import("../src/services/participant-retake.service.js").startParticipantTest;
let mode: "accept" | "lost" | "rate";
let messages: any[];
let onTransport: (() => Promise<void>) | undefined;
function configure(active = "key-a", keepA = true) {
  process.env.OTP_ENCRYPTION_KEYS = JSON.stringify({ ...(keepA ? { "key-a": a } : {}), "key-b": b });
  process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID = active;
}
before(async () => {
  if (options.skip) return;
  other = (await connectLot4NativeDatabase()).client;
  Object.assign(process.env, { NODE_ENV: "test", JOIN_CODE_PEPPER: pepper, GROQ_API_KEY: "" });
  ({ prisma: db } = await import("../src/db/prisma.js"));
  ({ OtpDeliveryQueue: OtpQueue } = await import("../src/services/otp-delivery.service.js"));
  ({ sendReportEmail: send } = await import("../src/services/brevo.service.js"));
  ({ startEmailVerifiedParticipant: entry } = await import("../src/services/participant-email.service.js"));
  ({ startParticipantTest: retake } = await import("../src/services/participant-retake.service.js"));
});
beforeEach(async t => {
  if (options.skip) return;
  messages = []; mode = "accept"; onTransport = undefined;
  delete process.env.OTP_PAYLOAD_WRITE_VERSION; delete process.env.JOIN_CODE_PEPPER_PREVIOUS;
  configure();
  Object.assign(process.env, { JOIN_CODE_PEPPER: pepper, BREVO_API_KEY: "synthetic-no-network", BREVO_SENDER_EMAIL: "sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT: "300", EMAIL_OTHER_USAGE_MARGIN: "60", EMAIL_APP_DAILY_LIMIT: "240", OTP_IDENTITY_DAILY_SENDS: "5",
    OTP_NETWORK_DAILY_SENDS: "100", OTP_GLOBAL_DAILY_SENDS: "120", OTP_IDENTITY_DAILY_FAILURES: "15", OTP_NETWORK_DAILY_FAILURES: "150", OTP_GLOBAL_DAILY_FAILURES: "1000" });
  (t as import("node:test").TestContext).mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://api.brevo.com/v3/smtp/email", "All real/external transport is forbidden");
    const body = JSON.parse(String(init?.body)); assert.match(body.to[0].email, /@example\.test$/);
    messages.push(body); if (onTransport) await onTransport();
    if (mode === "lost") throw Error("SYNTHETIC_RESPONSE_LOST");
    if (mode === "rate") return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    return Response.json({ messageId: "synthetic-accepted" }, { status: 201 });
  });
  await db.$executeRawUnsafe(`TRUNCATE "User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async () => { await db?.$disconnect(); await other?.$disconnect(); });

async function pending(kind: "initial" | "retake", legacy = false) {
  const p = { fullName: "Synthetic rotation", email: `${kind}-${messages.length}@example.test`, language: "fr" as const, emailReport: false };
  const table = kind === "initial" ? "ParticipantEmailDeliveryJob" : "OtpDeliveryJob";
  let ownerId: string;
  if (kind === "initial") {
    const issued = await entry(p); assert.equal(issued.status, 409); ownerId = issued.body.challengeId as string;
  } else {
    const row = await db.adaptiveInterview.create({ data: { displayName: p.fullName, email: p.email, emailIdentity: p.email,
      tokenHash: "e".repeat(64), state: {}, lastTestStartedAt: new Date(Date.now() - 31 * 86400000), expiresAt: new Date(Date.now() + 86400000) } });
    ownerId = row.id;
    const hash = createHmac("sha256", pepper).update(`retake:${ownerId}:654321`).digest("hex");
    await new OtpQueue(db, send).enqueue({ interviewId: ownerId, lastTestStartedAt: row.lastTestStartedAt, codeHash: hash,
      payload: { recipient: p.email, recipientName: p.fullName, subject: "Synthetic", htmlContent: "<p>654321</p>" } });
  }
  const [j] = await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}" WHERE "${kind === "initial" ? "challengeId" : "interviewId"}"=$1::uuid`, ownerId);
  const payload = decryptOtpPayload(j.encryptedPayload, j.id) as { htmlContent: string };
  const code = payload.htmlContent.match(/>(\d{6})<\//)![1];
  if (legacy) {
    const oldPepper = "synthetic-previous-v1-pepper-0123456789abcdef";
    process.env.JOIN_CODE_PEPPER_PREVIOUS = oldPepper;
    j.encryptedPayload = legacyOtpFixture(payload, j.id, oldPepper);
    await db.$executeRawUnsafe(`UPDATE "${table}" SET "encryptedPayload"=$2 WHERE id=$1::uuid`, j.id, j.encryptedPayload);
  }
  return { p, table, ownerId, j, code };
}
async function row(f: Awaited<ReturnType<typeof pending>>) {
  return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${f.table}" WHERE id=$1::uuid`, f.j.id))[0];
}
async function due(f: Awaited<ReturnType<typeof pending>>) {
  await db.$executeRawUnsafe(`UPDATE "${f.table}" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`, f.j.id);
}
async function units() {
  return (await db.$queryRawUnsafe<{ total: number }[]>(`SELECT COALESCE(sum(count),0)::int AS total FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS'`))[0].total;
}

test("Native pending messages in both outboxes survive named-key rotation, deliver once and retain valid OTP HMACs", options, async () => {
  for (const kind of ["initial", "retake"] as const) {
    configure(); const f = await pending(kind); const before = messages.length;
    assert.match(f.j.encryptedPayload, /^v2:key-a:/); configure("key-b");
    await new OtpQueue(other, send).runOnce(); await new OtpQueue(db, send).runOnce();
    assert.equal(messages.length - before, 1); assert.equal(messages[before].headers.IdempotencyKey, f.j.id);
    assert.equal((await row(f)).status, "ACCEPTED"); assert.equal((await row(f)).encryptedPayload, null);
    const result = kind === "initial" ? await entry({ ...f.p, challengeId: f.ownerId, verificationCode: f.code }) : await retake({ ...f.p, verificationCode: f.code });
    assert.equal(result.status, 201); assert.ok(result.body.token);
  }
  assert.equal(await units(), 2); assert.equal(await db.emailBudgetReservation.count(), 2);
});

test("Native genuine pre-change v1 payloads from the previous pepper remain deliverable under the new active encryption key", options, async () => {
  for (const kind of ["initial", "retake"] as const) {
    configure(); const f = await pending(kind, true); assert.match(f.j.encryptedPayload, /^v1:/); configure("key-b");
    const before = messages.length; await new OtpQueue(other, send).runOnce();
    assert.equal(messages.length - before, 1); assert.equal((await row(f)).status, "ACCEPTED");
    assert.equal(messages[before].headers.IdempotencyKey, f.j.id);
  }
  assert.equal(await units(), 2);
});

test("Native uncertain sends retain ciphertext, reservation and usable OTP across rotation without any redelivery", options, async () => {
  for (const kind of ["initial", "retake"] as const) {
    configure(); const f = await pending(kind); mode = "lost";
    await new OtpQueue(db, send).runOnce(); const uncertain = await row(f); const before = messages.length;
    assert.equal(uncertain.status, "UNCERTAIN"); configure("key-b"); mode = "accept";
    await new OtpQueue(other, send).runOnce(); await new EmailBudget(db).purgeExpiredData();
    const after = await row(f); assert.equal(messages.length, before);
    assert.equal(after.encryptedPayload, uncertain.encryptedPayload); assert.equal(after.codeHash, f.j.codeHash);
    assert.equal(after.nextAttemptAt, null);
    assert.equal((await db.emailBudgetReservation.findUniqueOrThrow({ where: { logicalKey: f.j.id } })).status, "UNCERTAIN");
    await assert.rejects(assertOtpKeyRetirable(db, "key-a"), /OTP_KEY_STILL_REQUIRED/);
    const result = kind === "initial" ? await entry({ ...f.p, challengeId: f.ownerId, verificationCode: f.code }) : await retake({ ...f.p, verificationCode: f.code });
    assert.equal(result.status, 201);
  }
  assert.equal(messages.length, 2); assert.equal(await units(), 2);
  assert.equal((await inspectOtpKeyUsage(db)).reduce((n, r) => n + r.uncertain, 0), 2);
});

test("Native missing old key blocks locally without losing ciphertext or transport attempts, then recovers with the same UUID", options, async () => {
  for (const kind of ["initial", "retake"] as const) {
    configure(); const f = await pending(kind); const before = messages.length; configure("key-b", false);
    for (let n = 0; n < 7; n++) {
      await due(f); await new OtpQueue(other, send).runOnce();
      const blocked = await row(f); assert.equal(blocked.encryptedPayload, f.j.encryptedPayload);
      assert.equal(blocked.attempts, 0); assert.equal(blocked.lastErrorCode, "OTP_PAYLOAD_KEY_UNAVAILABLE");
    }
    assert.equal(messages.length, before);
    assert.equal(await db.emailBudgetReservation.count({ where: { logicalKey: f.j.id } }), 0);
    configure("key-b"); await due(f); await new OtpQueue(db, send).runOnce();
    assert.equal(messages.length - before, 1); assert.equal(messages[before].headers.IdempotencyKey, f.j.id);
    assert.equal((await row(f)).status, "ACCEPTED");
  }
  assert.equal(await units(), 2);
});

test("Native unknown versions and altered payloads never call Brevo and remain recoverable until expiry", options, async () => {
  for (const [kind, failure] of [["initial", "version"], ["retake", "tag"]] as const) {
    const f = await pending(kind), parts = f.j.encryptedPayload.split(":");
    if (failure === "version") parts[0] = "v99";
    else parts[3] = (parts[3][0] === "a" ? "b" : "a") + parts[3].slice(1);
    const altered = parts.join(":");
    await db.$executeRawUnsafe(`UPDATE "${f.table}" SET "encryptedPayload"=$2 WHERE id=$1::uuid`, f.j.id, altered);
    await new OtpQueue(other, send).runOnce(); const blocked = await row(f);
    assert.equal(blocked.encryptedPayload, altered); assert.equal(blocked.attempts, 0);
    assert.equal(blocked.lastErrorCode, failure === "version" ? "OTP_PAYLOAD_VERSION_UNSUPPORTED" : "OTP_PAYLOAD_INVALID");
  }
  assert.equal(messages.length, 0); assert.equal(await units(), 0); assert.equal(await db.emailBudgetReservation.count(), 0);
});

test("Native known-429 retry across rotation keeps the immutable message, UUID and single budget charge", options, async () => {
  const f = await pending("initial"); mode = "rate"; await new OtpQueue(db, send).runOnce();
  assert.equal((await row(f)).status, "PENDING"); configure("key-b"); mode = "accept";
  await db.$executeRawUnsafe(`UPDATE "EmailProviderState" SET "blockedUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  await due(f); await new OtpQueue(other, send).runOnce(); await new OtpQueue(db, send).runOnce();
  assert.equal(messages.length, 2); assert.deepEqual(messages[0], messages[1]);
  assert.equal((await row(f)).status, "ACCEPTED"); assert.equal(await units(), 1); assert.equal(await db.emailBudgetReservation.count(), 1);
});

test("Native independent workers overlap during rotation and perform only one provider call per job", options, async () => {
  const pid = (await db.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
  const otherPid = (await other.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`))[0].pid;
  assert.notEqual(pid, otherPid);
  for (const kind of ["initial", "retake"] as const) {
    configure(); const f = await pending(kind); let entered!: () => void, release!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    onTransport = async () => { entered(); await barrier; }; const before = messages.length;
    const first = new OtpQueue(db, send).runOnce();
    try {
      await Promise.race([sending, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error("Transport barrier not reached")), 10000); timer.unref(); })]);
      configure("key-b"); await new OtpQueue(other, send).runOnce(); assert.equal(messages.length - before, 1);
    } finally { release(); await first; onTransport = undefined; }
    await new OtpQueue(other, send).runOnce(); assert.equal(messages.length - before, 1); assert.equal((await row(f)).status, "ACCEPTED");
  }
  console.log("LOT3 concurrent rotation proof", JSON.stringify({ pid, otherPid, jobs: 2, providerCalls: messages.length, budgetUnits: await units() }));
  assert.equal(await units(), 2);
});

test("Native retirement inventory includes both outboxes, expired/leased/uncertain payloads and blocks unsafe key withdrawal", options, async () => {
  const initial = await pending("initial"), legacy = await pending("retake", true); configure("key-b");
  await assert.rejects(assertOtpKeyRetirable(db, "key-b"), /OTP_KEY_STILL_ACTIVE/);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second',
    status='UNCERTAIN',"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 minutes',"attemptToken"=$2::uuid WHERE id=$1::uuid`, initial.j.id, initial.j.id);
  const before = await row(initial), usage = await inspectOtpKeyUsage(db);
  const old = usage.find(r => r.keyId === "key-a")!;
  assert.equal(old.payloads, 1); assert.equal(old.unexpired, 0); assert.equal(old.leased, 1); assert.equal(old.uncertain, 1);
  assert.equal(usage.find(r => r.format === "v1")?.payloads, 1);
  assert.deepEqual(await row(initial), before); // audit is read-only
  await assert.rejects(assertOtpKeyRetirable(db, "key-a"), /OTP_KEY_STILL_REQUIRED/);
  await assert.rejects(assertOtpKeyRetirable(db, "join-pepper"), /OTP_KEY_STILL_REQUIRED/);
  await db.$executeRawUnsafe(`UPDATE "${legacy.table}" SET "encryptedPayload"='unknown-format' WHERE id=$1::uuid`, legacy.j.id);
  await assert.rejects(assertOtpKeyRetirable(db, "unreferenced-key"), /OTP_KEY_STILL_REQUIRED/);
  await db.$executeRawUnsafe(`UPDATE "${legacy.table}" SET "encryptedPayload"=$2 WHERE id=$1::uuid`, legacy.j.id, legacy.j.encryptedPayload);
  await db.$executeRawUnsafe(`UPDATE "${initial.table}" SET "leaseUntil"=NULL,"attemptToken"=NULL WHERE id=$1::uuid`, initial.j.id);
  await new EmailBudget(db).purgeExpiredData();
  await assertOtpKeyRetirable(db, "key-a");
  configure("key-b", false); await new OtpQueue(other, send).runOnce();
  assert.equal((await row(legacy)).status, "ACCEPTED"); assert.equal(messages.length, 1);
});
