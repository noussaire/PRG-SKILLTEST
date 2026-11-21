import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAdminAuth } from "../../security/adminAuth.js";
import { generateAttemptReport } from "../../services/evaluation.service.js";

export const adminReportRouter = Router();

adminReportRouter.use(requireAdminAuth);
adminReportRouter.param("attemptId", (req, res, next, value: string) => { if (!z.string().uuid().safeParse(value).success) return void res.status(400).json({ error: "Identifiant invalide." }); next(); });
adminReportRouter.param("sessionId", (req, res, next, value: string) => { if (!z.string().uuid().safeParse(value).success) return void res.status(400).json({ error: "Identifiant invalide." }); next(); });


const listReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(15),
  search: z.string().trim().optional(),
  sessionId: z.string().uuid().optional(),
  missionId: z.string().uuid().optional(),
  status: z.enum(["ALL", "COMPLETED", "IN_PROGRESS"]).default("ALL"),
});

// GET /api/v1/admin/reports - Liste paginée des tentatives & rapports avec filtres
adminReportRouter.get("/", async (req, res) => {
  const parsed = listReportsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Paramètres de recherche invalides.", details: parsed.error.issues });
    return;
  }

  const { page, limit, search, sessionId, missionId, status } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (status !== "ALL") {
    where.status = status;
  }

  if (sessionId) {
    where.participant = { ...where.participant, sessionId };
  }

  if (missionId) {
    where.currentNode = { missionId };
  }

  if (search && search.length > 0) {
    where.participant = {
      ...where.participant,
      OR: [
        { displayName: { contains: search, mode: "insensitive" } },
        { publicId: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  try {
    const [
      totalAttempts,
      attempts,
      completedCount,
      inProgressCount,
      sessionsList,
      missionsList,
    ] = await Promise.all([
      prisma.attempt.count({ where }),
      prisma.attempt.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { startedAt: "desc" },
        include: {
          participant: {
            include: {
              session: {
                select: { id: true, label: true, assessment: { select: { title: true } } },
              },
            },
          },
          currentNode: {
            include: {
              mission: {
                select: { id: true, title: true, version: true },
              },
            },
          },
          _count: {
            select: { decisions: true },
          },
        },
      }),
      prisma.attempt.count({ where: { ...where, status: "COMPLETED" } }),
      prisma.attempt.count({ where: { ...where, status: "IN_PROGRESS" } }),
      prisma.assessmentSession.findMany({
        select: { id: true, label: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.mission.findMany({
        select: { id: true, title: true, version: true },
        orderBy: { title: "asc" },
      }),
    ]);

    const formattedReports = await Promise.all(attempts.map(async (a) => {
      const version = await prisma.missionVersion.findUnique({ where: { missionId_version: { missionId: a.currentNode.missionId, version: a.missionVersion ?? 1 } } });
      return ({
      attemptId: a.id,
      status: a.status,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      totalDecisions: a._count.decisions,
      participant: {
        id: a.participant.id,
        displayName: a.participant.displayName,
        publicId: a.participant.publicId,
      },
      session: {
        id: a.participant.session.id,
        label: a.participant.session.label,
        assessmentTitle: a.participant.session.assessment?.title ?? null,
      },
      mission: {
        id: a.currentNode.mission.id,
        title: version?.title ?? "Version historique indisponible",
        version: a.missionVersion ?? 1,
      },
    }); }));

    res.json({
      reports: formattedReports,
      pagination: {
        page,
        limit,
        total: totalAttempts,
        totalPages: Math.ceil(totalAttempts / limit) || 1,
      },
      metrics: {
        totalAttempts,
        completedCount,
        inProgressCount,
      },
      filters: {
        sessions: sessionsList,
        missions: missionsList,
      },
    });
  } catch (error) {
    console.error("Erreur liste rapports admin:", error);
    res.status(500).json({ error: "Impossible de charger les rapports d'évaluation." });
  }
});

// GET /api/v1/admin/reports/:attemptId - Rapport individuel détaillé complet
adminReportRouter.get("/:attemptId", async (req, res) => {
  const { attemptId } = req.params;

  try {
    const report = await generateAttemptReport(attemptId);
    if (!report) {
      res.status(404).json({ error: "Tentative ou rapport introuvable." });
      return;
    }

    res.json(report);
  } catch (error) {
    console.error("Erreur détail rapport admin:", error);
    res.status(500).json({ error: "Impossible de générer le rapport individuel." });
  }
});

// Only completed attempts contribute to group feedback. Small dimensions stay suppressed.
adminReportRouter.get("/sessions/:sessionId/collective", async (req, res) => {
  const session = await prisma.assessmentSession.findUnique({ where: { id: req.params.sessionId }, include: {
    assessment: { include: { missions: { where: { status: "PUBLISHED" }, select: { id: true, title: true, version: true } } } },
    participants: { select: { attempt: { select: { id: true, status: true, startedAt: true, completedAt: true } } } },
  } });
  if (!session) return void res.status(404).json({ error: "Session introuvable." });
  const attempts = session.participants.flatMap(p => p.attempt ? [p.attempt] : []);
  const completed = attempts.filter(a => a.status === "COMPLETED");
  const reports = [];
  for (const a of completed) { const report = await generateAttemptReport(a.id); if (report) reports.push(report); }
  const sums = new Map<string, { label: string; sum: number; count: number }>();
  const profiles: Record<string, number> = {};
  for (const report of reports) {
    profiles[report.profile.title] = (profiles[report.profile.title] ?? 0) + 1;
    for (const i of report.indicators.filter(i => i.evaluated)) {
      const s = sums.get(i.slug) ?? { label: i.label, sum: 0, count: 0 };
      s.sum += i.averageValue; s.count++; sums.set(i.slug, s);
    }
  }
  const small = reports.length < 3;
  const durations = completed.filter(a => a.completedAt).map(a => (a.completedAt!.getTime() - a.startedAt.getTime()) / 60000);
  // Suppress the complete profile distribution when any bucket could identify <3 students.
  const safeProfiles = !small && Object.values(profiles).every(n => n >= 3) ? profiles : {};
  res.json({ session: { id: session.id, label: session.label, status: session.status, assessmentTitle: session.assessment?.title ?? null, missions: session.assessment?.missions ?? [] },
    stats: { totalParticipants: session.participants.length, attemptsCount: attempts.length, completedCount: completed.length, inProgressCount: attempts.length - completed.length,
      completionRate: session.participants.length ? Math.round(completed.length / session.participants.length * 100) : 0,
      avgDurationMinutes: !small && durations.length ? Number((durations.reduce((s,n) => s+n,0) / durations.length).toFixed(1)) : null },
    isSmallCohort: small, anonymityNotice: ":::frLes statistiques détaillées nécessitent au moins 3 parcours terminés et 3 observations indépendantes par dimension. Les profils à faible effectif sont masqués. Les parcours peuvent être différents : aucun classement n'est établi.:::arتتطلب الإحصاءات المفصلة ثلاثة مسارات مكتملة على الأقل وثلاث ملاحظات مستقلة لكل مهارة. تُحجب الفئات الصغيرة، ولا تمثل النتائج ترتيباً للطلاب.",
    competencyAverages: small ? [] : [...sums.values()].filter(s => s.count >= 3).map(s => ({ competency: s.label, averageScore: Number((s.sum/s.count).toFixed(2)), mobilizationCount: s.count })),
    profileDistribution: safeProfiles });
});
