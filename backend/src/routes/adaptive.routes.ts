import { Router, type Request, type Response } from "express";
import { rateLimit } from "../security/http-rate-limit.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { hashGuestToken } from "../security/tokens.js";
import { getAdaptiveCatalog, interviewView, AIServiceError, type InterviewState } from "../services/adaptive.service.js";
import { upgradePreparedInterview, advancePreparedInterview, PREPARED_ENGINE } from "../services/prepared-interview.service.js";
import { enqueueReport, enqueueReportInTransaction, processReportQueue } from "../services/report-queue.service.js";
import { reportSummaryConfigured } from "../services/report-summary.service.js";
import { reportEmailConfigured } from "../services/brevo.service.js";
import { startParticipantTest } from "../services/participant-retake.service.js";
import { emailChallengeStatus } from "../services/participant-email.service.js";
import { emailSubjectHash, normalizedEmailIdentity } from "../services/email-limits.js";
import { downloadPdf, pdfDownloadFailure } from "../services/pdf-download.service.js";
import { guestAccessValid } from "../services/session-policy.js";
import { wakeJobs } from "../services/job-dispatch.service.js";
import { logOtpEvent, safeOtpCode } from "../services/otp-diagnostic.service.js";

export const adaptiveRouter = Router();
const languageSchema = z.enum(["fr", "ar"]);
const startSchema = z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().trim().max(254).email().transform(value => value.toLowerCase()), language: languageSchema, consent: z.literal(true), adult: z.literal(true), emailReport: z.boolean().default(false), verificationCode: z.string().regex(/^\d{6}$/).optional(), challengeId: z.string().uuid().optional(), requestNewCode: z.boolean().optional() });
const answerSchema = z.object({ questionId: z.string().min(1).max(100), choiceId: z.string().uuid() });
const prepareSchema = z.object({ questionId: z.string().min(1).max(100) });
const bearer = (req: Request) => /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? "")?.[1];
// A whole class may share one public IP, including through the frontend proxy.
const startLimiter = rateLimit({ windowMs: 3600000, limit: 500,
  keyGenerator: req => emailSubjectHash("IDENTITY", typeof req.body?.email === "string" ? normalizedEmailIdentity(req.body.email.slice(0, 254)) : "invalid-input"),
  standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Trop de demandes pour cette identité.", code: "RATE_LIMIT" } });
const answerLimiter = rateLimit({ windowMs: 60000, limit: 100, keyGenerator: req => hashGuestToken(bearer(req) ?? "missing"), standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Trop de requêtes. Votre progression est conservée.", code: "RATE_LIMIT" } });
const jsonState = (state: InterviewState) => state as unknown as Prisma.InputJsonValue;
const readState = (state: Prisma.JsonValue) => state as unknown as InterviewState;
const unauthorized = (res: Response) => res.status(401).json({ error: "Parcours expiré ou accès invalide.", code: "UNAUTHORIZED" });

adaptiveRouter.use((req, res, next) => {
  if (!languageSchema.optional().safeParse(req.query.lang).success) return void res.status(400).json({ error: "Langue invalide." });
  next();
});

adaptiveRouter.get("/config", (req, res) => {
  const language = languageSchema.safeParse(req.query.lang ?? "fr");
  if (!language.success) return void res.status(400).json({ error: "Langue invalide." });
  res.json({ configured: true, mode: PREPARED_ENGINE, aiReportAvailable: reportSummaryConfigured(), reportEmailAvailable: reportEmailConfigured(), totalQuestions: 31, skills: getAdaptiveCatalog(language.data) });
});

adaptiveRouter.post("/start", startLimiter, async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: req.query.lang === "ar" ? "الاسم الكامل والبريد الإلكتروني الصحيح وتأكيد السن والموافقة مطلوبة." : "Nom complet, adresse e-mail valide, majorité et consentement sont requis.", code: "INVALID_INPUT" });
  if (res.locals.participantNetwork === null) return void res.status(503).json({ code: "EMAIL_NETWORK_UNAVAILABLE",
    verificationStatus: "UNAVAILABLE", error: parsed.data.language === "ar" ? "تعذر التحقق من الشبكة. حاول لاحقا." : "Identité réseau indisponible. Réessayez ultérieurement." });
  const result = await startParticipantTest(parsed.data, res.locals.participantNetwork);
  logOtpEvent("START_RESULT", [409, 429].includes(result.status) ? "waiting" : result.status >= 400 ? "failed" : "ok",
    { httpStatus: result.status, code: result.body.code === undefined ? undefined : safeOtpCode(result.body.code) });
  await wakeJobs();
  if ("retryAfterSeconds" in result.body && typeof result.body.retryAfterSeconds === "number") res.setHeader("Retry-After", String(result.body.retryAfterSeconds));
  res.status(result.status).json(result.body);
});

adaptiveRouter.get("/email-verification/:id", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) return void res.status(400).json({ verificationStatus: "INVALID" });
  res.json(await emailChallengeStatus(parsed.data));
});

// Also enforce revocations recorded before this fix, whose mirror's expiresAt
// was never updated. Standalone OTP interviews have no legacy mirror.
adaptiveRouter.use(async (req, res, next) => {
  if (!["GET", "POST"].includes(req.method) || !["/me", "/me/report.pdf", "/me/summary", "/me/report-email/withdraw", "/answer", "/choices"].includes(req.path)) return next();
  const token = bearer(req);
  if (!token) return void unauthorized(res);
  const mirror = await prisma.participant.findUnique({ where: { guestTokenHash: hashGuestToken(token) } });
  if (mirror && !guestAccessValid(mirror)) return void unauthorized(res);
  next();
});

adaptiveRouter.get("/me", async (req, res) => {
  const token = bearer(req);
  const interview = token ? await prisma.adaptiveInterview.findUnique({ where: { tokenHash: hashGuestToken(token) }, include: { reportJob: true } }) : null;
  if (!interview || interview.expiresAt <= new Date()) return void unauthorized(res);
  const state = readState(interview.state);
  const job = interview.reportJob;
  res.json(interviewView({ ...interview, state }, job ?? undefined, languageSchema.optional().parse(req.query.lang)));
});

adaptiveRouter.get("/me/report.pdf", async (req, res) => {
  const token = bearer(req);
  const interview = token ? await prisma.adaptiveInterview.findUnique({ where: { tokenHash: hashGuestToken(token) }, include: { reportJob: true } }) : null;
  if (!interview || interview.expiresAt <= new Date()) return void unauthorized(res);
  const state = readState(interview.state);
  if (state.currentQuestion || state.answers.length !== 31) return void res.status(409).json({ code: "REPORT_NOT_READY" });
  const langParsed = languageSchema.safeParse(req.query.lang);
  const lang = langParsed.success ? langParsed.data : undefined;
  const job = interview.reportJob ?? { status: "UNAVAILABLE", summary: null, nextAttemptAt: new Date() };
  try {
    const pdf = await downloadPdf(res, interview, job, lang);
    // A revocation/deletion during Chromium rendering must not release a late PDF.
    const active = await prisma.adaptiveInterview.findFirst({ where: { id: interview.id, tokenHash: interview.tokenHash, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!active) return void unauthorized(res);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="SkillQuest-rapport.pdf"');
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (error) {
    if (res.destroyed) return;
    const failure = pdfDownloadFailure(error);
    if (failure.retryAfter) res.setHeader("Retry-After", String(failure.retryAfter));
    res.setHeader("Cache-Control", "private, no-store");
    res.status(failure.status).json(failure.body);
  }
});

// Explicit bearer-authorized mutation; await one fenced attempt within this invocation.
// No detached promise, queue publication or automatic retry loop is required.
adaptiveRouter.post("/me/summary", answerLimiter, async (req, res) => {
  const token = bearer(req);
  const interview = token ? await prisma.adaptiveInterview.findUnique({ where: { tokenHash: hashGuestToken(token) } }) : null;
  if (!interview || interview.expiresAt <= new Date()) return void unauthorized(res);
  const state = readState(interview.state);
  if (state.currentQuestion || state.answers.length !== 31 || !state.summary) return void res.status(409).json({ code: "REPORT_NOT_READY" });
  const job = await enqueueReport(interview.id);
  if (job) await processReportQueue(job.id);
  await wakeJobs();
  const current = await prisma.adaptiveInterview.findUnique({ where: { id: interview.id }, include: { reportJob: true } });
  if (!current || current.expiresAt <= new Date()) return void unauthorized(res);
  res.setHeader("Cache-Control", "no-store");
  res.json(interviewView({ ...current, state: readState(current.state) }, current.reportJob ?? undefined, languageSchema.optional().parse(req.query.lang)));
});

adaptiveRouter.post(["/answer", "/choices"], answerLimiter, async (req, res) => {
  const token = bearer(req);
  if (!token) return void unauthorized(res);
  const upgrading = req.path === "/choices";
  const parsed = (upgrading ? prepareSchema : answerSchema).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Sélectionnez une proposition de cette question.", code: "INVALID_INPUT" });
  const interview = await prisma.adaptiveInterview.findUnique({ where: { tokenHash: hashGuestToken(token) }, include: { reportJob: true } });
  if (!interview || interview.expiresAt <= new Date()) return void unauthorized(res);
  const state = readState(interview.state);
  if (!state.currentQuestion || state.currentQuestion.id !== parsed.data.questionId) return void res.status(409).json({ error: "Cette question a déjà changé. Rechargez pour reprendre.", code: "STALE_QUESTION" });
  if (upgrading && state.engine) return void res.json(interviewView({ ...interview, state }, interview.reportJob ?? undefined, languageSchema.optional().parse(req.query.lang)));
  const now = new Date(), lease = new Date(now.getTime() + 15000);
  const locked = await prisma.adaptiveInterview.updateMany({ where: { id: interview.id, revision: interview.revision, expiresAt: { gt: now }, OR: [{ busyUntil: null }, { busyUntil: { lte: now } }] }, data: { busyUntil: lease } });
  if (locked.count !== 1) return void res.status(409).json({ error: "Une réponse est en cours de sauvegarde. Patientez un instant.", code: "INTERVIEW_BUSY" });
  try {
    const next = upgrading ? upgradePreparedInterview(state) : advancePreparedInterview(state, parsed.data);
    const saved = await prisma.$transaction(async tx => {
      const updated = await tx.adaptiveInterview.updateMany({ where: { id: interview.id, revision: interview.revision, busyUntil: lease, expiresAt: { gt: new Date() } }, data: { state: jsonState(next), revision: { increment: 1 }, busyUntil: null, ...(!next.currentQuestion && next.summary ? { previousResult: Prisma.DbNull } : {}) } });
      if (updated.count !== 1) return { count: updated.count, job: interview.reportJob };
      // Final answer, report job and SQL-triggered publication intent commit together.
      const job = !next.currentQuestion && next.summary && next.engine ? await enqueueReportInTransaction(tx, interview.id) : interview.reportJob;
      return { count: updated.count, job };
    });
    if (saved.count !== 1) return void res.status(409).json({ error: "Le parcours a changé. Rechargez pour reprendre.", code: "STALE_QUESTION" });
    const job = saved.job;
    if (job) await wakeJobs();
    res.json(interviewView({ ...interview, state: next }, job ?? undefined, languageSchema.optional().parse(req.query.lang)));
  } catch (error) {
    if (error instanceof AIServiceError) res.status(error.status).json({ error: error.message, code: error.code });
    else throw error;
  } finally {
    await prisma.adaptiveInterview.updateMany({ where: { id: interview.id, revision: interview.revision, busyUntil: lease }, data: { busyUntil: null } });
  }
});

adaptiveRouter.delete("/me", (_req, res) => {
  res.status(403).json({ error: "Seule l’administration peut supprimer une participation.", code: "ADMIN_ONLY" });
});

// Withdrawal is idempotent and requires the participant token. PROCESSING jobs
// recheck this choice inside beforeClaim; accepted provider mail cannot be recalled.
adaptiveRouter.post("/me/report-email/withdraw", async (req, res) => {
  const token = bearer(req);
  if (!token) return void unauthorized(res);
  const changed = await prisma.adaptiveInterview.updateMany({ where: { tokenHash: hashGuestToken(token), expiresAt: { gt: new Date() } }, data: { reportEmailRequested: false } });
  if (!changed.count) return void unauthorized(res);
  res.json({ reportEmailRequested: false });
});
