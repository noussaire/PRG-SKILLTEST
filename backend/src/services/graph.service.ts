import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const draftNodeSchema = z.object({
  key: z.string().trim().min(1).max(80),
  kind: z.enum(["QUESTION", "ENDING"]),
  title: z.string().trim().min(1).max(200),
  story: z.string().max(12000),
  question: z.string().max(4000).nullable().optional(),
  isStart: z.boolean().default(false),
  posX: z.number().finite().default(0),
  posY: z.number().finite().default(0),
  choices: z
    .array(
      z.object({
        position: z.number().int().min(0),
        label: z.string().trim().max(4000),
        targetKey: z.string().max(80),
        impacts: z
          .array(
            z.object({
              competencyId: z.string().uuid(),
              delta: z.number().int().min(-3).max(3),
            }),
          )
          .max(30)
          .default([]),
      }),
    )
    .max(20)
    .default([]),
});
export const draftGraphSchema = z.array(draftNodeSchema).min(1).max(100);
export type DraftNode = z.infer<typeof draftNodeSchema>;
export interface FrozenImpact {
  competencyId: string;
  competencySlug: string;
  competencyLabel: string;
  indicator: number;
}
export interface FrozenChoice {
  id: string;
  position: number;
  label: string;
  nextNodeId: string;
  impacts: FrozenImpact[];
}
export interface FrozenNode {
  id: string;
  key: string;
  kind: "QUESTION" | "ENDING";
  title: string;
  story: string;
  question: string | null;
  isStart: boolean;
  posX?: number | null;
  posY?: number | null;
  choices: FrozenChoice[];
}
const impactSchema = z.object({
  competencyId: z.string(),
  competencySlug: z.string(),
  competencyLabel: z.string(),
  indicator: z.number().int().min(-3).max(3),
});
const frozenSchema = z.array(
  z.object({
    id: z.string(),
    key: z.string(),
    kind: z.enum(["QUESTION", "ENDING"]),
    title: z.string(),
    story: z.string(),
    question: z.string().nullable(),
    isStart: z.boolean(),
    posX: z.number().nullable().optional(),
    posY: z.number().nullable().optional(),
    choices: z.array(
      z.object({
        id: z.string(),
        position: z.number(),
        label: z.string(),
        nextNodeId: z.string(),
        impacts: z.array(z.unknown()),
      }),
    ),
  }),
);
// Accept the previous snapshot shape while always producing one stable runtime format.
export function readFrozenGraph(value: unknown): FrozenNode[] {
  const parsed = frozenSchema.safeParse(value);
  if (!parsed.success) throw new Error("SNAPSHOT_INVALID");
  return parsed.data.map((n) => ({
    ...n,
    choices: n.choices.map((c) => ({
      ...c,
      impacts: c.impacts.map((raw) => {
        const item = raw as Record<string, unknown>;
        if (typeof item.competencySlug === "string")
          return impactSchema.parse(item);
        const comp = item.competency as
          | { slug: string; label: string }
          | undefined;
        return impactSchema.parse({
          competencyId: item.competencyId,
          competencySlug: comp?.slug,
          competencyLabel: comp?.label,
          indicator: item.indicator,
        });
      }),
    })),
  }));
}
export function graphToDraft(nodes: FrozenNode[]): DraftNode[] {
  const keys = new Map(nodes.map((n) => [n.id, n.key]));
  return nodes.map((n) => ({
    key: n.key,
    kind: n.kind,
    title: n.title,
    story: n.story,
    question: n.question,
    isStart: n.isStart,
    posX: n.posX ?? 0,
    posY: n.posY ?? 0,
    choices: n.choices.map((c) => ({
      position: c.position,
      label: c.label,
      targetKey: keys.get(c.nextNodeId) ?? "",
      impacts: c.impacts.map((i) => ({
        competencyId: i.competencyId,
        delta: i.indicator,
      })),
    })),
  }));
}
export function validateGraph(nodes: DraftNode[]) {
  const errors: string[] = [],
    warnings: string[] = [];
  const map = new Map(nodes.map((n) => [n.key, n]));
  if (map.size !== nodes.length)
    errors.push("Les clés des situations doivent être uniques.");
  const starts = nodes.filter((n) => n.isStart);
  if (starts.length !== 1 || starts[0]?.kind !== "QUESTION")
    errors.push("Définissez exactement une question de départ.");
  if (!nodes.some((n) => n.kind === "ENDING"))
    errors.push("Au moins une fin est obligatoire.");
  for (const n of nodes) {
    if (n.kind === "ENDING" && n.choices.length)
      errors.push(`La fin « ${n.title} » ne doit contenir aucun choix.`);
    if (n.kind === "QUESTION" && !n.choices.length)
      errors.push(`La question « ${n.title} » doit proposer un choix.`);
    if (n.kind === "QUESTION" && !n.question?.trim())
      errors.push(`La question « ${n.title} » doit contenir une consigne.`);
    if (!n.story.trim())
      errors.push(`La situation « ${n.title} » doit contenir un texte.`);
    if (new Set(n.choices.map((c) => c.position)).size !== n.choices.length)
      errors.push(`Positions dupliquées : ${n.title}.`);
    for (const c of n.choices) {
      if (!c.label.trim())
        errors.push(`Libellé de choix manquant : ${n.title}.`);
      if (!map.has(c.targetKey))
        errors.push(`Destination introuvable : ${n.title}.`);
      if (
        new Set(c.impacts.map((i) => i.competencyId)).size !== c.impacts.length
      )
        errors.push(`Compétence répétée pour un choix : ${n.title}.`);
    }
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  function cycle(key: string): boolean {
    if (visiting.has(key)) return true;
    if (done.has(key)) return false;
    visiting.add(key);
    for (const c of map.get(key)?.choices ?? [])
      if (map.has(c.targetKey) && cycle(c.targetKey)) return true;
    visiting.delete(key);
    done.add(key);
    return false;
  }
  if (nodes.some((n) => cycle(n.key)))
    errors.push(
      "Les boucles sont interdites : chaque situation ne peut être traitée qu'une fois.",
    );
  const reachable = new Set<string>();
  function visit(key: string) {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const c of map.get(key)?.choices ?? []) visit(c.targetKey);
  }
  if (starts.length === 1) visit(starts[0].key);
  if (starts.length === 1 && nodes.some((n) => !reachable.has(n.key)))
    errors.push(
      "Toutes les situations doivent être accessibles depuis le départ.",
    );
  const canFinish = new Set(
    nodes.filter((n) => n.kind === "ENDING").map((n) => n.key),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes)
      if (
        !canFinish.has(n.key) &&
        n.choices.some((c) => canFinish.has(c.targetKey))
      ) {
        canFinish.add(n.key);
        changed = true;
      }
  }
  if (nodes.some((n) => reachable.has(n.key) && !canFinish.has(n.key)))
    errors.push(
      "Chaque branche accessible doit permettre d'atteindre une fin.",
    );
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings };
}
export function remainingQuestions(nodes: FrozenNode[], currentId: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, { min: number; max: number }>();
  const visiting = new Set<string>();
  function count(id: string): { min: number; max: number } {
    if (memo.has(id)) return memo.get(id)!;
    const n = byId.get(id);
    if (!n || n.kind === "ENDING") return { min: 0, max: 0 };
    if (visiting.has(id)) return { min: 0, max: 0 };
    visiting.add(id);
    const children = n.choices.map((c) => count(c.nextNodeId));
    visiting.delete(id);
    const result = {
      min: 1 + (children.length ? Math.min(...children.map((c) => c.min)) : 0),
      max: 1 + (children.length ? Math.max(...children.map((c) => c.max)) : 0),
    };
    memo.set(id, result);
    return result;
  }
  return count(currentId);
}
export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
