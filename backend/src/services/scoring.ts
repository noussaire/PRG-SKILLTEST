export const STANDARD_COMPETENCIES = [
  {
    slug: "communication",
    label: "Communication",
    description: "Clarté et qualité des échanges.",
  },
  {
    slug: "leadership",
    label: "Leadership",
    description: "Initiative, coordination et responsabilisation.",
  },
  {
    slug: "travail-en-equipe",
    label: "Travail en équipe",
    description: "Collaboration et entraide.",
  },
  {
    slug: "gestion-du-temps",
    label: "Gestion du temps",
    description: "Priorisation et organisation.",
  },
  {
    slug: "resolution-de-problemes",
    label: "Résolution de problèmes",
    description: "Analyse et recherche de solutions.",
  },
  {
    slug: "adaptabilite",
    label: "Adaptabilité",
    description: "Ajustement face aux imprévus.",
  },
  {
    slug: "ecoute-et-empathie",
    label: "Écoute et empathie",
    description: "Prise en compte des besoins d'autrui.",
  },
];
export function canonicalSlug(slug: string) {
  return (
    (
      {
        collaboration: "travail-en-equipe",
        empathie: "ecoute-et-empathie",
        organisation: "gestion-du-temps",
      } as Record<string, string>
    )[slug] ?? slug
  );
}
export interface ScoreDimension {
  slug: string;
  label: string;
  cumulativeValue: number;
  decisionCount: number;
  evaluated: boolean;
  averageValue: number;
}
export interface SoftSkillsProfile {
  title: string;
  tagline: string;
  description: string;
  ruleExplanation: string;
  dominantCompetencies: string[];
}
export function determineProfile(
  indicators: ScoreDimension[],
  totalDecisions: number,
): SoftSkillsProfile {
  const create = (
    title: string,
    tagline: string,
    description: string,
    ruleExplanation: string,
    dominantCompetencies: string[] = [],
  ): SoftSkillsProfile => ({
    title,
    tagline,
    description,
    ruleExplanation,
    dominantCompetencies,
  });
  const rule =
    "Repères pédagogiques exploratoires : moyenne des impacts par décision observée (−3 à +3). Une tendance nécessite au moins 4 décisions au total et 2 observations par compétence concernée. Aucune validation psychométrique.";
  if (totalDecisions === 0)
    return create(
      "Parcours en attente",
      "Aucune décision enregistrée",
      "Commencez le parcours pour recueillir des observations.",
      rule,
    );
  const reliable = indicators.filter((i) => i.decisionCount >= 2);
  if (totalDecisions < 4 || reliable.length < 2)
    return create(
      "Observations insuffisantes",
      "Un premier retour, sans profil définitif",
      "Les décisions disponibles ne suffisent pas à dégager une tendance fiable. Les observations ci-dessous servent de point de départ à un échange avec le formateur.",
      rule,
    );
  const v = (slug: string) =>
    reliable.find((i) => i.slug === slug)?.averageValue ?? 0;
  if (reliable.some((i) => i.averageValue < 0))
    return create(
      "Axes de progression à explorer",
      "Des comportements à discuter dans leur contexte",
      "Certaines décisions présentent des impacts défavorables dans la grille de cette mission. Explorez leurs raisons avec le formateur avant toute conclusion générale.",
      rule,
    );
  if (
    v("travail-en-equipe") >= 1 &&
    (v("resolution-de-problemes") >= 1 || v("adaptabilite") >= 1)
  )
    return create(
      "Collaborateur Stratégique",
      "Tendance au travail collectif et à l'analyse",
      "Vos décisions observées favorisent la coopération et l'ajustement des solutions.",
      rule,
      [
        "Travail en équipe",
        v("resolution-de-problemes") >= 1
          ? "Résolution de problèmes"
          : "Adaptabilité",
      ],
    );
  if (v("communication") >= 1 && v("ecoute-et-empathie") >= 1)
    return create(
      "Communicant Réfléchi",
      "Tendance au dialogue et à l'écoute",
      "Vos décisions observées favorisent l'expression constructive et la prise en compte des autres.",
      rule,
      ["Communication", "Écoute et empathie"],
    );
  if (
    v("leadership") >= 1 &&
    (v("gestion-du-temps") >= 1 || v("travail-en-equipe") >= 1)
  )
    return create(
      "Coordinateur d'Équipe",
      "Tendance à la coordination",
      "Vos décisions observées favorisent l'organisation et les initiatives collectives.",
      rule,
      [
        "Leadership",
        v("gestion-du-temps") >= 1 ? "Gestion du temps" : "Travail en équipe",
      ],
    );
  if (v("resolution-de-problemes") >= 1 && v("adaptabilite") >= 1)
    return create(
      "Résolveur Créatif",
      "Tendance à l'analyse et à l'adaptation",
      "Vos décisions observées favorisent la recherche et l'ajustement de solutions.",
      rule,
      ["Résolution de problèmes", "Adaptabilité"],
    );
  return create(
    "Tendances à approfondir",
    "Aucune dominante suffisamment étayée",
    "Ce parcours ne fait pas apparaître de dominante claire selon les règles retenues. Cela ne signifie ni réussite ni échec.",
    rule,
  );
}
export function interpret(average: number, count: number) {
  if (count === 0)
    return "Dimension non observée dans les décisions de ce parcours.";
  const prefix = count < 2 ? "Observation limitée : " : "";
  if (average >= 1)
    return (
      prefix +
      "Les choix observés favorisent cette compétence dans le contexte de la mission."
    );
  if (average > 0)
    return (
      prefix + "Une tendance constructive légère apparaît dans ce contexte."
    );
  if (average === 0)
    return (
      prefix +
      "Les impacts observés se compensent ou sont neutres ; aucune conclusion générale."
    );
  return (
    prefix +
    "Un axe de progression apparaît dans ce contexte ; discutez les décisions avec le formateur."
  );
}
