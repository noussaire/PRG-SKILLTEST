import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  validateGraph,
  graphToDraft,
  readFrozenGraph,
  remainingQuestions,
  type DraftNode,
} from "../src/services/graph.service.js";
import {
  sessionAcceptsDecisions,
  guestAccessValid,
} from "../src/services/session-policy.js";
import {
  determineProfile,
  canonicalSlug,
  interpret,
} from "../src/services/scoring.js";
const graph = (): DraftNode[] => [
  {
    key: "q",
    kind: "QUESTION",
    title: "Question",
    story: "Situation",
    question: "Que faire ?",
    isStart: true,
    posX: 0,
    posY: 0,
    choices: [
      { position: 0, label: "Continuer", targetKey: "end", impacts: [] },
    ],
  },
  {
    key: "end",
    kind: "ENDING",
    title: "Fin",
    story: "Conclusion",
    question: null,
    isStart: false,
    posX: 1,
    posY: 1,
    choices: [],
  },
];
test("A complete acyclic scenario is publishable", () =>
  assert.equal(validateGraph(graph()).valid, true));
test("A self-loop and inaccessible ending cannot be published", () => {
  const g = graph();
  g[0].choices[0].targetKey = "q";
  assert.equal(validateGraph(g).valid, false);
});
test("An indirect cycle cannot be published", () => {
  const g = graph();
  g.splice(1, 0, {
    ...g[0],
    key: "q2",
    isStart: false,
    choices: [{ position: 0, label: "Back", targetKey: "q", impacts: [] }],
  });
  g[0].choices[0].targetKey = "q2";
  assert.equal(validateGraph(g).valid, false);
});
test("All branches require a destination and question text", () => {
  const g = graph();
  g[0].choices[0].targetKey = "missing";
  g[0].question = "";
  assert.ok(validateGraph(g).errors.length >= 2);
});
test("A final node cannot contain choices", () => {
  const g = graph();
  g[1].choices = g[0].choices;
  assert.equal(validateGraph(g).valid, false);
});
test("Duplicate node keys and repeated competency impacts are rejected", () => {
  const g = graph(),
    id = randomUUID();
  g.push({ ...g[1] });
  g[0].choices[0].impacts = [
    { competencyId: id, delta: 1 },
    { competencyId: id, delta: 2 },
  ];
  assert.equal(validateGraph(g).valid, false);
});
test("An ending cannot be the start", () => {
  const g = graph();
  g[0].isStart = false;
  g[1].isStart = true;
  assert.equal(validateGraph(g).valid, false);
});
test("The closing boundary is exclusive for both joins and decisions", () => {
  const now = new Date();
  assert.equal(
    sessionAcceptsDecisions(
      { status: "OPEN", opensAt: null, closesAt: now },
      now,
    ),
    false,
  );
});
test("Scheduled sessions admit students from their exact opening time", () => {
  const now = new Date();
  assert.equal(
    sessionAcceptsDecisions(
      { status: "SCHEDULED", opensAt: now, closesAt: null },
      now,
    ),
    true,
  );
  assert.equal(
    sessionAcceptsDecisions(
      { status: "SCHEDULED", opensAt: null, closesAt: null },
      now,
    ),
    false,
  );
});
test("Draft, future and archived sessions refuse decisions", () => {
  const now = new Date();
  for (const status of ["DRAFT", "CLOSED", "ARCHIVED"])
    assert.equal(
      sessionAcceptsDecisions({ status, opensAt: null, closesAt: null }, now),
      false,
    );
  assert.equal(
    sessionAcceptsDecisions(
      { status: "OPEN", opensAt: new Date(now.getTime() + 1), closesAt: null },
      now,
    ),
    false,
  );
});
test("Server-side guest expiry and revocation are authoritative", () => {
  const now = new Date();
  assert.equal(
    guestAccessValid({ tokenExpiresAt: now, revokedAt: null }, now),
    false,
  );
  assert.equal(
    guestAccessValid(
      { tokenExpiresAt: new Date(+now + 10000), revokedAt: now },
      now,
    ),
    false,
  );
});
const dimensions = (value: number, count = 4) =>
  [
    "communication",
    "ecoute-et-empathie",
    "travail-en-equipe",
    "leadership",
    "adaptabilite",
    "gestion-du-temps",
    "resolution-de-problemes",
  ].map((slug) => ({
    slug,
    label: slug,
    averageValue: value,
    cumulativeValue: value * count,
    decisionCount: count,
    evaluated: true,
  }));
test("Negative observations never produce a positive balanced default", () =>
  assert.equal(
    determineProfile(dimensions(-2), 4).title,
    "Axes de progression à explorer",
  ));
test("Two decisions cannot establish a definitive profile", () =>
  assert.equal(
    determineProfile(dimensions(2, 1), 2).title,
    "Observations insuffisantes",
  ));
test("Repeating the same average does not change the resulting profile", () =>
  assert.equal(
    determineProfile(dimensions(1, 4), 4).title,
    determineProfile(dimensions(1, 12), 12).title,
  ));
test("Unobserved and neutral competencies have different interpretations", () =>
  assert.notEqual(interpret(0, 0), interpret(0, 2)));
test("Legacy slugs map to the canonical framework", () => {
  assert.equal(canonicalSlug("collaboration"), "travail-en-equipe");
  assert.equal(canonicalSlug("organisation"), "gestion-du-temps");
  assert.equal(canonicalSlug("empathie"), "ecoute-et-empathie");
});
test("Legacy snapshot data converts without changing chosen texts or impacts", () => {
  const id = randomUUID();
  const frozen = readFrozenGraph([
    {
      id: "q",
      key: "q",
      kind: "QUESTION",
      title: "Old text",
      story: "Story",
      question: "?",
      isStart: true,
      choices: [
        {
          id: "c",
          position: 0,
          label: "Old choice",
          nextNodeId: "e",
          impacts: [
            {
              competencyId: id,
              indicator: 2,
              competency: { slug: "communication", label: "Communication" },
            },
          ],
        },
      ],
    },
    {
      id: "e",
      key: "end",
      kind: "ENDING",
      title: "End",
      story: "Done",
      question: null,
      isStart: false,
      choices: [],
    },
  ]);
  assert.equal(frozen[0].choices[0].impacts[0].indicator, 2);
  assert.equal(graphToDraft(frozen)[0].choices[0].targetKey, "end");
  assert.deepEqual(remainingQuestions(frozen, "q"), { min: 1, max: 1 });
});
