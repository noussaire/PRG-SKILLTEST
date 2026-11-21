import { Router } from "express";
import { createHash } from "node:crypto";
import { rateLimit } from "../security/http-rate-limit.js";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  createPublicId,
  hashGuestToken,
  hashJoinCode,
} from "../security/tokens.js";
import { getParticipantView } from "../services/participant.service.js";
import { generateAttemptReport } from "../services/evaluation.service.js";
import { asJson, readFrozenGraph } from "../services/graph.service.js";
import {
  guestAccessValid,
  sessionAcceptsDecisions,
} from "../services/session-policy.js";

import { createPreparedInterview } from "../services/prepared-interview.service.js";
import { interviewView } from "../services/adaptive.service.js";
import { stagingConfiguration } from "../security/synthetic-staging.js";
import { Prisma } from "@prisma/client";
import { registrationTokens } from "../security/registration.js";

export const participantRouter = Router();
const joinSchema = z.object({
  registrationId: z.string().uuid().transform(value => value.toLowerCase()),
  code: z
    .string()
    .trim()
    .min(6)
    .max(32)
    .regex(/^[\p{L}0-9_-]+$/u),
  displayName: z.string().trim().min(2).max(100),
  language: z.enum(["fr", "ar"]).optional().default("fr"),
});
const choiceSchema = z.object({ choiceId: z.string().uuid() });
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) =>
    createHash("sha256")
      .update(
        `${String(req.body?.code ?? "")
          .trim()
          .toUpperCase()}:${String(req.body?.displayName ?? "")
          .trim()
          .toLowerCase()}`,
      )
      .digest("hex"),
  message: {
    error:
      "Trop de tentatives pour ce nom et cette session. Réessayez plus tard.",
  },
});
const decisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => hashGuestToken(req.headers.authorization ?? "missing"),
  message: { error: "Fréquence de décisions trop élevée. Veuillez ralentir." },
});
const bearer = (header?: string) =>
  /^Bearer ([0-9a-f]{64})$/.exec(header ?? "")?.[1] ?? null;

participantRouter.post("/sessions/join", joinLimiter, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({ error: "Vérifiez le code et le nom (2 caractères minimum)." });
  const candidates = registrationTokens(parsed.data.registrationId);
  const guestToken = candidates[0];
  try {
    const cleanName = parsed.data.displayName.normalize("NFKC").replace(/\s+/g, " ");

    if (stagingConfiguration() !== null && !cleanName.startsWith("SYNTH-")) {
      return void res.status(400).json({
        code: "SYNTHETIC_IDENTITY_REQUIRED",
        error: "Le nom doit commencer par SYNTH- en mode de test.",
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const codeHash = hashJoinCode(parsed.data.code);
        // Serialize joins AND session state changes on the same PostgreSQL row.
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM "AssessmentSession" WHERE "codeHash"=${codeHash} FOR UPDATE`;
        if (!locked.length) throw new Error("SESSION_UNAVAILABLE");
        const session = await tx.assessmentSession.findUnique({
          where: { id: locked[0].id },
          include: { assessment: true },
        });
        if (
          !session ||
          !sessionAcceptsDecisions(session) ||
          (session.assessmentId && (!session.assessment || session.assessment.status !== "PUBLISHED"))
        )
          throw new Error("SESSION_UNAVAILABLE");
        // The session lock also serializes identical concurrent intents. The
        // existing unique token hash is the durable idempotency record.
        const previous = await tx.participant.findFirst({ where: {
          guestTokenHash: { in: candidates.map(hashGuestToken) },
        } });
        if (previous) {
          const interview = await tx.adaptiveInterview.findUnique({ where: { tokenHash: previous.guestTokenHash }, include: { reportJob: true } });
          if (!guestAccessValid(previous) || !interview || interview.expiresAt <= new Date()) throw new Error("REGISTRATION_UNAVAILABLE");
          const state = interview.state as unknown as Parameters<typeof interviewView>[0]["state"];
          if (previous.sessionId !== session.id || previous.displayName !== cleanName || state.language !== parsed.data.language) throw new Error("REGISTRATION_CONFLICT");
          const token = candidates.find(value => hashGuestToken(value) === previous.guestTokenHash)!;
          return { guestToken: token, token, publicId: previous.publicId, interviewId: interview.id,
            interview: interviewView({ ...interview, state }, interview.reportJob ?? undefined), replayed: true };
        }
        if (session.maxParticipants !== null) {
          const [adaptiveCount, legacyCount] = await Promise.all([
            tx.adaptiveInterview.count({ where: { sessionId: session.id } }),
            tx.participant.count({ where: { sessionId: session.id } }),
          ]);
          if (Math.max(adaptiveCount, legacyCount) >= session.maxParticipants) {
            throw new Error("CAPACITY_REACHED");
          }
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 86400000);
        const tokenHash = hashGuestToken(guestToken);
        const publicId = createPublicId();

        const mission = session.assessmentId
          ? await tx.mission.findFirst({
              where: {
                assessmentId: session.assessmentId,
                status: "PUBLISHED",
                version: { gt: 0 },
              },
              orderBy: { position: "asc" },
            })
          : null;

        let attemptCreate: Prisma.AttemptCreateNestedOneWithoutParticipantInput | undefined;
        if (mission) {
          const version = await tx.missionVersion.findUnique({
            where: {
              missionId_version: {
                missionId: mission.id,
                version: mission.version,
              },
            },
          });
          if (version) {
            const graph = readFrozenGraph(version.graphSnapshot);
            const start = graph.find((n) => n.isStart);
            if (start && start.kind === "QUESTION") {
              attemptCreate = {
                create: {
                  currentNodeId: start.id,
                  missionVersion: version.version,
                },
              };
            }
          }
        }

        const participant = await tx.participant.create({
          data: {
            sessionId: session.id,
            displayName: cleanName,
            publicId,
            guestTokenHash: tokenHash,
            tokenExpiresAt: expiresAt,
            ...(attemptCreate ? { attempt: attemptCreate } : {}),
          },
          select: { id: true, publicId: true },
        });

        const state = createPreparedInterview(parsed.data.language);
        const interview = await tx.adaptiveInterview.create({
          data: {
            sessionId: session.id,
            displayName: cleanName,
            tokenHash,
            state: state as unknown as Prisma.InputJsonValue,
            expiresAt,
            lastTestStartedAt: now,
          },
          select: { id: true, displayName: true, expiresAt: true },
        });

        return {
          guestToken,
          token: guestToken,
          publicId: participant.publicId,
          interviewId: interview.id,
          interview: interviewView({ ...interview, state, emailVerifiedAt: null }),
        };
      },
      { timeout: 15000 },
    );
    res.status("replayed" in result ? 200 : 201).json(result);
  } catch (e) {
    // A key concurrently submitted to different sessions is still protected
    // by the unique token index even though those session locks differ.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return void res.status(409).json({ code: "REGISTRATION_CONFLICT", error: "Cette demande d’inscription a déjà été utilisée." });
    const code = e instanceof Error ? e.message : "";
    if (code === "REGISTRATION_CONFLICT") return void res.status(409).json({ code, error: "Cette demande d’inscription a déjà été utilisée. Recommencez avec vos informations actuelles." });
    if (code === "REGISTRATION_UNAVAILABLE") return void res.status(401).json({ code, error: "Cette participation a expiré ou a été révoquée." });
    if (code === "SESSION_UNAVAILABLE")
      return void res
        .status(400)
        .json({ error: "Code invalide ou session indisponible." });
    if (code === "CAPACITY_REACHED")
      return void res
        .status(409)
        .json({
          error:
            "Cette session a atteint sa capacité maximale de participants.",
        });
    if (code === "SYNTHETIC_IDENTITY_REQUIRED")
      return void res
        .status(400)
        .json({
          code: "SYNTHETIC_IDENTITY_REQUIRED",
          error: "Le nom doit commencer par SYNTH- en mode de test.",
        });
    throw e;
  }
});
participantRouter.get("/participants/me", async (req, res) => {
  const token = bearer(req.headers.authorization);
  if (!token)
    return void res
      .status(401)
      .json({ error: "Session participant manquante." });
  const view = await getParticipantView(token);
  if (!view)
    return void res
      .status(401)
      .json({ error: "Session participant expirée ou invalide." });
  res.json(view);
});
participantRouter.get("/participants/me/report", async (req, res) => {
  const token = bearer(req.headers.authorization);
  const p = token
    ? await prisma.participant.findUnique({
        where: { guestTokenHash: hashGuestToken(token) },
        include: { attempt: true },
      })
    : null;
  if (!p?.attempt || !guestAccessValid(p))
    return void res
      .status(401)
      .json({ error: "Session participant expirée ou invalide." });
  if (p.attempt.status !== "COMPLETED")
    return void res
      .status(409)
      .json({ error: "Terminez votre mission pour consulter le bilan final." });
  const report = await generateAttemptReport(p.attempt.id);
  if (!report)
    return void res.status(404).json({ error: "Rapport introuvable." });
  res.json(report);
});
participantRouter.post(
  "/participants/decisions",
  decisionLimiter,
  async (req, res) => {
    const token = bearer(req.headers.authorization);
    if (!token)
      return void res
        .status(401)
        .json({ error: "Session participant manquante." });
    const parsed = choiceSchema.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ error: "Choix invalide." });
    const result = await prisma.$transaction(async (tx) => {
      const p = await tx.participant.findUnique({
        where: { guestTokenHash: hashGuestToken(token) },
        include: { attempt: { include: { currentNode: true } } },
      });
      if (!p?.attempt || !guestAccessValid(p)) return "UNAUTHORIZED";
      await tx.$queryRaw`SELECT id FROM "AssessmentSession" WHERE id=${p.sessionId}::uuid FOR UPDATE`;
      const session = await tx.assessmentSession.findUnique({
        where: { id: p.sessionId },
      });
      if (!session || !sessionAcceptsDecisions(session))
        return "SESSION_CLOSED";
      if (p.attempt.status !== "IN_PROGRESS") return "FINISHED";
      const v = await tx.missionVersion.findUnique({
        where: {
          missionId_version: {
            missionId: p.attempt.currentNode.missionId,
            version: p.attempt.missionVersion ?? 1,
          },
        },
      });
      if (!v) return "VERSION_MISSING";
      const graph = readFrozenGraph(v.graphSnapshot),
        node = graph.find((n) => n.id === p.attempt!.currentNodeId),
        choice = node?.choices.find((c) => c.id === parsed.data.choiceId),
        next = graph.find((n) => n.id === choice?.nextNodeId);
      if (!node || node.kind !== "QUESTION" || !choice || !next)
        return "INVALID";
      const update = await tx.attempt.updateMany({
        where: {
          id: p.attempt.id,
          currentNodeId: node.id,
          status: "IN_PROGRESS",
        },
        data: {
          currentNodeId: next.id,
          status: next.kind === "ENDING" ? "COMPLETED" : "IN_PROGRESS",
          completedAt: next.kind === "ENDING" ? new Date() : null,
        },
      });
      if (update.count !== 1) return "CONFLICT";
      await tx.decision.create({
        data: {
          attemptId: p.attempt.id,
          nodeId: node.id,
          choiceId: choice.id,
          impactSnapshot: asJson(choice.impacts),
          contextSnapshot: asJson({
            nodeTitle: node.title,
            story: node.story,
            question: node.question,
            choiceLabel: choice.label,
            missionTitle: v.title,
          }),
        },
      });
      return "OK";
    });
    const errors: Record<string, [number, string]> = {
      UNAUTHORIZED: [401, "Session participant expirée ou invalide."],
      SESSION_CLOSED: [
        403,
        "Cette session est fermée ou sa date limite est dépassée.",
      ],
      FINISHED: [409, "Mission déjà terminée."],
      VERSION_MISSING: [
        409,
        "Version de mission indisponible. Contactez le formateur.",
      ],
      INVALID: [400, "Choix incompatible avec cette étape."],
      CONFLICT: [409, "Réponse déjà enregistrée. Actualisez le parcours."],
    };
    if (result !== "OK") {
      const [status, error] = errors[result];
      return void res.status(status).json({ error });
    }
    res.json(await getParticipantView(token));
  },
);
participantRouter.post("/participants/logout", async (req, res) => {
  const token = bearer(req.headers.authorization);
  if (token)
    await prisma.participant.updateMany({
      where: { guestTokenHash: hashGuestToken(token) },
      data: { revokedAt: new Date() },
    });
  res.json({ success: true });
});
