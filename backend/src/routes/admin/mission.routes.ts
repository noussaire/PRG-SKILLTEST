import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { canonicalSlug } from "../../services/scoring.js";
import { requireAdminAuth } from "../../security/adminAuth.js";
import {
  asJson,
  draftGraphSchema,
  graphToDraft,
  readFrozenGraph,
  validateGraph,
  type DraftNode,
  type FrozenNode,
} from "../../services/graph.service.js";

export const adminMissionRouter = Router();
adminMissionRouter.use(requireAdminAuth);
adminMissionRouter.param("id", (req, res, next, value: string) => {
  if (!z.string().uuid().safeParse(value).success)
    return void res.status(400).json({ error: "Identifiant invalide." });
  next();
});

const metadataSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().max(12000).nullable().optional(),
  pedagogicalGoal: z.string().max(4000).nullable().optional(),
  targetCompetencies: z.string().max(4000).nullable().optional(),
  estimatedDuration: z.coerce.number().int().min(1).max(180).default(15),
  assessmentId: z.string().uuid().optional(),
});
const revisionSchema = z.object({ expectedRevision: z.number().int().min(0) });
const graphInclude = {
  choices: {
    orderBy: { position: "asc" as const },
    include: { impacts: { include: { competency: true } } },
  },
};
async function missionLock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id}::uuid FOR UPDATE`;
  const mission = await tx.mission.findUnique({ where: { id } });
  if (!mission) throw new Error("MISSION_NOT_FOUND");
  return mission;
}
async function normalizeDraft(
  tx: Prisma.TransactionClient,
  draft: DraftNode[],
) {
  const comps = await tx.competency.findMany();
  const mapped = new Map(
    comps.map((c) => [
      c.id,
      comps.find((t) => t.slug === canonicalSlug(c.slug))?.id ?? c.id,
    ]),
  );
  return draft.map((n) => ({
    ...n,
    choices: n.choices.map((c) => ({
      ...c,
      impacts: c.impacts.map((i) => ({
        ...i,
        competencyId: mapped.get(i.competencyId) ?? i.competencyId,
      })),
    })),
  }));
}
async function getDraft(
  tx: Prisma.TransactionClient,
  mission: { id: string; version: number; draftGraph: Prisma.JsonValue | null },
): Promise<DraftNode[]> {
  if (mission.draftGraph)
    return normalizeDraft(tx, draftGraphSchema.parse(mission.draftGraph));
  const version = await tx.missionVersion.findUnique({
    where: {
      missionId_version: { missionId: mission.id, version: mission.version },
    },
  });
  if (version)
    return normalizeDraft(
      tx,
      graphToDraft(readFrozenGraph(version.graphSnapshot)),
    );
  const nodes = await tx.scenarioNode.findMany({
    where: { missionId: mission.id, graphVersion: mission.version },
    include: graphInclude,
  });
  return normalizeDraft(tx, graphToDraft(readFrozenGraph(nodes)));
}
function previewNodes(draft: DraftNode[]) {
  const ids = new Map(draft.map((n) => [n.key, randomUUID()]));
  return draft.map((n) => ({
    ...n,
    id: ids.get(n.key)!,
    choices: n.choices.map((c) => ({
      id: randomUUID(),
      position: c.position,
      label: c.label,
      nextNodeId: ids.get(c.targetKey) ?? "",
      impacts: c.impacts.map((i) => ({
        competencyId: i.competencyId,
        indicator: i.delta,
      })),
    })),
  }));
}
function handleError(error: unknown, res: import("express").Response) {
  const code = error instanceof Error ? error.message : "";
  if (code === "MISSION_NOT_FOUND")
    return void res.status(404).json({ error: "Mission introuvable." });
  if (code === "CONCURRENT_MODIFICATION")
    return void res
      .status(409)
      .json({
        error: "La mission a été modifiée. Rechargez-la avant de réessayer.",
      });
  if (code === "ASSESSMENT_LOCKED")
    return void res
      .status(409)
      .json({
        error:
          "Une mission publiée ne peut pas changer d'évaluation. Dupliquez-la.",
      });
  console.error(
    "Mission operation failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return void res
    .status(500)
    .json({ error: "Impossible de traiter cette mission." });
}
adminMissionRouter.get("/competencies", async (_req, res) => {
  res.json({
    competencies: await prisma.competency.findMany({
      where: { slug: { notIn: ["collaboration", "empathie", "organisation"] } },
      orderBy: { label: "asc" },
    }),
  });
});
adminMissionRouter.get("/", async (req, res) => {
  const parsed = z
    .object({
      search: z.string().trim().max(160).optional(),
      status: z.enum(["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"]).default("ALL"),
    })
    .safeParse(req.query);
  if (!parsed.success)
    return void res.status(400).json({ error: "Filtres invalides." });
  const where: Prisma.MissionWhereInput = {
    ...(parsed.data.status !== "ALL" ? { status: parsed.data.status } : {}),
    ...(parsed.data.search
      ? { title: { contains: parsed.data.search, mode: "insensitive" } }
      : {}),
  };
  const [missions, total, draft, published, archived] = await Promise.all([
    prisma.mission.findMany({
      where,
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      include: {
        assessment: { select: { id: true, title: true, slug: true } },
      },
    }),
    prisma.mission.count(),
    prisma.mission.count({ where: { status: "DRAFT" } }),
    prisma.mission.count({ where: { status: "PUBLISHED" } }),
    prisma.mission.count({ where: { status: "ARCHIVED" } }),
  ]);
  const enriched = [];
  for (const m of missions) {
    const draftNodes = await getDraft(prisma, m);
    enriched.push({
      ...m,
      draftGraph: undefined,
      nodeCount: draftNodes.length,
      attemptsCount: await prisma.attempt.count({
        where: { currentNode: { missionId: m.id } },
      }),
    });
  }
  res.json({
    missions: enriched,
    metrics: { total, draft, published, archived },
  });
});
adminMissionRouter.post("/", async (req, res) => {
  const parsed = metadataSchema.safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({ error: "Métadonnées invalides.", details: parsed.error.issues });
  try {
    const mission = await prisma.$transaction(async (tx) => {
      let assessmentId = parsed.data.assessmentId;
      if (!assessmentId) {
        const a = await tx.assessment.upsert({
          where: { slug: "evaluation-softskills-principale" },
          create: {
            slug: "evaluation-softskills-principale",
            title: "Évaluation Principale Soft Skills",
            status: "PUBLISHED",
          },
          update: {},
        });
        assessmentId = a.id;
      }
      await tx.$queryRaw`SELECT id FROM "Assessment" WHERE id=${assessmentId}::uuid FOR UPDATE`;
      const last = await tx.mission.aggregate({
        where: { assessmentId },
        _max: { position: true },
      });
      const draft: DraftNode[] = [
        {
          key: "start",
          kind: "QUESTION",
          title: "Situation initiale",
          story: "Décrivez la situation.",
          question: "Quelle décision prenez-vous ?",
          isStart: true,
          posX: 80,
          posY: 180,
          choices: [
            {
              position: 0,
              label: "Proposer un plan commun.",
              targetKey: "end",
              impacts: [],
            },
          ],
        },
        {
          key: "end",
          kind: "ENDING",
          title: "Conclusion",
          story: "Décrivez les conséquences.",
          question: null,
          isStart: false,
          posX: 520,
          posY: 180,
          choices: [],
        },
      ];
      return tx.mission.create({
        data: {
          ...parsed.data,
          assessmentId,
          position: (last._max.position ?? 0) + 1,
          status: "DRAFT",
          version: 0,
          draftGraph: asJson(draft),
        },
      });
    });
    res.status(201).json({ mission });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.get("/:id", async (req, res) => {
  try {
    const m = await prisma.mission.findUnique({
      where: { id: req.params.id },
      include: {
        assessment: { select: { id: true, title: true, slug: true } },
      },
    });
    if (!m) throw new Error("MISSION_NOT_FOUND");
    const [draft, competencies, attemptsCount] = await Promise.all([
      getDraft(prisma, m),
      prisma.competency.findMany({
        where: {
          slug: { notIn: ["collaboration", "empathie", "organisation"] },
        },
        orderBy: { label: "asc" },
      }),
      prisma.attempt.count({ where: { currentNode: { missionId: m.id } } }),
    ]);
    res.json({
      mission: { ...m, draftGraph: undefined, nodes: previewNodes(draft) },
      competencies,
      attemptsCount,
    });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.patch("/:id", async (req, res) => {
  const parsed = metadataSchema
    .partial()
    .extend({ expectedRevision: z.number().int().min(0) })
    .safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({ error: "Métadonnées ou révision invalides." });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const m = await missionLock(tx, req.params.id);
      const { expectedRevision, ...data } = parsed.data;
      if (m.editRevision !== expectedRevision)
        throw new Error("CONCURRENT_MODIFICATION");
      if (
        data.assessmentId &&
        data.assessmentId !== m.assessmentId &&
        m.version > 0
      )
        throw new Error("ASSESSMENT_LOCKED");
      return tx.mission.update({
        where: { id: m.id },
        data: { ...data, editRevision: { increment: 1 } },
      });
    });
    res.json({ mission: updated });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.put("/:id/graph", async (req, res) => {
  const parsed = revisionSchema
    .extend({ nodes: draftGraphSchema })
    .safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({
        error: "Graphe ou révision invalide.",
        details: parsed.error.issues,
      });
  const keys = parsed.data.nodes.map((n) => n.key);
  if (new Set(keys).size !== keys.length)
    return void res
      .status(400)
      .json({ error: "Les clés des situations doivent être uniques." });
  try {
    const m = await prisma.$transaction(async (tx) => {
      const current = await missionLock(tx, req.params.id);
      if (current.editRevision !== parsed.data.expectedRevision)
        throw new Error("CONCURRENT_MODIFICATION");
      return tx.mission.update({
        where: { id: current.id },
        data: {
          draftGraph: asJson(parsed.data.nodes),
          editRevision: { increment: 1 },
        },
      });
    });
    res.json({
      success: true,
      editRevision: m.editRevision,
      message: "Brouillon enregistré. Les versions publiées sont préservées.",
    });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.post("/:id/validate", async (req, res) => {
  try {
    const m = await prisma.mission.findUnique({ where: { id: req.params.id } });
    if (!m) throw new Error("MISSION_NOT_FOUND");
    res.json(validateGraph(await getDraft(prisma, m)));
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.post("/:id/publish", async (req, res) => {
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({ error: "La révision attendue est obligatoire." });
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const m = await missionLock(tx, req.params.id);
        if (m.editRevision !== parsed.data.expectedRevision)
          throw new Error("CONCURRENT_MODIFICATION");
        const draft = await getDraft(tx, m);
        const validation = validateGraph(draft);
        if (!validation.valid) return { validation, mission: null };
        const compIds = [
          ...new Set(
            draft.flatMap((n) =>
              n.choices.flatMap((c) => c.impacts.map((i) => i.competencyId)),
            ),
          ),
        ];
        const comps = await tx.competency.findMany({
          where: { id: { in: compIds } },
        });
        if (comps.length !== compIds.length)
          return {
            validation: {
              valid: false,
              errors: ["Certaines compétences n'existent plus."],
              warnings: [],
            },
            mission: null,
          };
        const previous = await tx.missionVersion.aggregate({
          where: { missionId: m.id },
          _max: { version: true },
        });
        const version = Math.max(m.version, previous._max.version ?? 0) + 1;
        const ids = new Map<string, string>();
        for (const n of draft) {
          const created = await tx.scenarioNode.create({
            data: {
              missionId: m.id,
              graphVersion: version,
              key: n.key,
              kind: n.kind,
              title: n.title,
              story: n.story,
              question: n.kind === "QUESTION" ? n.question : null,
              isStart: n.isStart,
              posX: n.posX,
              posY: n.posY,
            },
          });
          ids.set(n.key, created.id);
        }
        const frozen: FrozenNode[] = [];
        for (const n of draft) {
          const choices = [];
          for (const c of n.choices) {
            const ch = await tx.scenarioChoice.create({
              data: {
                nodeId: ids.get(n.key)!,
                nextNodeId: ids.get(c.targetKey)!,
                position: c.position,
                label: c.label,
                impacts: {
                  create: c.impacts.map((i) => ({
                    competencyId: i.competencyId,
                    indicator: i.delta,
                  })),
                },
              },
            });
            choices.push({
              id: ch.id,
              position: c.position,
              label: c.label,
              nextNodeId: ids.get(c.targetKey)!,
              impacts: c.impacts.map((i) => {
                const comp = comps.find((v) => v.id === i.competencyId)!;
                return {
                  competencyId: comp.id,
                  competencySlug: comp.slug,
                  competencyLabel: comp.label,
                  indicator: i.delta,
                };
              }),
            });
          }
          frozen.push({
            id: ids.get(n.key)!,
            key: n.key,
            kind: n.kind,
            title: n.title,
            story: n.story,
            question: n.kind === "QUESTION" ? (n.question ?? null) : null,
            isStart: n.isStart,
            posX: n.posX,
            posY: n.posY,
            choices,
          });
        }
        await tx.missionVersion.create({
          data: {
            missionId: m.id,
            version,
            title: m.title,
            description: m.description,
            pedagogicalGoal: m.pedagogicalGoal,
            targetCompetencies: m.targetCompetencies,
            estimatedDuration: m.estimatedDuration,
            graphSnapshot: asJson(frozen),
          },
        });
        const updated = await tx.mission.update({
          where: { id: m.id },
          data: {
            version,
            status: "PUBLISHED",
            draftGraph: Prisma.DbNull,
            editRevision: { increment: 1 },
          },
        });
        return { validation, mission: updated };
      },
      { timeout: 20000 },
    );
    if (!result.mission)
      return void res
        .status(400)
        .json({
          error: "La mission ne peut pas être publiée.",
          details: result.validation.errors,
        });
    res.json({
      success: true,
      mission: result.mission,
      warnings: result.validation.warnings,
      message: `Version ${result.mission.version} publiée. Les parcours existants sont préservés.`,
    });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.post("/:id/duplicate", async (req, res) => {
  try {
    const mission = await prisma.$transaction(async (tx) => {
      const original = await missionLock(tx, req.params.id);
      const draft = await getDraft(tx, original);
      await tx.$queryRaw`SELECT id FROM "Assessment" WHERE id=${original.assessmentId}::uuid FOR UPDATE`;
      const last = await tx.mission.aggregate({
        where: { assessmentId: original.assessmentId },
        _max: { position: true },
      });
      return tx.mission.create({
        data: {
          assessmentId: original.assessmentId,
          position: (last._max.position ?? 0) + 1,
          title: `${original.title.slice(0, 150)} (Copie)`,
          description: original.description,
          pedagogicalGoal: original.pedagogicalGoal,
          targetCompetencies: original.targetCompetencies,
          estimatedDuration: original.estimatedDuration,
          status: "DRAFT",
          version: 0,
          draftGraph: asJson(draft),
        },
      });
    });
    res.status(201).json({ mission });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.post("/:id/archive", async (req, res) => {
  try {
    const mission = await prisma.$transaction(async (tx) => {
      await missionLock(tx, req.params.id);
      return tx.mission.update({
        where: { id: req.params.id },
        data: { status: "ARCHIVED", editRevision: { increment: 1 } },
      });
    });
    res.json({ mission });
  } catch (e) {
    handleError(e, res);
  }
});
adminMissionRouter.get("/:id/versions", async (req, res) => {
  const m = await prisma.mission.findUnique({
    where: { id: req.params.id },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  if (!m) return void res.status(404).json({ error: "Mission introuvable." });
  res.json({
    currentVersion: m.version,
    status: m.status,
    decisionsCount: await prisma.decision.count({
      where: { node: { missionId: m.id } },
    }),
    versions: m.versions.map((v) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      description: v.description,
      publishedAt: v.publishedAt,
      isCurrent: v.version === m.version,
    })),
  });
});
adminMissionRouter.get("/:id/versions/:version", async (req, res) => {
  const version = z.coerce.number().int().min(1).safeParse(req.params.version);
  if (!version.success)
    return void res.status(400).json({ error: "Version invalide." });
  const v = await prisma.missionVersion.findUnique({
    where: {
      missionId_version: { missionId: req.params.id, version: version.data },
    },
  });
  if (!v) return void res.status(404).json({ error: "Version introuvable." });
  res.json({ ...v, graph: v.graphSnapshot });
});
