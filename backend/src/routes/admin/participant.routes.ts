import { Router } from "express";
import { generateAttemptReport } from "../../services/evaluation.service.js";
import { readFrozenGraph, type FrozenChoice, type FrozenImpact } from "../../services/graph.service.js";
import { canonicalSlug } from "../../services/scoring.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAdminAuth } from "../../security/adminAuth.js";

export const adminParticipantRouter = Router();

adminParticipantRouter.use(requireAdminAuth);
adminParticipantRouter.param("id", (req, res, next, value: string) => { if (!z.string().uuid().safeParse(value).success) return void res.status(400).json({ error: "Identifiant invalide." }); next(); });


const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().optional(),
  sessionId: z.string().uuid().optional(),
  status: z.enum(["ALL", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).default("ALL"),
  sortBy: z.enum(["createdAt", "displayName"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// GET /api/v1/admin/participants - Liste paginée avec recherche et filtres
adminParticipantRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Paramètres de recherche invalides.", details: parsed.error.issues });
    return;
  }

  const { page, limit, search, sessionId, status, sortBy, sortOrder } = parsed.data;

  // Construction de la clause WHERE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search && search.length > 0) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { publicId: { contains: search, mode: "insensitive" } },
    ];
  }

  if (sessionId) {
    where.sessionId = sessionId;
  }

  if (status === "NOT_STARTED") {
    where.attempt = null;
  } else if (status === "IN_PROGRESS") {
    where.attempt = { status: "IN_PROGRESS" };
  } else if (status === "COMPLETED") {
    where.attempt = { status: "COMPLETED" };
  }

  try {
    const [total, participants, sessions] = await Promise.all([
      prisma.participant.count({ where }),
      prisma.participant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          publicId: true,
          displayName: true,
          createdAt: true,
          session: {
            select: {
              id: true,
              label: true,
              status: true,
            },
          },
          attempt: {
            select: {
              id: true,
              status: true,
              startedAt: true,
              completedAt: true,
              currentNode: {
                select: {
                  id: true,
                  title: true,
                  kind: true,
                },
              },
              _count: {
                select: { decisions: true },
              },
            },
          },
        },
      }),
      // Liste de toutes les sessions existantes pour alimenter le sélecteur de filtre
      prisma.assessmentSession.findMany({
        select: { id: true, label: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.status(200).json({
      participants,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      sessions,
    });
  } catch (error) {
    console.error("Participants list error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des participants." });
  }
});

// A single reporting service powers both the participant view and administration.
adminParticipantRouter.get("/:id", async (req, res) => {
  const p = await prisma.participant.findUnique({ where: { id: req.params.id }, select: {
    id: true, publicId: true, displayName: true, createdAt: true, tokenExpiresAt: true, revokedAt: true,
    session: { select: { id: true, label: true, status: true, opensAt: true, closesAt: true, assessment: { select: { id: true, title: true, slug: true } } } },
    attempt: { include: { currentNode: true, _count: { select: { decisions: true } } } },
  } });
  if (!p) return void res.status(404).json({ error: "Participant introuvable." });
  if (p.attempt) {
    const version = await prisma.missionVersion.findUnique({ where: { missionId_version: { missionId: p.attempt.currentNode.missionId, version: p.attempt.missionVersion ?? 1 } } });
    const frozen = version ? readFrozenGraph(version.graphSnapshot).find(n => n.id === p.attempt!.currentNodeId) : null;
    if (frozen) Object.assign(p.attempt.currentNode, { title: frozen.title, story: frozen.story, kind: frozen.kind });
  }
  res.json({ participant: p });
});
adminParticipantRouter.get("/:id/decisions", async (req, res) => {
  const p = await prisma.participant.findUnique({ where: { id: req.params.id }, include: { attempt: { include: { currentNode: true, decisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } } } });
  if (!p) return void res.status(404).json({ error: "Participant introuvable." });
  if (!p.attempt) return void res.json({ participant: { id: p.id, displayName: p.displayName, publicId: p.publicId }, decisions: [], attemptStatus: "IN_PROGRESS", currentOrFinalNode: null });
  const a = p.attempt;
  const version = await prisma.missionVersion.findUnique({ where: { missionId_version: { missionId: a.currentNode.missionId, version: a.missionVersion ?? 1 } } });
  if (!version) return void res.status(409).json({ error: "Version historique indisponible." });
  const graph = readFrozenGraph(version.graphSnapshot);
  const format = (choice: FrozenChoice) => ({ ...choice, impacts: choice.impacts.map(i => ({ indicator: i.indicator, competency: { id: i.competencyId, slug: canonicalSlug(i.competencySlug), label: i.competencyLabel } })) });
  const decisions = a.decisions.map((d, index) => {
    const n = graph.find(n => n.id === d.nodeId), c = n?.choices.find(c => c.id === d.choiceId);
    if (!n || !c) return null;
    const impacts = Array.isArray(d.impactSnapshot) ? d.impactSnapshot as unknown as FrozenImpact[] : c.impacts;
    const context = d.contextSnapshot as { nodeTitle?: string; story?: string; question?: string | null; choiceLabel?: string } | null;
    return { stepIndex: index + 1, id: d.id, timestamp: d.createdAt,
      node: { ...n, title: context?.nodeTitle ?? n.title, story: context?.story ?? n.story, question: context?.question !== undefined ? context.question : n.question },
      chosenOption: { ...format({ ...c, label: context?.choiceLabel ?? c.label, impacts }), nextNode: graph.find(n => n.id === c.nextNodeId) },
      alternativeOptions: n.choices.filter(ch => ch.id !== c.id).map(format) };
  }).filter(Boolean);
  res.json({ participant: { id: p.id, displayName: p.displayName, publicId: p.publicId }, decisions, attemptStatus: a.status, startedAt: a.startedAt, completedAt: a.completedAt, currentOrFinalNode: graph.find(n => n.id === a.currentNodeId) });
});
adminParticipantRouter.get("/:id/competencies", async (req, res) => {
  const p = await prisma.participant.findUnique({ where: { id: req.params.id }, include: { attempt: true } });
  if (!p) return void res.status(404).json({ error: "Participant introuvable." });
  const report = p.attempt ? await generateAttemptReport(p.attempt.id) : null;
  res.json({ participant: { id: p.id, displayName: p.displayName, publicId: p.publicId }, totalDecisions: report?.attempt.totalDecisions ?? 0,
    competencies: (report?.indicators ?? []).filter(i => i.evaluated).map(i => ({ id: i.slug, slug: i.slug, label: i.label, description: i.description,
      totalScore: i.cumulativeValue, averageIndicator: i.averageValue, occurrences: i.decisionCount,
      evidence: i.contributions.map(c => ({ nodeTitle: c.nodeTitle, choiceLabel: c.choiceLabel, indicator: c.delta, recordedAt: c.timestamp })) })) });
});
adminParticipantRouter.post("/:id/revoke", async (req, res) => {
  const revoked = await prisma.$transaction(async tx => {
    const now = new Date();
    const participant = await tx.participant.updateMany({ where: { id: req.params.id }, data: { revokedAt: now } });
    if (!participant.count) return false;
    const row = await tx.participant.findUniqueOrThrow({ where: { id: req.params.id } });
    // Same authority for both views, including fencing a response already in flight.
    await tx.adaptiveInterview.updateMany({ where: { tokenHash: row.guestTokenHash, expiresAt: { gt: now } },
      data: { expiresAt: now, revision: { increment: 1 }, busyUntil: null } });
    return true;
  });
  if (!revoked) return void res.status(404).json({ error: "Participant introuvable." });
  res.json({ success: true });
});
