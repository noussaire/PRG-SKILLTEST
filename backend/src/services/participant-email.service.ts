import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createGuestToken, hashGuestToken } from "../security/tokens.js";
import { encryptOtpPayload } from "../security/otp-payload.js";
import { EmailBudget } from "./email-budget.service.js";
import { emailSubjectHash, normalizedEmailIdentity, EmailLimitError } from "./email-limits.js";
import { brevoConfigured } from "./brevo.service.js";
import { createPreparedInterview } from "./prepared-interview.service.js";
import { interviewView, type InterviewState } from "./adaptive.service.js";
import { linkOtpTrace, logOtpEvent, safeOtpCode } from "./otp-diagnostic.service.js";

const budget = new EmailBudget(prisma);

export type EntryProfile = { fullName: string; email: string; language: "fr" | "ar"; emailReport: boolean; verificationCode?: string; challengeId?: string; requestNewCode?: boolean };
export type EntryResult = { status: number; body: Record<string, unknown> };
type Challenge = { id: string; identityHash: string; codeHash: string; attempts: number; maxAttempts: number; expiresAt: Date; consumedAt: Date | null };
type Gate = { challengeId: string | null; nextIssueAt: Date };
export type VerificationStatus = "PENDING" | "SENT" | "UNCERTAIN" | "UNAVAILABLE" | "INVALID" | "EXPIRED" | "VERIFIED" | "LIMIT_REACHED";
const digest = (id: string, code: string, secret = process.env.JOIN_CODE_PEPPER!) => createHmac("sha256", secret).update(`entry:${id}:${code}`).digest("hex");
function matchesEntryDigest(id: string, code: string, expectedHex: string): boolean {
  const secrets = [process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS].filter((s): s is string => !!s && s.length >= 32);
  const expected = Buffer.from(expectedHex, "hex");
  return secrets.some(secret => {
    const candidate = Buffer.from(digest(id, code, secret), "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

function message(language: string, status: VerificationStatus) {
  const copy: Record<VerificationStatus, [string, string]> = {
    PENDING: ["L’envoi du code est en attente. Aucun test ne commence avant sa validation.", "إرسال الرمز قيد الانتظار. لن يبدأ الاختبار قبل تأكيده."],
    SENT: ["Code envoyé. Saisissez les six chiffres reçus par e-mail.", "أُرسل الرمز. أدخل الأرقام الستة التي تلقيتها بالبريد."],
    UNCERTAIN: ["L’envoi ne peut pas être confirmé. Si vous avez reçu le code, il reste utilisable jusqu’à son expiration.", "تعذر تأكيد الإرسال. إذا تلقيت الرمز، يبقى صالحا حتى انتهاء مدته."],
    UNAVAILABLE: ["L’envoi du code est momentanément indisponible. Aucun accès n’a été créé.", "إرسال الرمز غير متاح مؤقتا. لم يُنشأ أي وصول للاختبار."],
    INVALID: ["Code incorrect ou inutilisable. Vérifiez les six chiffres ou demandez un nouveau code.", "الرمز غير صحيح أو غير صالح للاستعمال. تحقق من الأرقام الستة أو اطلب رمزا جديدا."],
    EXPIRED: ["Ce code a expiré. Demandez un nouveau code.", "انتهت صلاحية هذا الرمز. اطلب رمزا جديدا."],
    VERIFIED: ["Adresse e-mail vérifiée.", "تم تأكيد عنوان البريد الإلكتروني."],
    LIMIT_REACHED: ["Limite de demandes ou d’essais atteinte. Réessayez après le délai indiqué.", "تم بلوغ حد الطلبات أو المحاولات. حاول بعد المدة المحددة."],
  };
  return copy[status][language === "ar" ? 1 : 0];
}
function result(profile: EntryProfile, status: number, code: string, state: VerificationStatus, extra: Record<string, unknown> = {}): EntryResult {
  return { status, body: { code, error: message(profile.language, state), verificationStatus: state, ...extra } };
}

export async function emailChallengeStatus(id: string): Promise<Record<string, unknown>> {
  const rows = await prisma.$queryRawUnsafe<(Challenge & { jobId: string | null; active: string | null; nextIssueAt: Date | null; deliveryStatus: string | null; lastErrorCode: string | null; dbNow: Date })[]>(`
    SELECT c.*,j.id AS "jobId",g."challengeId" AS active,g."nextIssueAt",j.status AS "deliveryStatus",j."lastErrorCode",clock_timestamp() AS "dbNow"
    FROM "EmailOtpChallenge" c LEFT JOIN "ParticipantEmailGate" g ON g."identityHash"=c."identityHash"
    LEFT JOIN "ParticipantEmailDeliveryJob" j ON j."challengeId"=c.id WHERE c.id=$1::uuid AND c.purpose='INITIAL'`, id);
  const row = rows[0];
  if (!row) return { verificationStatus: "INVALID" };
  let state: VerificationStatus;
  if (row.consumedAt) state = "VERIFIED";
  else if (row.expiresAt <= row.dbNow || row.active !== row.id) state = "EXPIRED";
  else if (row.attempts >= Math.min(5, row.maxAttempts)) state = "LIMIT_REACHED";
  else if (["EMAIL_LOCAL_LIMIT", "BREVO_QUOTA", "EMAIL_OTP_COOLDOWN"].includes(row.lastErrorCode ?? "")) state = "LIMIT_REACHED";
  else state = row.deliveryStatus === "ACCEPTED" ? "SENT" : row.deliveryStatus === "UNCERTAIN" ? "UNCERTAIN" : row.deliveryStatus === "REJECTED" ? "UNAVAILABLE" : "PENDING";
  logOtpEvent("OTP_DELIVERY_STATUS", state === "SENT" || state === "VERIFIED" ? "ok" : state === "UNCERTAIN" ? "uncertain" : state === "PENDING" || state === "LIMIT_REACHED" ? "waiting" : "failed",
    { traceId: row.jobId ?? undefined, deliveryState: state, code: row.lastErrorCode ? safeOtpCode(row.lastErrorCode) : "STATE_OBSERVED" });
  return { verificationStatus: state, challengeId: id, expiresAt: row.expiresAt.toISOString(), resendAfterSeconds: Math.max(0, Math.ceil(((row.nextIssueAt?.getTime() ?? 0) - row.dbNow.getTime()) / 1000)) };
}

async function issue(profile: EntryProfile, networkOrigin?: string): Promise<EntryResult> {
  if (!brevoConfigured()) {
    logOtpEvent("BREVO_SEND_SKIPPED", "disabled", { code: "BREVO_NOT_CONFIGURED" });
    return result(profile, 503, "EMAIL_UNAVAILABLE", "UNAVAILABLE");
  }
  const identityHash = emailSubjectHash("IDENTITY", normalizedEmailIdentity(profile.email));
  const issued = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
    const now = (await tx.$queryRawUnsafe<{ now: Date }[]>(`SELECT clock_timestamp() AS now`))[0].now;
    const gate = (await tx.$queryRawUnsafe<Gate[]>(`INSERT INTO "ParticipantEmailGate" ("identityHash","nextIssueAt") VALUES ($1,$2)
      ON CONFLICT ("identityHash") DO UPDATE SET "identityHash"=EXCLUDED."identityHash"
      RETURNING "challengeId","nextIssueAt"`, identityHash, now))[0];
    const old = gate.challengeId ? (await tx.$queryRawUnsafe<(Challenge & { jobId: string | null; deliveryStatus: string | null })[]>(`SELECT c.*,j.id AS "jobId",j.status AS "deliveryStatus" FROM "EmailOtpChallenge" c
      LEFT JOIN "ParticipantEmailDeliveryJob" j ON j."challengeId"=c.id WHERE c.id=$1::uuid`, gate.challengeId))[0] : null;
    if (old && !old.consumedAt && old.expiresAt > now && old.attempts < 5 &&
      (!profile.requestNewCode || gate.nextIssueAt > now || ["PENDING", "UNCERTAIN"].includes(old.deliveryStatus ?? "PENDING"))) return { id: old.id, limited: false, jobId: old.jobId, reused: true };
    if (gate.nextIssueAt > now) return { id: gate.challengeId, limited: true, jobId: old?.jobId, reused: true, retry: Math.max(1, Math.ceil((gate.nextIssueAt.getTime() - now.getTime()) / 1000)) };
    const id = randomUUID(), jobId = randomUUID(), code = String(randomInt(100000, 1000000));
    const codeHash = digest(id, code), ar = profile.language === "ar";
    // expiresAt is computed entirely server-side to avoid JS/PG clock desynchronisation
    // on Windows hosts where Prisma Date round-trip can cause expiresAt < createdAt (CHECK violation).
    const [challengeRow] = await tx.$queryRawUnsafe<{ expiresAt: Date; createdAt: Date }[]>(`
      WITH ts AS (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now)
      INSERT INTO "EmailOtpChallenge" (id,"identityHash",purpose,"codeHash","expiresAt","createdAt")
      SELECT $1::uuid,$2,'INITIAL',$3, ts.now+interval '10 minutes', ts.now FROM ts
      RETURNING "expiresAt","createdAt"`,
      id, identityHash, codeHash);
    const expiresAt = challengeRow.expiresAt;
    const payload = { recipient: profile.email, recipientName: profile.fullName, networkOrigin,
      subject: ar ? "SkillQuest — تأكيد البريد الإلكتروني" : "SkillQuest — Vérifiez votre adresse e-mail",
      htmlContent: `<html lang="${profile.language}" dir="${ar ? "rtl" : "ltr"}"><body><h1>SkillQuest</h1><p>${ar ? "رمز تأكيد عنوان بريدك:" : "Votre code de vérification :"}</p><p dir="ltr" style="font-size:28px;letter-spacing:6px">${code}</p><p>${ar ? "صالح لمدة 10 دقائق. لا تشاركه مع أحد. إذا لم تطلبه فتجاهل الرسالة." : "Valable 10 minutes. Ne le partagez pas. Si vous ne l'avez pas demandé, ignorez ce message."}</p></body></html>` };
    await tx.$executeRawUnsafe(`INSERT INTO "ParticipantEmailDeliveryJob" (id,"challengeId","codeHash","encryptedPayload","expiresAt","nextAttemptAt")
      VALUES ($1::uuid,$2::uuid,$3,$4,$5,(clock_timestamp() AT TIME ZONE 'UTC'))`, jobId, id, codeHash, encryptOtpPayload(payload, jobId), expiresAt);
    await tx.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "challengeId"=$2::uuid,"nextIssueAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '60 seconds' WHERE "identityHash"=$1`, identityHash, id);
    return { id, limited: false, jobId, reused: false };
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 }).catch(error => {
    logOtpEvent("OTP_JOB_FAILED", "failed", { code: safeOtpCode(error) });
    throw error;
  });
  if (issued.jobId) linkOtpTrace(issued.jobId);
  if (!issued.limited) logOtpEvent(issued.reused ? "OTP_JOB_REUSED" : "OTP_JOB_CREATED", "ok", { traceId: issued.jobId ?? undefined });
  else logOtpEvent("OTP_JOB_REUSED", "waiting", { code: "EMAIL_LIMIT_REACHED" });
  if (issued.limited) return result(profile, 429, "EMAIL_LIMIT_REACHED", "LIMIT_REACHED", { challengeId: issued.id, retryAfterSeconds: issued.retry });
  const state = await emailChallengeStatus(issued.id!);
  return result(profile, 409, "EMAIL_VERIFICATION_REQUIRED", state.verificationStatus as VerificationStatus, state);
}

export async function startEmailVerifiedParticipant(profile: EntryProfile, networkOrigin?: string): Promise<EntryResult> {
  if (!profile.verificationCode) return issue(profile, networkOrigin);
  const identityHash = emailSubjectHash("IDENTITY", normalizedEmailIdentity(profile.email));
  try {
    return await budget.withOtpAttempt(profile.email, networkOrigin, async (tx, now, recordFailure) => {
      const gate = (await tx.$queryRawUnsafe<Gate[]>(`SELECT "challengeId","nextIssueAt" FROM "ParticipantEmailGate" WHERE "identityHash"=$1 FOR UPDATE`, identityHash))[0];
      const id = profile.challengeId ?? gate?.challengeId;
      const challenge = id ? (await tx.$queryRawUnsafe<Challenge[]>(`SELECT * FROM "EmailOtpChallenge" WHERE id=$1::uuid AND "identityHash"=$2 AND purpose='INITIAL' FOR UPDATE`, id, identityHash))[0] : null;
      if (!challenge || gate?.challengeId !== challenge.id || challenge.consumedAt) {
        await recordFailure(); return result(profile, 400, "EMAIL_CODE_INVALID", "INVALID");
      }
      if (challenge.expiresAt <= now) return result(profile, 400, "EMAIL_CODE_EXPIRED", "EXPIRED", { challengeId: id });
      // Explicitly undo validation mutations before returning a business expiry.
      // A failed rollback (or outer commit) must propagate as a technical error.
      await tx.$executeRawUnsafe(`SAVEPOINT email_entry_validation`);
      const attempt = await tx.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET attempts=attempts+1 WHERE id=$1::uuid AND "consumedAt" IS NULL
        AND attempts<LEAST(5,"maxAttempts") AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')`, id);
      if (attempt !== 1) {
        const [current] = await tx.$queryRawUnsafe<{ expired: boolean; limited: boolean }[]>(`SELECT "expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AS expired,
          attempts>=LEAST(5,"maxAttempts") AS limited FROM "EmailOtpChallenge" WHERE id=$1::uuid`, id);
        if (current?.expired) return result(profile, 400, "EMAIL_CODE_EXPIRED", "EXPIRED", { challengeId: id });
        if (!current?.limited) throw new Error("EMAIL_CHALLENGE_ATTEMPT_FAILED");
        return result(profile, 429, "EMAIL_LIMIT_REACHED", "LIMIT_REACHED", { challengeId: id, retryAfterSeconds: Math.max(1, Math.ceil((gate.nextIssueAt.getTime() - now.getTime()) / 1000)) });
      }
      const correct = matchesEntryDigest(challenge.id, profile.verificationCode!, challenge.codeHash);
      if (!correct) { await recordFailure(); return result(profile, 400, "EMAIL_CODE_INVALID", "INVALID", { challengeId: id }); }
      const outcome = await commitVerifiedEntry(tx, profile, now);
      if (outcome.body.code === "INTERVIEW_BUSY") return outcome;
      const consumed = await tx.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "consumedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=$1::uuid
        AND "consumedAt" IS NULL AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')`, id);
      if (consumed !== 1) {
        const [current] = await tx.$queryRawUnsafe<{ expired: boolean }[]>(`SELECT "expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AS expired FROM "EmailOtpChallenge" WHERE id=$1::uuid`, id);
        if (!current?.expired) throw new Error("EMAIL_CHALLENGE_CONSUMPTION_FAILED");
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT email_entry_validation`);
        return result(profile, 400, "EMAIL_CODE_EXPIRED", "EXPIRED", { challengeId: id });
      }
      return outcome;
    });
  } catch (error) {
    if (error instanceof EmailLimitError) return result(profile, 429, "EMAIL_LIMIT_REACHED", "LIMIT_REACHED", { retryAfterSeconds: error.retryAfterSeconds, challengeId: profile.challengeId });
    if (error instanceof Error && error.message === "ENTRY_WORKER_BUSY") return result(profile, 409, "INTERVIEW_BUSY", "VERIFIED");
    throw error;
  }
}

async function commitVerifiedEntry(tx: Prisma.TransactionClient, profile: EntryProfile, now: Date): Promise<EntryResult> {
  const identity = normalizedEmailIdentity(profile.email);
  const existing = await tx.adaptiveInterview.findUnique({ where: { emailIdentity: identity }, include: { reportJob: true } });
  // Eligibility is disclosed only after possession of a valid OTP is proven.
  if (existing && now.getTime() < existing.lastTestStartedAt.getTime() + 30 * 86400000) {
    const next = new Date(existing.lastTestStartedAt.getTime() + 30 * 86400000);
    return result(profile, 409, "RETAKE_COOLDOWN", "VERIFIED", { nextAllowedAt: next.toISOString(), error: profile.language === "ar" ? "تم تأكيد البريد. يمكن إعادة الاختبار بعد 30 يوما من آخر بدء. يبقى مسارك الحالي محفوظا." : "Adresse vérifiée. Un nouveau test est possible 30 jours après le dernier démarrage. Votre parcours actuel reste sauvegardé." });
  }
  const token = createGuestToken(), state = createPreparedInterview(profile.language);
  const data = { tokenHash: hashGuestToken(token), displayName: profile.fullName.normalize("NFKC").replace(/\s+/g, " "), email: profile.email,
    emailIdentity: identity, emailVerifiedAt: now, reportEmailRequested: profile.emailReport, state: state as unknown as Prisma.InputJsonValue,
    expiresAt: new Date(now.getTime() + 7 * 86400000), lastTestStartedAt: now };
  if (!existing) {
    const row = await tx.adaptiveInterview.create({ data });
    return { status: 201, body: { token, interview: interviewView({ ...row, state }) } };
  }
  const oldState = existing.state as unknown as InterviewState;
  const previousResult = !oldState.currentQuestion && oldState.summary
    ? JSON.parse(JSON.stringify({ state: oldState, reportJob: existing.reportJob ? { status: existing.reportJob.status, summary: existing.reportJob.summary, nextAttemptAt: existing.reportJob.nextAttemptAt, emailStatus: existing.reportJob.emailStatus, emailAcceptedAt: existing.reportJob.emailAcceptedAt } : null })) as Prisma.InputJsonValue
    : existing.previousResult as Prisma.InputJsonValue | null;
  const locked = await tx.adaptiveInterview.updateMany({ where: { id: existing.id, revision: existing.revision, lastTestStartedAt: existing.lastTestStartedAt,
    OR: [{ busyUntil: null }, { busyUntil: { lte: now } }] }, data: { ...data, revision: { increment: 1 }, busyUntil: null, retakeCodeHash: null,
      retakeCodeExpiresAt: null, retakeCodeSentAt: null, retakeCodeAttempts: 0, previousResult: previousResult ?? Prisma.DbNull } });
  if (locked.count !== 1) return result(profile, 409, "INTERVIEW_BUSY", "VERIFIED");
  if (existing.reportJob) {
    const removed = await tx.adaptiveReportJob.deleteMany({ where: { id: existing.reportJob.id, AND: [
      { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, { OR: [{ emailLeaseUntil: null }, { emailLeaseUntil: { lte: now } }] },
    ] } });
    if (removed.count !== 1) throw new Error("ENTRY_WORKER_BUSY");
  }
  const row = await tx.adaptiveInterview.findUniqueOrThrow({ where: { id: existing.id } });
  return { status: 201, body: { token, interview: interviewView({ ...row, state }) } };
}
