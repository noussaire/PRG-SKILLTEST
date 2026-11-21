import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { createGuestToken, hashGuestToken } from "../security/tokens.js";
import { createPreparedInterview } from "./prepared-interview.service.js";
import { interviewView, type InterviewState } from "./adaptive.service.js";
import { brevoConfigured } from "./brevo.service.js";
import { startEmailVerifiedParticipant, type EntryProfile, type EntryResult } from "./participant-email.service.js";
import { OtpDeliveryQueue } from "./otp-delivery.service.js";
import { EmailBudget } from "./email-budget.service.js";
import { EmailLimitError, normalizedEmailIdentity } from "./email-limits.js";

export const RETAKE_DELAY_MS = 30 * 86400000;
export const emailIdentity = normalizedEmailIdentity;
const emailBudget = new EmailBudget(prisma);
const otpQueue = new OtpDeliveryQueue(prisma);
const digest = (id: string, code: string, secret = env.JOIN_CODE_PEPPER) => createHmac("sha256", secret).update(`retake:${id}:${code}`).digest("hex");
function matchesRetakeDigest(id: string, code: string, expectedHex: string): boolean {
  const secrets = [env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS].filter((s): s is string => !!s && s.length >= 32);
  const expected = Buffer.from(expectedHex, "hex");
  return secrets.some(secret => {
    const candidate = Buffer.from(digest(id, code, secret), "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
type Profile = EntryProfile;

async function legacyRetake(profile: Profile, networkOrigin?: string) {
  const ar = profile.language === "ar", now = new Date(Date.now());
  const identity = emailIdentity(profile.email);
  const existing = await prisma.adaptiveInterview.findUnique({ where: { emailIdentity: identity }, include: { reportJob: true } });
  const failure = (status: number, code: string, fr: string, arabic: string, extra = {}) => ({ status, body: { code, error: ar ? arabic : fr, ...extra } });
  const conflict = () => failure(409, "INTERVIEW_BUSY", "Votre participation a changé. Rechargez la page pour reprendre.", "تغيرت مشاركتك. أعد تحميل الصفحة للمتابعة.");
  const token = createGuestToken(), state = createPreparedInterview(profile.language);
  const data = {
    tokenHash: hashGuestToken(token), displayName: profile.fullName.normalize("NFKC").replace(/\s+/g, " "),
    email: profile.email, emailIdentity: identity, reportEmailRequested: profile.emailReport,
    emailVerifiedAt: now,
    state: state as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 7 * 86400000), lastTestStartedAt: now,
  };
  if (!existing) return conflict();
  const nextAllowedAt = new Date(existing.lastTestStartedAt.getTime() + RETAKE_DELAY_MS);
  if (now < nextAllowedAt) {
    const date = nextAllowedAt.toLocaleString(ar ? "ar-MA" : "fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" });
    return failure(409, "RETAKE_COOLDOWN", `Cette adresse a déjà une participation. Vous pourrez refaire le test à partir du ${date}. Votre parcours actuel reste sauvegardé.`, `لهذا البريد مشاركة مسجلة. يمكنك إعادة الاختبار ابتداء من ${date}. يبقى مسارك الحالي محفوظا.`, { nextAllowedAt: nextAllowedAt.toISOString() });
  }
  if (!profile.verificationCode) {
    if (!brevoConfigured()) return failure(503, "RETAKE_EMAIL_UNAVAILABLE", "La confirmation par e-mail est momentanément indisponible. Votre ancien rapport est conservé.", "تأكيد البريد غير متاح مؤقتا. تقريرك السابق محفوظ.");
    const code = String(randomInt(100000, 1000000)), hash = digest(existing.id, code);
    const queued = await otpQueue.enqueue({ interviewId: existing.id, lastTestStartedAt: existing.lastTestStartedAt, codeHash: hash, payload: { recipient: existing.email!, recipientName: existing.displayName, networkOrigin,
        subject: ar ? "SkillQuest — رمز إعادة الاختبار" : "SkillQuest — Votre code pour refaire le test",
        htmlContent: `<html lang="${profile.language}" dir="${ar ? "rtl" : "ltr"}"><body style="font-family:Arial,sans-serif;color:#123348"><h1>SkillQuest</h1><p>${ar ? "رمز تأكيد إعادة اختبارك:" : "Votre code de confirmation pour refaire le test :"}</p><p dir="ltr" style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>${ar ? "صالح لمدة 10 دقائق. لا تشاركه مع أحد. إذا لم تطلب هذا الرمز، تجاهل الرسالة؛ يبقى تقريرك محفوظا." : "Valable 10 minutes. Ne le partagez pas. Si vous n’avez pas demandé ce code, ignorez ce message : votre rapport reste conservé."}</p><p>Association Chabab Connect</p></body></html>`,
    } });
    if (!queued) return conflict();
    // Keep the existing FR/AR form contract; delivery status is explicit metadata.
    return failure(409, "RETAKE_VERIFICATION_REQUIRED", "Saisissez le code reçu par e-mail. Un nouvel envoi sera possible après une minute.", "أدخل الرمز المرسل إلى بريدك. يمكن إعادة الإرسال بعد دقيقة.", { deliveryStatus: queued.status, retryAfterSeconds: 60 });
  }
  if (!existing.retakeCodeHash || !existing.retakeCodeExpiresAt || existing.retakeCodeExpiresAt <= now || existing.retakeCodeAttempts >= 5) {
    return failure(400, "RETAKE_CODE_INVALID", "Code expiré ou nombre d’essais atteint. Demandez un nouveau code.", "انتهت صلاحية الرمز أو استُنفدت المحاولات. اطلب رمزا جديدا.");
  }
  // Reserve each attempt atomically, including under concurrent requests.
  const correct = matchesRetakeDigest(existing.id, profile.verificationCode!, existing.retakeCodeHash);
  let reserved: boolean;
  try { reserved = await emailBudget.retakeAttempt({ id: existing.id, hash: existing.retakeCodeHash, correct, email: existing.email!, networkOrigin }); }
  catch (error) {
    if (!(error instanceof EmailLimitError)) throw error;
    return failure(400, "RETAKE_CODE_INVALID", "Code expiré ou nombre d’essais atteint. Réessayez plus tard.", "انتهت صلاحية الرمز أو استُنفدت المحاولات. حاول لاحقا.");
  }
  if (!reserved) return conflict();
  if (!correct) {
    return failure(400, "RETAKE_CODE_INVALID", "Code incorrect. Vérifiez les six chiffres reçus par e-mail.", "الرمز غير صحيح. تحقق من الأرقام الستة المرسلة إلى بريدك.");
  }
  const oldState = existing.state as unknown as InterviewState;
  const previousResult = !oldState.currentQuestion && oldState.summary
    ? JSON.parse(JSON.stringify({ state: oldState, reportJob: existing.reportJob ? { status: existing.reportJob.status, summary: existing.reportJob.summary, nextAttemptAt: existing.reportJob.nextAttemptAt, emailStatus: existing.reportJob.emailStatus, emailAcceptedAt: existing.reportJob.emailAcceptedAt } : null })) as Prisma.InputJsonValue
    : existing.previousResult as Prisma.InputJsonValue | null;
  const row = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
    const live = await tx.$queryRawUnsafe<unknown[]>(`SELECT id FROM "AdaptiveInterview" WHERE id=$1::uuid AND "retakeCodeHash"=$2 AND "retakeCodeExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`, existing.id, existing.retakeCodeHash);
    if (!live.length) return null;
    const locked = await tx.adaptiveInterview.updateMany({
      where: { id: existing.id, revision: existing.revision, retakeCodeHash: existing.retakeCodeHash, lastTestStartedAt: existing.lastTestStartedAt, OR: [{ busyUntil: null }, { busyUntil: { lte: now } }] },
      data: { ...data, revision: { increment: 1 }, busyUntil: null, retakeCodeHash: null, retakeCodeExpiresAt: null, retakeCodeSentAt: null, retakeCodeAttempts: 0, previousResult: previousResult ?? Prisma.DbNull },
    });
    if (locked.count !== 1) return null;
    const currentJob = await tx.adaptiveReportJob.findUnique({ where: { interviewId: existing.id } });
    if (currentJob) {
      const removed = await tx.adaptiveReportJob.deleteMany({ where: { id: currentJob.id, AND: [ { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, { OR: [{ emailLeaseUntil: null }, { emailLeaseUntil: { lte: now } }] } ] } });
      if (removed.count !== 1) throw new Error("RETAKE_WORKER_BUSY");
    }
    const unexpired = await tx.$queryRawUnsafe<unknown[]>(`SELECT 1 WHERE $1::timestamp>(clock_timestamp() AT TIME ZONE 'UTC')`, existing.retakeCodeExpiresAt);
    if (!unexpired.length) throw new Error("RETAKE_CODE_EXPIRED");
    return tx.adaptiveInterview.findUniqueOrThrow({ where: { id: existing.id } });
  }).catch(error => { if (error instanceof Error && ["RETAKE_WORKER_BUSY", "RETAKE_CODE_EXPIRED"].includes(error.message)) return null; throw error; });
  return row ? { status: 201, body: { token, interview: interviewView({ ...row, state }) } } : conflict();
}

export async function startParticipantTest(profile: Profile, networkOrigin?: string): Promise<EntryResult> {
  // In-flight pre-upgrade retake codes remain valid; no new unverified path.
  if (profile.verificationCode && !profile.challengeId) {
    const row = await prisma.adaptiveInterview.findUnique({ where: { emailIdentity: emailIdentity(profile.email) } });
    if (row?.retakeCodeHash && row.retakeCodeExpiresAt && row.retakeCodeExpiresAt > new Date() && row.retakeCodeAttempts < 5) {
      const correct = matchesRetakeDigest(row.id, profile.verificationCode, row.retakeCodeHash);
      if (correct) return legacyRetake(profile, networkOrigin);
      try { await emailBudget.retakeAttempt({ id: row.id, hash: row.retakeCodeHash, correct: false, email: profile.email, networkOrigin }); } catch (error) { if (!(error instanceof EmailLimitError)) throw error; }
      return { status: 400, body: { code: "EMAIL_CODE_INVALID", verificationStatus: "INVALID", error: profile.language === "ar" ? "\u0627\u0644\u0631\u0645\u0632 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d." : "Code incorrect ou inutilisable." } };
    }
  }
  return startEmailVerifiedParticipant(profile, networkOrigin);
}
