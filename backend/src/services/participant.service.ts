import { prisma } from "../db/prisma.js";
import { hashGuestToken } from "../security/tokens.js";
import { readFrozenGraph, remainingQuestions } from "./graph.service.js";
import { guestAccessValid, sessionAcceptsDecisions } from "./session-policy.js";

export async function getParticipantView(guestToken: string) {
  const p = await prisma.participant.findUnique({
    where: { guestTokenHash: hashGuestToken(guestToken) },
    include: {
      session: { include: { assessment: true } },
      attempt: {
        include: { currentNode: true, _count: { select: { decisions: true } } },
      },
    },
  });
  if (!p?.attempt || !guestAccessValid(p)) return null;
  const v = await prisma.missionVersion.findUnique({
    where: {
      missionId_version: {
        missionId: p.attempt.currentNode.missionId,
        version: p.attempt.missionVersion ?? 1,
      },
    },
  });
  if (!v) throw new Error("SNAPSHOT_MISSING");
  const graph = readFrozenGraph(v.graphSnapshot),
    node = graph.find((n) => n.id === p.attempt!.currentNodeId);
  if (!node) throw new Error("SNAPSHOT_NODE_MISSING");
  const remaining = remainingQuestions(graph, node.id),
    completed = p.attempt._count.decisions;
  return {
    participant: { displayName: p.displayName, publicId: p.publicId },
    session: {
      label: p.session.label,
      assessment: p.session.assessment?.title ?? "Parcours Adaptatif",
      acceptingDecisions: sessionAcceptsDecisions(p.session),
      closesAt: p.session.closesAt,
    },
    attempt: {
      status: p.attempt.status,
      missionVersion: v.version,
      completedDecisions: completed,
      remainingQuestions: remaining,
      currentNode: {
        id: node.id,
        kind: node.kind,
        title: node.title,
        story: node.story,
        question: node.question,
        choices:
          node.kind === "ENDING"
            ? []
            : node.choices
                .map(({ id, label, position }) => ({ id, label, position }))
                .sort((a, b) => a.position - b.position),
      },
    },
  };
}
