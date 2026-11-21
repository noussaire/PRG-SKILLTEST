import "dotenv/config";
import { PrismaClient, type NodeKind } from "@prisma/client";
import {
  hashJoinCode,
  hashPassword,
  encryptCode,
} from "../src/security/tokens.js";

const prisma = new PrismaClient();
if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEMO_SEED !== "true"
)
  throw new Error(
    "Seed réservé au développement : définir ALLOW_DEMO_SEED=true.",
  );

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionCode = process.env.SEED_SESSION_CODE?.trim();
if (!adminEmail || !adminEmail.includes("@"))
  throw new Error("ADMIN_EMAIL invalide dans backend/.env");
if (
  !adminPassword ||
  adminPassword.length < 12 ||
  adminPassword.startsWith("REPLACE_")
)
  throw new Error("ADMIN_PASSWORD : minimum 12 caractères");
if (!sessionCode || !/^[a-z0-9_-]{6,32}$/i.test(sessionCode))
  throw new Error("SEED_SESSION_CODE : 6 à 32 lettres, chiffres, - ou _");

type NodeKey =
  | "start"
  | "talk"
  | "alone"
  | "meeting"
  | "success"
  | "recovery"
  | "pressure"
  | "plan"
  | "end_good"
  | "end_review";

const nodeData: Record<
  NodeKey,
  {
    kind: NodeKind;
    title: string;
    story: string;
    question: string | null;
    isStart: boolean;
  }
> = {
  start: {
    kind: "QUESTION",
    title: "Le projet en danger",
    story:
      "Ton équipe de cinq étudiants doit présenter son projet demain. Une partie essentielle n'est pas terminée et l'inquiétude monte.",
    question: "Quelle est ta première réaction ?",
    isStart: true,
  },
  talk: {
    kind: "QUESTION",
    title: "Une difficulté inattendue",
    story:
      "Tu contactes ton camarade. Il t'explique qu'il traverse une difficulté personnelle et qu'il n'a pas osé en parler. Il lui reste du travail.",
    question: "Que proposes-tu à présent ?",
    isStart: false,
  },
  alone: {
    kind: "QUESTION",
    title: "Tu es débordé !",
    story:
      "Tu décides de tout faire seul. Deux heures plus tard, tu réalises que tu ne pourras pas terminer. Un camarade remarque ton stress.",
    question: "Quelle est ta prochaine décision ?",
    isStart: false,
  },
  meeting: {
    kind: "QUESTION",
    title: "Un désaccord dans l'équipe",
    story:
      "Lors de la réunion, deux membres se disputent : l'un veut exclure le camarade en retard, l'autre demande une seconde chance.",
    question: "Comment fais-tu avancer la discussion ?",
    isStart: false,
  },
  success: {
    kind: "QUESTION",
    title: "Une organisation collective",
    story:
      "Tu as favorisé un échange constructif. Le groupe définit des priorités et partage les tâches. Le projet avance dans un climat plus serein.",
    question: "Comment consolider la suite du projet ?",
    isStart: false,
  },
  recovery: {
    kind: "QUESTION",
    title: "Tu ajustes ta stratégie",
    story:
      "En demandant de l'aide, tu débloques la situation. L'équipe réorganise les tâches et récupère une partie du retard.",
    question: "Comment consolider la suite du projet ?",
    isStart: false,
  },
  pressure: {
    kind: "QUESTION",
    title: "Une piste d'amélioration",
    story:
      "Les tensions persistent et certains délais sont menacés. Cette situation invite à réfléchir à l'écoute, à la délégation et à la coordination.",
    question: "Comment consolider la suite du projet ?",
    isStart: false,
  },
  plan: {
    kind: "QUESTION",
    title: "Le suivi final",
    story:
      "L'équipe a un plan. Le temps reste limité et un imprévu technique apparaît.",
    question: "Comment vérifiez-vous que le groupe pourra livrer ?",
    isStart: false,
  },
  end_good: {
    kind: "ENDING",
    title: "Un apprentissage collectif",
    story:
      "Le groupe a explicité ses priorités et ses besoins. Prenez le temps de discuter des effets de vos choix avec le formateur.",
    question: null,
    isStart: false,
  },
  end_review: {
    kind: "ENDING",
    title: "Des pistes à explorer",
    story:
      "Le projet met en lumière l'importance du suivi et de l'entraide. Votre bilan propose des repères pour progresser.",
    question: null,
    isStart: false,
  },
};

type DemoPath = {
  from: NodeKey;
  position: number;
  label: string;
  to: NodeKey;
  impacts: Record<string, number>;
};
const paths: DemoPath[] = [
  {
    from: "start",
    position: 0,
    label: "Je contacte la personne pour comprendre son problème.",
    to: "talk",
    impacts: { communication: 2, "ecoute-et-empathie": 2 },
  },
  {
    from: "start",
    position: 1,
    label: "Je prends en charge son travail sans consulter l'équipe.",
    to: "alone",
    impacts: { "gestion-du-temps": 1, "travail-en-equipe": -1 },
  },
  {
    from: "start",
    position: 2,
    label: "Je propose une réunion courte pour réorganiser les tâches.",
    to: "meeting",
    impacts: { leadership: 1, "travail-en-equipe": 1 },
  },
  {
    from: "talk",
    position: 0,
    label: "Je propose de répartir avec son accord les tâches restantes.",
    to: "success",
    impacts: { "ecoute-et-empathie": 1, "travail-en-equipe": 2 },
  },
  {
    from: "talk",
    position: 1,
    label: "Je lui demande de terminer seul malgré sa difficulté.",
    to: "pressure",
    impacts: { "ecoute-et-empathie": -1 },
  },
  {
    from: "alone",
    position: 0,
    label: "J'explique la situation et je demande une aide ciblée.",
    to: "recovery",
    impacts: { communication: 1, "travail-en-equipe": 2 },
  },
  {
    from: "alone",
    position: 1,
    label: "Je continue seul sans prévenir les autres.",
    to: "pressure",
    impacts: { "travail-en-equipe": -1 },
  },
  {
    from: "meeting",
    position: 0,
    label: "J'écoute les avis puis je propose un plan commun.",
    to: "success",
    impacts: { leadership: 2, "ecoute-et-empathie": 1 },
  },
  {
    from: "meeting",
    position: 1,
    label: "Je tranche immédiatement, sans écouter les deux parties.",
    to: "pressure",
    impacts: { communication: -1 },
  },
  ...(["success", "recovery", "pressure"] as const).flatMap(
    (from): DemoPath[] => [
      {
        from,
        position: 0,
        label: "Je définis des priorités et un point de suivi avec l'équipe.",
        to: "plan" as const,
        impacts: {
          "gestion-du-temps": 2,
          "travail-en-equipe": 1,
          "resolution-de-problemes": 1,
        },
      },
      {
        from,
        position: 1,
        label: "Je maintiens le plan initial sans vérifier les contraintes.",
        to: "plan" as const,
        impacts: { adaptabilite: -1, "gestion-du-temps": -1 },
      },
    ],
  ),
  {
    from: "plan",
    position: 0,
    label:
      "Je vérifie les blocages, ajuste le périmètre et partage les responsabilités.",
    to: "end_good",
    impacts: { adaptabilite: 2, "resolution-de-problemes": 2, leadership: 1 },
  },
  {
    from: "plan",
    position: 1,
    label: "Je laisse chacun gérer sans coordination supplémentaire.",
    to: "end_review",
    impacts: { communication: -1, "travail-en-equipe": -1 },
  },
];

// Demo content is explicitly bilingual; authoring accepts the same :::fr / :::ar format.
const arabicNodes: Record<NodeKey, [string, string, string | null]> = {
  start: [
    "مشروع في خطر",
    "فريقك المكون من خمسة طلاب سيقدم المشروع غداً. جزء أساسي لم يكتمل والقلق يتزايد.",
    "ما أول رد فعل لك؟",
  ],
  talk: [
    "صعوبة غير متوقعة",
    "تتواصل مع زميلك فيخبرك بأنه يمر بظروف شخصية صعبة ولم يجرؤ على الحديث عنها.",
    "ماذا تقترح الآن؟",
  ],
  alone: [
    "ضغط العمل",
    "قررت إنجاز العمل وحدك. بعد ساعتين تكتشف أن الوقت لن يكفي، ويلاحظ زميلك توترك.",
    "ما قرارك التالي؟",
  ],
  meeting: [
    "خلاف داخل الفريق",
    "يريد عضو استبعاد الزميل المتأخر بينما يطلب عضو آخر منحه فرصة ثانية.",
    "كيف تدفع النقاش نحو حل؟",
  ],
  success: [
    "تنظيم جماعي",
    "حددت المجموعة أولوياتها ووزعت المهام بعد نقاش بنّاء.",
    "كيف تدعم المرحلة التالية؟",
  ],
  recovery: [
    "تعديل الاستراتيجية",
    "ساعد طلب الدعم الفريق على إعادة تنظيم العمل وتعويض جزء من التأخير.",
    "كيف تدعم المرحلة التالية؟",
  ],
  pressure: [
    "فرصة للتحسين",
    "التوتر مستمر وبعض المواعيد مهددة. فكر في الاستماع والتفويض والتنسيق.",
    "كيف تدعم المرحلة التالية؟",
  ],
  plan: [
    "المتابعة النهائية",
    "أصبح لدى الفريق خطة، لكن الوقت محدود وظهر عائق تقني مفاجئ.",
    "كيف تتأكد من قدرة الفريق على التسليم؟",
  ],
  end_good: [
    "تعلم جماعي",
    "وضح الفريق أولوياته واحتياجاته. ناقش آثار قراراتك مع المؤطر.",
    null,
  ],
  end_review: [
    "محاور للاستكشاف",
    "أبرز المشروع أهمية المتابعة والتعاون. يقدم تقريرك مؤشرات تساعدك على التطور.",
    null,
  ],
};
for (const key of Object.keys(nodeData) as NodeKey[]) {
  const n = nodeData[key],
    ar = arabicNodes[key];
  n.title = `:::fr${n.title}:::ar${ar[0]}`;
  n.story = `:::fr${n.story}:::ar${ar[1]}`;
  if (n.question) n.question = `:::fr${n.question}:::ar${ar[2]}`;
}
const arabicChoices = [
  "أتواصل مع الزميل لفهم مشكلته.",
  "أتولى عمله دون استشارة الفريق.",
  "أقترح اجتماعاً قصيراً لإعادة توزيع المهام.",
  "أقترح توزيع المهام المتبقية بموافقته.",
  "أطلب منه الإكمال وحده رغم صعوبته.",
  "أشرح الوضع وأطلب مساعدة محددة.",
  "أواصل وحدي دون إخبار الآخرين.",
  "أستمع للآراء ثم أقترح خطة مشتركة.",
  "أحسم القرار فوراً دون الاستماع للطرفين.",
  "أحدد الأولويات وموعد متابعة مع الفريق.",
  "أبقي الخطة الأصلية دون التحقق من القيود.",
  "أحدد الأولويات وموعد متابعة مع الفريق.",
  "أبقي الخطة الأصلية دون التحقق من القيود.",
  "أحدد الأولويات وموعد متابعة مع الفريق.",
  "أبقي الخطة الأصلية دون التحقق من القيود.",
  "أتحقق من العوائق وأعدل نطاق العمل وأوزع المسؤوليات.",
  "أترك كل شخص يدبر عمله دون تنسيق إضافي.",
];
paths.forEach((path, index) => {
  path.label = `:::fr${path.label}:::ar${arabicChoices[index]}`;
});

async function main() {
  const { ensureStandardCompetencies } = await import(
    "../src/services/evaluation.service.js"
  );
  const { asJson } = await import("../src/services/graph.service.js");
  await ensureStandardCompetencies();
  const existing = await prisma.assessment.findUnique({
    where: { slug: "parcours-decisions-01" },
  });
  if (existing) {
    console.log(
      "Démonstration déjà présente : aucune donnée existante modifiée.",
    );
    return;
  }
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail! },
  });
  if (existingAdmin && existingAdmin.role !== "ADMIN")
    throw new Error("Le compte initial existe avec un autre rôle.");
  const passwordHash = await hashPassword(adminPassword!);
  await prisma.$transaction(
    async (tx) => {
      const admin =
        existingAdmin ??
        (await tx.user.create({
          data: { email: adminEmail!, role: "ADMIN", passwordHash },
        }));
      const assessment = await tx.assessment.create({
        data: {
          slug: "parcours-decisions-01",
          title:
            ":::frParcours des décisions — démonstration:::arمسار القرارات — نسخة تجريبية",
          status: "PUBLISHED",
        },
      });
      const mission = await tx.mission.create({
        data: {
          assessmentId: assessment.id,
          position: 1,
          title: ":::frLe projet en danger:::arمشروع في خطر",
          version: 1,
          status: "PUBLISHED",
          estimatedDuration: 5,
          pedagogicalGoal:
            "Discussion pédagogique de quatre décisions ; démonstration non validée psychométriquement.",
        },
      });
      const ids = {} as Record<NodeKey, string>;
      for (const [key, item] of Object.entries(nodeData) as [
        NodeKey,
        (typeof nodeData)[NodeKey],
      ][]) {
        const node = await tx.scenarioNode.create({
          data: { missionId: mission.id, graphVersion: 1, key, ...item },
        });
        ids[key] = node.id;
      }
      const competencies = await tx.competency.findMany();
      for (const path of paths) {
        await tx.scenarioChoice.create({
          data: {
            nodeId: ids[path.from],
            nextNodeId: ids[path.to],
            position: path.position,
            label: path.label,
            impacts: {
              create: Object.entries(path.impacts).map(([slug, indicator]) => ({
                competencyId: competencies.find((c) => c.slug === slug)!.id,
                indicator,
              })),
            },
          },
        });
      }
      const graph = await tx.scenarioNode.findMany({
        where: { missionId: mission.id },
        include: {
          choices: { include: { impacts: { include: { competency: true } } } },
        },
      });
      await tx.missionVersion.create({
        data: {
          missionId: mission.id,
          version: 1,
          title: mission.title,
          estimatedDuration: 5,
          pedagogicalGoal: mission.pedagogicalGoal,
          graphSnapshot: asJson(graph),
        },
      });
      await tx.assessmentSession.create({
        data: {
          assessmentId: assessment.id,
          createdById: admin.id,
          label: ":::frDémonstration pédagogique:::arتجربة تربوية",
          codeHash: hashJoinCode(sessionCode!),
          codeCipher: encryptCode(sessionCode!),
          status: "OPEN",
        },
      });
    },
    { timeout: 20000 },
  );
  console.log(
    "Démonstration créée : quatre décisions par parcours. Utilisez le code personnel configuré dans SEED_SESSION_CODE.",
  );
}
await main()
  .catch(() => {
    console.error(
      "Initialisation impossible. Vérifiez les paramètres et la disponibilité de la base.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
