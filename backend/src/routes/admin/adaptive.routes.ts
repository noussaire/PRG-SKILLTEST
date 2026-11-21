import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAdminAuth } from "../../security/adminAuth.js";
import { adaptiveDashboard, adminParticipantDetail, participantOverview } from "../../services/adaptive-admin.service.js";
import { enqueueReport, processReportQueue } from "../../services/report-queue.service.js";
import { downloadPdf, pdfDownloadFailure } from "../../services/pdf-download.service.js";
import type { InterviewState } from "../../services/adaptive.service.js";

export const adminAdaptiveRouter = Router();
adminAdaptiveRouter.use(requireAdminAuth);
const locale = z.enum(["fr", "ar"]).default("fr");
// Do not select participant access tokens, hashes, private scoring rubrics or provider errors.
const selection = {
  id: true, displayName: true, email: true, state: true, previousResult: true, lastTestStartedAt: true, reportEmailRequested: true, createdAt: true, updatedAt: true, expiresAt: true,
  reportJob: { select: { status: true, summary: true, nextAttemptAt: true, updatedAt: true, emailStatus: true, emailAcceptedAt: true } },
} as const;

adminAdaptiveRouter.get("/dashboard", async (req, res) => {
  const language = locale.safeParse(req.query.lang);
  if (!language.success) return void res.status(400).json({ error: "Langue invalide." });
  const rows = await prisma.adaptiveInterview.findMany({ select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  res.json(adaptiveDashboard(rows, language.data));
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["ALL", "IN_PROGRESS", "COMPLETED"]).default("ALL"),
  ai: z.enum(["ALL", "COMPLETE", "PENDING", "UNAVAILABLE"]).default("ALL"),
});
adminAdaptiveRouter.get("/participants", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Filtres invalides." });
  const { page, limit, search, status, ai } = parsed.data;
  // States are JSON snapshots; filter their derived status consistently with the participant report.
  const rows = await prisma.adaptiveInterview.findMany({
    where: search ? { OR: [{ displayName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : undefined,
    select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const all = rows.map(participantOverview).filter(row => (status === "ALL" || row.status === status)
    && (ai === "ALL" || ai === "COMPLETE" && row.aiGenerated || ai === "PENDING" && ["PENDING", "PROCESSING", "RETRY"].includes(row.aiStatus) || ai === "UNAVAILABLE" && row.status === "COMPLETED" && !row.aiGenerated && !["PENDING", "PROCESSING", "RETRY"].includes(row.aiStatus)));
  res.json({ participants: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / limit)) } });
});

adminAdaptiveRouter.get("/participants/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id), language = locale.safeParse(req.query.lang);
  if (!id.success || !language.success) return void res.status(400).json({ error: "Identifiant ou langue invalide." });
  const row = await prisma.adaptiveInterview.findUnique({ where: { id: id.data }, select: selection });
  if (!row) return void res.status(404).json({ error: "Participant introuvable." });
  // Reading a report never enqueues or calls AI, including after participant access has expired.
  res.json(adminParticipantDetail(row, language.data));
});

adminAdaptiveRouter.get("/participants/:id/report.pdf", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const langParsed = z.enum(["fr", "ar"]).safeParse(req.query.lang);
  const lang = langParsed.success ? langParsed.data : undefined;
  if (!id.success) return void res.status(400).json({ error: "Identifiant invalide." });
  const row = await prisma.adaptiveInterview.findUnique({ where: { id: id.data }, include: { reportJob: true } });
  if (!row) return void res.status(404).json({ error: "Participant introuvable." });
  const state = row.state as unknown as InterviewState;
  if (state.currentQuestion || state.answers?.length !== 31) {
    return void res.status(409).json({ error: "Le bilan doit être terminé pour exporter le rapport.", code: "REPORT_NOT_READY" });
  }
  const job = row.reportJob ?? { status: "UNAVAILABLE", summary: null, nextAttemptAt: new Date() };
  try {
    const pdf = await downloadPdf(res, row, job, lang);
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

adminAdaptiveRouter.post("/participants/:id/summary", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id), language = locale.safeParse(req.query.lang);
  if (!id.success || !language.success) return void res.status(400).json({ error: "Identifiant ou langue invalide." });
  const interview = await prisma.adaptiveInterview.findUnique({ where: { id: id.data } });
  if (!interview) return void res.status(404).json({ error: "Participant introuvable." });
  if (interview.expiresAt <= new Date()) return void res.status(410).json({ error: "Cette participation a expiré.", code: "EXPIRED" });
  const state = interview.state as unknown as InterviewState;
  if (state.currentQuestion || state.answers?.length !== 31 || !state.summary) {
    return void res.status(409).json({ error: "Le bilan doit être terminé pour générer la synthèse.", code: "REPORT_NOT_READY" });
  }
  const job = await enqueueReport(interview.id);
  if (job) await processReportQueue(job.id);
  const updated = await prisma.adaptiveInterview.findUnique({ where: { id: interview.id }, select: selection });
  if (!updated) return void res.status(404).json({ error: "Participant introuvable." });
  res.setHeader("Cache-Control", "no-store");
  res.json(adminParticipantDetail(updated, language.data));
});

adminAdaptiveRouter.delete("/participants/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Identifiant invalide." });
  const deleted = await prisma.$transaction(async tx => {
    const row = await tx.adaptiveInterview.findUnique({ where: { id: id.data } });
    if (!row) return false;
    // Keep the legacy attempt/decision history and immutable published versions.
    // Its identity is removed; the revoked token hash remains as an idempotency
    // tombstone so replaying an old registration cannot resurrect that bearer.
    await tx.participant.updateMany({ where: { guestTokenHash: row.tokenHash }, data: {
      displayName: "SYNTH-DELETED",
      userId: null, revokedAt: new Date(), tokenExpiresAt: new Date(0),
    } });
    const removed = await tx.adaptiveInterview.deleteMany({ where: { id: row.id, tokenHash: row.tokenHash } });
    if (removed.count !== 1) throw new Error("PARTICIPATION_CHANGED");
    return true;
  });
  if (!deleted) return void res.status(404).json({ error: "Participant introuvable." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ deleted: true, id: id.data });
});
