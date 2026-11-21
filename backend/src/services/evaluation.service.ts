import { prisma } from "../db/prisma.js";
import { readFrozenGraph, type FrozenImpact } from "./graph.service.js";
import {
  canonicalSlug,
  determineProfile,
  interpret,
  STANDARD_COMPETENCIES,
  type SoftSkillsProfile,
} from "./scoring.js";
export { STANDARD_COMPETENCIES, determineProfile } from "./scoring.js";
export interface ContributingDecision {
  nodeId: string;
  nodeTitle: string;
  question: string | null;
  choiceId: string;
  choiceLabel: string;
  delta: number;
  missionTitle: string;
  timestamp: Date;
}
export interface CompetencyIndicator {
  slug: string;
  label: string;
  description: string | null;
  cumulativeValue: number;
  averageValue: number;
  decisionCount: number;
  evaluated: boolean;
  pedagogicalInterpretation: string;
  contributions: ContributingDecision[];
}
export interface ParticipantReportData {
  participant: {
    id: string;
    publicId: string;
    displayName: string;
    createdAt: Date;
  };
  session: {
    id: string;
    label: string;
    status: string;
    assessmentTitle: string;
  };
  attempt: {
    id: string;
    status: "IN_PROGRESS" | "COMPLETED";
    missionVersion: number;
    startedAt: Date;
    completedAt: Date | null;
    totalDecisions: number;
  };
  mission: {
    id: string;
    title: string;
    version: number;
    description: string | null;
    pedagogicalGoal: string | null;
    targetCompetencies: string | null;
    estimatedDuration: number;
  };
  profile: SoftSkillsProfile;
  indicators: CompetencyIndicator[];
  strengths: Array<{ competency: string; summary: string }>;
  improvements: Array<{ competency: string; summary: string }>;
  recommendations: Array<{ title: string; action: string }>;
  decisionTimeline: Array<{
    stepIndex: number;
    nodeTitle: string;
    storyExcerpt: string;
    question: string | null;
    chosenOption: string;
    date: Date;
    impacts: Array<{ competency: string; delta: number }>;
  }>;
  methodologyNote: string;
  historicalNotice: string | null;
  generatedAt: Date;
}
export async function ensureStandardCompetencies() {
  for (const c of STANDARD_COMPETENCIES)
    await prisma.competency.upsert({
      where: { slug: c.slug },
      create: c,
      update: c,
    });
}
export async function generateAttemptReport(
  attemptId: string,
): Promise<ParticipantReportData | null> {
  const a = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      participant: { include: { session: { include: { assessment: true } } } },
      currentNode: true,
      decisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!a) return null;
  const v = await prisma.missionVersion.findUnique({
    where: {
      missionId_version: {
        missionId: a.currentNode.missionId,
        version: a.missionVersion ?? 1,
      },
    },
  });
  if (!v) throw new Error("SNAPSHOT_MISSING");
  const graph = readFrozenGraph(v.graphSnapshot);
  // No reads of mutable choice impacts or mission metadata: the pinned version is authoritative.
  const rows = a.decisions.map((d) => {
    const n = graph.find((n) => n.id === d.nodeId),
      c = n?.choices.find((c) => c.id === d.choiceId);
    const context = d.contextSnapshot as {
      nodeTitle?: string;
      story?: string;
      question?: string | null;
      choiceLabel?: string;
      missionTitle?: string;
    } | null;
    const impacts = (Array.isArray(d.impactSnapshot)
      ? d.impactSnapshot
      : (c?.impacts ?? [])) as unknown as FrozenImpact[];
    return {
      decision: d,
      nodeTitle:
        context?.nodeTitle ?? n?.title ?? "Situation historique indisponible",
      story: context?.story ?? n?.story ?? "",
      question:
        context?.question !== undefined
          ? context.question
          : (n?.question ?? null),
      choiceLabel:
        context?.choiceLabel ?? c?.label ?? "Choix historique indisponible",
      missionTitle: context?.missionTitle ?? v.title,
      impacts,
    };
  });
  const registry = new Map(
    STANDARD_COMPETENCIES.map((c) => [c.slug, { ...c }]),
  );
  for (const r of rows)
    for (const impact of r.impacts) {
      const slug = canonicalSlug(impact.competencySlug);
      if (!registry.has(slug))
        registry.set(slug, {
          slug,
          label: impact.competencyLabel,
          description: "Compétence définie pour la mission.",
        });
    }
  const indicators: CompetencyIndicator[] = [...registry.values()].map(
    (comp) => {
      const contributions: ContributingDecision[] = [];
      for (const r of rows) {
        const impacts = r.impacts.filter(
          (i) => canonicalSlug(i.competencySlug) === comp.slug,
        );
        // Old synonymous dimensions in a single choice count as ONE observation, never duplicate evidence.
        if (impacts.length) {
          const delta =
            impacts.reduce((s, i) => s + i.indicator, 0) / impacts.length;
          contributions.push({
            nodeId: r.decision.nodeId,
            nodeTitle: r.nodeTitle,
            question: r.question,
            choiceId: r.decision.choiceId,
            choiceLabel: r.choiceLabel,
            delta,
            missionTitle: r.missionTitle,
            timestamp: r.decision.createdAt,
          });
        }
      }
      const cumulativeValue = contributions.reduce((s, c) => s + c.delta, 0),
        decisionCount = contributions.length,
        averageValue = decisionCount ? cumulativeValue / decisionCount : 0;
      return {
        ...comp,
        cumulativeValue,
        decisionCount,
        averageValue,
        evaluated: decisionCount > 0,
        pedagogicalInterpretation: interpret(averageValue, decisionCount),
        contributions,
      };
    },
  );
  const profile = determineProfile(indicators, a.decisions.length);
  const strengthIndicators = indicators
    .filter((i) => i.evaluated && i.averageValue > 0)
    .sort((x, y) => y.averageValue - x.averageValue);
  const improvementIndicators = indicators
    .filter((i) => i.evaluated && i.averageValue < 0)
    .sort((x, y) => x.averageValue - y.averageValue);
  const summary = (i: CompetencyIndicator) => ({
    competency: i.label,
    summary: `${i.pedagogicalInterpretation} Moyenne ${i.averageValue.toFixed(2)} sur ${i.decisionCount} observation(s), échelle −3 à +3.`,
  });
  const recommendations = [
    {
      title: ":::frRelire ses décisions:::arمراجعة القرارات",
      action:
        ":::frChoisissez une situation et expliquez votre raisonnement au formateur. Comparez ensuite les conséquences des autres options.:::arاختر موقفاً واشرح أسباب قرارك للمؤطر، ثم ناقش نتائج الخيارات الأخرى.",
    },
  ];
  if (improvementIndicators.length)
    recommendations.push({
      title: ":::frPréparer une autre stratégie:::arإعداد استراتيجية بديلة",
      action:
        ":::frPour votre principal axe de progression, formulez une action concrète à essayer lors du prochain travail de groupe.:::arبالنسبة لأهم محور للتطوير، حدد إجراءً عملياً لتجربته في العمل الجماعي المقبل.",
    });
  return {
    participant: {
      id: a.participant.id,
      publicId: a.participant.publicId,
      displayName: a.participant.displayName,
      createdAt: a.participant.createdAt,
    },
    session: {
      id: a.participant.session.id,
      label: a.participant.session.label,
      status: a.participant.session.status,
      assessmentTitle: a.participant.session.assessment?.title ?? "Parcours Adaptatif",
    },
    attempt: {
      id: a.id,
      status: a.status,
      missionVersion: v.version,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      totalDecisions: a.decisions.length,
    },
    mission: {
      id: v.missionId,
      title: v.title,
      version: v.version,
      description: v.description,
      pedagogicalGoal: v.pedagogicalGoal,
      targetCompetencies: v.targetCompetencies,
      estimatedDuration: v.estimatedDuration ?? 15,
    },
    profile,
    indicators,
    strengths: strengthIndicators.map(summary),
    improvements: improvementIndicators.map(summary),
    recommendations,
    decisionTimeline: rows.map((r, i) => ({
      stepIndex: i + 1,
      nodeTitle: r.nodeTitle,
      storyExcerpt: r.story.slice(0, 140),
      question: r.question,
      chosenOption: r.choiceLabel,
      date: r.decision.createdAt,
      impacts: r.impacts.map((imp) => ({
        competency:
          STANDARD_COMPETENCIES.find(
            (c) => c.slug === canonicalSlug(imp.competencySlug),
          )?.label ?? imp.competencyLabel,
        delta: imp.indicator,
      })),
    })),
    methodologyNote:
      ":::frRepères pédagogiques contextuels, sans validation psychométrique et sans note scolaire. Les moyennes portent uniquement sur les décisions qui sollicitent chaque compétence (échelle −3 à +3). Une dimension non observée ne vaut pas zéro. Les parcours différents ne constituent pas un classement comparable.:::arمؤشرات تربوية مرتبطة بالسياق، وليست اختباراً نفسياً مقنناً أو نقطة مدرسية. تُحسب المتوسطات من القرارات التي تقيس كل مهارة فقط، على مقياس من −3 إلى +3. المهارة غير الملاحظة لا تعني صفراً، ولا تسمح المسارات المختلفة بترتيب مقارن للطلاب.",
    historicalNotice: v.changelog?.startsWith("LEGACY_BACKFILL")
      ? "Version historique reconstruite à partir des données disponibles lors de la mise à niveau ; les modifications antérieures ne peuvent pas être reconstituées."
      : null,
    generatedAt: new Date(),
  };
}
