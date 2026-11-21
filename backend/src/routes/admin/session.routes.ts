import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAdminAuth, type AuthenticatedAdminRequest } from "../../security/adminAuth.js";
import {
  decryptCode,
  encryptCode,
  generateJoinCode,
  hashJoinCode,
} from "../../security/tokens.js";

export const adminSessionRouter = Router();

adminSessionRouter.use(requireAdminAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().optional(),
  status: z.enum(["ALL", "DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"]).default("ALL"),
  sortBy: z.enum(["createdAt", "label", "opensAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// GET /api/v1/admin/sessions - Liste des sessions avec métriques et filtres
adminSessionRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Paramètres invalides.", details: parsed.error.issues });
    return;
  }

  const { page, limit, search, status, sortBy, sortOrder } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search && search.length > 0) {
    where.label = { contains: search, mode: "insensitive" };
  }

  if (status !== "ALL") {
    where.status = status;
  }

  try {
    const [
      total,
      sessions,
      totalSessions,
      openSessions,
      scheduledSessions,
      closedSessions,
      archivedSessions,
      totalParticipants,
      assessments,
    ] = await Promise.all([
      prisma.assessmentSession.count({ where }),
      prisma.assessmentSession.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          assessment: {
            select: { id: true, title: true, slug: true },
          },
          _count: {
            select: { participants: true },
          },
          participants: {
            select: {
              attempt: {
                select: { status: true },
              },
            },
          },
        },
      }),
      prisma.assessmentSession.count(),
      prisma.assessmentSession.count({ where: { status: "OPEN" } }),
      prisma.assessmentSession.count({ where: { status: "SCHEDULED" } }),
      prisma.assessmentSession.count({ where: { status: "CLOSED" } }),
      prisma.assessmentSession.count({ where: { status: "ARCHIVED" } }),
      prisma.participant.count(),
      prisma.assessment.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, title: true, slug: true },
      }),
    ]);

    // Formatage des sessions avec statistiques de complétion et déchiffrement du code si présent
    const formattedSessions = sessions.map((s) => {
      let completedCount = 0;
      let inProgressCount = 0;
      for (const p of s.participants) {
        if (p.attempt?.status === "COMPLETED") completedCount++;
        else if (p.attempt?.status === "IN_PROGRESS") inProgressCount++;
      }

      const decryptedCode = decryptCode(s.codeCipher);

      return {
        id: s.id,
        label: s.label,
        description: s.description,
        status: s.status,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
        maxParticipants: s.maxParticipants,
        createdAt: s.createdAt,
        assessment: s.assessment,
        participantsCount: s._count.participants,
        completedCount,
        inProgressCount,
        code: decryptedCode, // Le code est déchiffré pour l'admin
      };
    });

    res.status(200).json({
      sessions: formattedSessions,
      stats: {
        totalSessions,
        openSessions,
        scheduledSessions,
        closedSessions,
        archivedSessions,
        totalParticipants,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      assessments,
    });
  } catch (error) {
    console.error("List sessions error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des sessions." });
  }
});

const createSessionSchema = z.object({
  label: z.string().trim().min(3, "Le nom doit comporter au moins 3 caractères.").max(160),
  description: z.string().trim().max(1000).optional(),
  assessmentId: z.string().uuid("Évaluation associée invalide.").nullable().optional(),
  opensAt: z.string().datetime({ offset: true }).nullable().optional(),
  closesAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxParticipants: z.coerce.number().int().min(1).nullable().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "OPEN"]).default("OPEN"),
}).refine(
  (data) => {
    if (data.opensAt && data.closesAt) {
      return new Date(data.opensAt) < new Date(data.closesAt);
    }
    return true;
  },
  { message: "La date de fin doit être postérieure à la date de début.", path: ["closesAt"] }
).refine(data => data.status !== "SCHEDULED" || !!data.opensAt, { message: "Une session programmée nécessite une date de début.", path: ["opensAt"] });

// POST /api/v1/admin/sessions - Création d'une session
adminSessionRouter.post("/", async (req: AuthenticatedAdminRequest, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Données invalides.", details: parsed.error.issues });
    return;
  }

  const { label, description, assessmentId, opensAt, closesAt, maxParticipants, status } = parsed.data;

  try {
    // Vérifier que l'évaluation existe si assessmentId est fourni
    let validAssessmentId: string | null = null;
    if (assessmentId) {
      const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
      if (!assessment) {
        res.status(404).json({ error: "L'évaluation sélectionnée est introuvable." });
        return;
      }
      validAssessmentId = assessment.id;
    }

    // Générer un code unique garanti
    let plainCode = "";
    let codeHash = "";
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      plainCode = generateJoinCode();
      codeHash = hashJoinCode(plainCode);
      const existing = await prisma.assessmentSession.findUnique({ where: { codeHash } });
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      res.status(500).json({ error: "Impossible de générer un code unique. Réessayez." });
      return;
    }

    // Chiffrement AES-256-GCM du code pour stockage non-clair
    const codeCipher = encryptCode(plainCode);

    const session = await prisma.assessmentSession.create({
      data: {
        label,
        description: description || null,
        assessmentId: validAssessmentId,
        createdById: req.admin!.id,
        codeHash,
        codeCipher,
        status,
        opensAt: opensAt ? new Date(opensAt) : null,
        closesAt: closesAt ? new Date(closesAt) : null,
        maxParticipants: maxParticipants ?? null,
      },
      include: {
        assessment: {
          select: { id: true, title: true, slug: true },
        },
      },
    });

    res.status(201).json({
      session: {
        ...session,
        code: plainCode,
      },
      plainCode,
    });
  } catch (error) {
    console.error("Create session error:", error);
    res.status(500).json({ error: "Erreur lors de la création de la session." });
  }
});

const paramIdSchema = z.object({
  id: z.string().uuid("Identifiant de session invalide."),
});

// GET /api/v1/admin/sessions/:id - Détails d'une session
adminSessionRouter.get("/:id", async (req, res) => {
  const parsed = paramIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }

  const { id } = parsed.data;

  try {
    const session = await prisma.assessmentSession.findUnique({
      where: { id },
      include: {
        assessment: {
          select: { id: true, title: true, slug: true },
        },
        createdBy: {
          select: { id: true, email: true },
        },
        participants: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            publicId: true,
            displayName: true,
            createdAt: true,
            attempt: {
              select: {
                status: true,
                startedAt: true,
                completedAt: true,
                currentNode: {
                  select: { title: true },
                },
                _count: {
                  select: { decisions: true },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      res.status(404).json({ error: "Session introuvable." });
      return;
    }

    let completedCount = 0;
    let inProgressCount = 0;
    for (const p of session.participants) {
      if (p.attempt?.status === "COMPLETED") completedCount++;
      else if (p.attempt?.status === "IN_PROGRESS") inProgressCount++;
    }

    const totalParticipants = session.participants.length;
    const completionRate = totalParticipants > 0 ? Math.round((completedCount / totalParticipants) * 100) : 0;
    const decryptedCode = decryptCode(session.codeCipher);

    res.status(200).json({
      session: {
        id: session.id,
        label: session.label,
        description: session.description,
        status: session.status,
        opensAt: session.opensAt,
        closesAt: session.closesAt,
        maxParticipants: session.maxParticipants,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        assessment: session.assessment,
        createdBy: session.createdBy,
        code: decryptedCode,
        stats: {
          totalParticipants,
          completedCount,
          inProgressCount,
          completionRate,
        },
        participants: session.participants,
      },
    });
  } catch (error) {
    console.error("Session detail error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des détails de la session." });
  }
});

const updateSessionSchema = z.object({
  label: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  opensAt: z.string().datetime({ offset: true }).nullable().optional(),
  closesAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxParticipants: z.coerce.number().int().min(1).nullable().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"]).optional(),
});

// PATCH /api/v1/admin/sessions/:id - Modification des informations
adminSessionRouter.patch("/:id", async (req, res) => {
  const paramParsed = paramIdSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }

  const bodyParsed = updateSessionSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Données de mise à jour invalides.", details: bodyParsed.error.issues });
    return;
  }

  const { id } = paramParsed.data;
  const updates = bodyParsed.data;

  try {
    const existing = await prisma.assessmentSession.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Session introuvable." });
      return;
    }

    const opensAt = updates.opensAt !== undefined
      ? (updates.opensAt ? new Date(updates.opensAt) : null)
      : existing.opensAt;
    const closesAt = updates.closesAt !== undefined
      ? (updates.closesAt ? new Date(updates.closesAt) : null)
      : existing.closesAt;

    if ((updates.status ?? existing.status) === "SCHEDULED" && !opensAt) {
      return void res.status(400).json({ error: "Une session programmée nécessite une date de début." });
    }
    if (opensAt && closesAt && opensAt >= closesAt) {
      res.status(400).json({ error: "La date de fin doit être postérieure à la date de début." });
      return;
    }

    const updated = await prisma.assessmentSession.update({
      where: { id },
      data: {
        label: updates.label ?? undefined,
        description: updates.description !== undefined ? updates.description : undefined,
        opensAt,
        closesAt,
        maxParticipants: updates.maxParticipants !== undefined ? updates.maxParticipants : undefined,
        status: updates.status ?? undefined,
      },
    });

    res.status(200).json({ session: updated });
  } catch (error) {
    console.error("Update session error:", error);
    res.status(500).json({ error: "Erreur lors de la mise à jour de la session." });
  }
});

// POST /api/v1/admin/sessions/:id/open - Ouvrir la session
adminSessionRouter.post("/:id/open", async (req, res) => {
  const parsed = paramIdSchema.safeParse(req.params);
  if (!parsed.success) return void res.status(400).json({ error: "Identifiant invalide." });

  try {
    const session = await prisma.assessmentSession.update({
      where: { id: parsed.data.id },
      data: { status: "OPEN" },
    });
    res.status(200).json({ session, message: "Session ouverte avec succès." });
  } catch {
    res.status(500).json({ error: "Impossible d'ouvrir la session." });
  }
});

// POST /api/v1/admin/sessions/:id/close - Fermer la session
adminSessionRouter.post("/:id/close", async (req, res) => {
  const parsed = paramIdSchema.safeParse(req.params);
  if (!parsed.success) return void res.status(400).json({ error: "Identifiant invalide." });

  try {
    const session = await prisma.assessmentSession.update({
      where: { id: parsed.data.id },
      data: { status: "CLOSED" },
    });
    res.status(200).json({ session, message: "Session fermée. Les nouvelles inscriptions et décisions sont bloquées." });
  } catch {
    res.status(500).json({ error: "Impossible de fermer la session." });
  }
});

// POST /api/v1/admin/sessions/:id/archive - Archiver la session
adminSessionRouter.post("/:id/archive", async (req, res) => {
  const parsed = paramIdSchema.safeParse(req.params);
  if (!parsed.success) return void res.status(400).json({ error: "Identifiant invalide." });

  try {
    const session = await prisma.assessmentSession.update({
      where: { id: parsed.data.id },
      data: { status: "ARCHIVED" },
    });
    res.status(200).json({ session, message: "Session archivée." });
  } catch {
    res.status(500).json({ error: "Impossible d'archiver la session." });
  }
});

// POST /api/v1/admin/sessions/:id/rotate-code - Générer un nouveau code et révoquer l'ancien
adminSessionRouter.post("/:id/rotate-code", async (req, res) => {
  const parsed = paramIdSchema.safeParse(req.params);
  if (!parsed.success) return void res.status(400).json({ error: "Identifiant invalide." });

  const { id } = parsed.data;

  try {
    const session = await prisma.assessmentSession.findUnique({ where: { id } });
    if (!session) {
      res.status(404).json({ error: "Session introuvable." });
      return;
    }

    let newCode = "";
    let codeHash = "";
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      newCode = generateJoinCode();
      codeHash = hashJoinCode(newCode);
      const existing = await prisma.assessmentSession.findUnique({ where: { codeHash } });
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      res.status(500).json({ error: "Erreur lors de la génération du code." });
      return;
    }

    const codeCipher = encryptCode(newCode);

    await prisma.assessmentSession.update({
      where: { id },
      data: {
        codeHash,
        codeCipher,
      },
    });

    res.status(200).json({
      success: true,
      newCode,
      message: "Nouveau code généré avec succès. L'ancien code est immédiatement invalidé.",
    });
  } catch (error) {
    console.error("Rotate code error:", error);
    res.status(500).json({ error: "Erreur lors du renouvellement du code." });
  }
});
