# SkillQuest ? fichiers complets

Fichiers d?j? appliqu?s. Chaque bloc contient le fichier entier, pr?t ? copier ? son emplacement. D?pendances existantes inchang?es ; conserver adaptive-demo.json et les images /brand/previews.

## frontend/src/lib/home-content.ts

```tsx
import demo from "./adaptive-demo.json";
export type HomeLanguage = "fr" | "ar";
const text = (fr: string, ar: string) => ({ fr, ar });
export const homeContent = {
    association: text("Association Chabab Connect", "جمعية شباب كونكت"),
    institution: text("Apprendre. Développer. Explorer. Agir.", "تعلّم. طوّر. استكشف. اترك أثرا."),
    navLabel: text("Navigation principale", "القائمة الرئيسية"),
    skip: text("Aller au contenu", "الانتقال إلى المحتوى"),
    start: text("Commencer le test", "بدء الاختبار"),
    howLink: text("Voir comment ça marche", "اكتشف كيف يعمل"),
    nav: [
        { href: "/#association", label: text("L’association", "الجمعية") },
        { href: "/#comment-ca-marche", label: text("Le parcours", "المسار") },
        { href: "/#competences", label: text("Les compétences", "المهارات") },
    ],
    hero: {
        title: text("Vos choix, votre voie.", "اختياراتك، طريقك."),
        intro: text("Explorez 31 soft skills à travers des situations qui s’adaptent à vos décisions. Repartez avec un rapport personnel pour avancer.", "استكشف 31 مهارة شخصية من خلال مواقف تتكيف مع قراراتك. واحصل على تقرير شخصي يساعدك على التقدم."),
        reassurance: [text("Gratuit", "مجاني"), text("Français & arabe", "بالفرنسية والعربية"), text("Sans carte bancaire", "بدون بطاقة بنكية")],
        preview: text("Aperçu du test de soft skills", "نظرة على اختبار المهارات الشخصية"),
        stage: text("Une situation, votre décision.", "موقف واحد، وقرارك أنت."),
        question: demo.question,
        example: text("Exemple de parcours", "مثال من المسار"),
        next: text("La suite dépend de votre choix", "الخطوة التالية تعتمد على اختيارك"),
        pause: text("Mettre en pause", "إيقاف الحركة"),
        play: text("Animer l’aperçu", "تشغيل الحركة"),
        imageAlt: text("Conséquence d’un choix dans SkillQuest", "نتيجة اختيار في مسار SkillQuest"),
    },
    stats: [
        { value: 31, label: text("compétences à explorer", "مهارة للاستكشاف") },
        { value: 2, label: text("langues, un même parcours", "لغتان، والمسار نفسه") },
        { value: 4, label: text("choix par situation", "اختيارات في كل موقف") },
        { value: 7, label: text("jours pour reprendre", "أيام لاستئناف المسار") },
    ],
    statsLabel: text("Le parcours en chiffres", "المسار بالأرقام"),
    about: {
        title: text("Apprendre à se connaître.", "لتعرف نفسك أكثر."),
        body: text("SkillQuest est une initiative de Chabab Connect. Une conviction la guide : les compétences se découvrent aussi dans la manière d’écouter, de coopérer et de prendre une décision.", "SkillQuest مبادرة من جمعية شباب كونكت، تقوم على قناعة بأن المهارات تُكتشف أيضا من خلال طريقة الإنصات والتعاون واتخاذ القرار."),
        mission: text("Mettre la réflexion en mouvement.", "لنحوّل التأمل إلى خطوات."),
        detail: text("Nous proposons un espace pédagogique pour explorer ses choix, mettre des mots sur ses réflexes et trouver une prochaine action à essayer. Avec un parcours accessible en français comme en arabe.", "نقترح فضاء تربويا لاستكشاف اختياراتك وفهم أساليب تصرفك وتحديد خطوة جديدة لتجربتها، من خلال مسار متاح بالفرنسية والعربية."),
        signature: text("Learn · Develop · Explore · Impact", "تعلّم · طوّر · استكشف · اترك أثرا"),
        visualAlt: text("Une compétence et ses conseils dans le rapport SkillQuest", "مهارة ونصائحها في تقرير SkillQuest"),
    },
    how: {
        title: text("Un choix ouvre la suite.", "اختيار يفتح الخطوة التالية."),
        intro: text("Un fil simple relie les situations. Vos réponses donnent du contexte ; le parcours couvre les 31 compétences une fois chacune.", "خيط واضح يربط المواقف. تمنح إجاباتك سياقا للخطوة التالية، ويغطي المسار المهارات الـ31 مرة واحدة لكل مهارة."),
        steps: [
            { title: text("Choisir", "اختر"), body: text("Sélectionnez l’action qui se rapproche de ce que vous feriez.", "حدّد التصرف الأقرب إلى ما ستفعله في هذا الموقف.") },
            { title: text("Voir la conséquence", "اكتشف النتيجة"), body: text("Découvrez ce que votre décision déclenche dans la simulation.", "اكتشف ما ينتج عن قرارك داخل المحاكاة.") },
            { title: text("Poursuivre", "تابع المسار"), body: text("Une nouvelle situation prolonge le contexte de votre réponse.", "موقف جديد يواصل السياق الذي صنعته إجابتك.") },
            { title: text("Recevoir son rapport", "احصل على تقريرك"), body: text("Retrouvez vos repères et des conseils après la 31e réponse.", "بعد الإجابة الـ31، اطّلع على مؤشراتك ونصائح عملية.") },
        ],
    },
    demo: {
        title: text("À vous de choisir.", "الاختيار لك."),
        intro: text("Essayez une situation réelle du parcours. Observez comment une autre réponse change la suite.", "جرّب موقفا فعليا من المسار، ولاحظ كيف يؤدي تغيير الإجابة إلى خطوة تالية مختلفة."),
        window: text("SkillQuest · Démonstration", "SkillQuest · تجربة توضيحية"),
        legend: text("Votre choix dans la simulation", "اختيارك في المحاكاة"),
        result: text("Ce que votre choix déclenche", "ما يحدث بعد اختيارك"),
        next: text("La situation suivante", "الموقف التالي"),
        hint: text("Choisissez une action pour découvrir la suite.", "اختر تصرفا لاكتشاف الخطوة التالية."),
        note: text("Cette démonstration n’est pas enregistrée dans votre rapport.", "هذه تجربة توضيحية؛ لا تُحفظ ولا تدخل في تقريرك."),
    },
    report: {
        title: text("Un bilan pour avancer.", "تقرير يساعدك على التقدم."),
        intro: text("Vos décisions prennent la forme d’un document personnel : des repères, leur contexte et une prochaine étape concrète.", "تتحول قراراتك إلى وثيقة شخصية تتضمن مؤشرات وسياقها وخطوة عملية تالية."),
        alt: text("Exemple de synthèse personnelle dans le rapport SkillQuest", "مثال لخلاصة شخصية في تقرير SkillQuest"),
        caption: text("Aperçu illustratif d’un rapport, sans données de participant réel.", "مثال توضيحي لتقرير، دون بيانات مشارك حقيقي."),
        benefits: [
            { title: text("Vos choix en contexte", "اختياراتك في سياقها"), body: text("Chaque indicateur est relié au scénario et à votre réponse.", "كل مؤشر مرتبط بالموقف وبإجابتك عنه.") },
            { title: text("Des actions à essayer", "خطوات لتجربتها"), body: text("Des conseils concrets à tester dans un prochain projet.", "نصائح عملية يمكنك اختبارها في مشروعك القادم.") },
            { title: text("Un document à garder", "وثيقة تحتفظ بها"), body: text("Un bilan immédiat, imprimable en PDF ; une synthèse IA peut l’enrichir ensuite.", "تقرير فوري قابل للطباعة بصيغة PDF، وقد تُضاف إليه خلاصة بالذكاء الاصطناعي لاحقا.") },
        ],
    },
    skills: {
        title: text("31 compétences. Quatre regards.", "31 مهارة. أربع زوايا."),
        intro: text("Choisissez une famille pour découvrir les compétences explorées. Ces regroupements facilitent la lecture du parcours.", "اختر مجموعة لاكتشاف المهارات التي يستكشفها المسار. تساعد هذه المجموعات على تنظيم القراءة."),
        tabs: text("Familles de compétences", "مجموعات المهارات"),
        count: text("compétences", "مهارات"),
        families: [
            { id: "communicate", label: text("Communiquer", "التواصل"), description: text("Écouter, exprimer une idée et comprendre l’autre.", "الإنصات والتعبير عن الأفكار وفهم الآخر."), ids: ["communication", "ecoute-active", "assertivite", "empathie", "negociation", "influence", "prise-parole"] },
            { id: "think", label: text("Réfléchir", "التفكير"), description: text("Prendre du recul, questionner et construire une réponse.", "التأمل والتساؤل وبناء استجابة مناسبة."), ids: ["intelligence-emotionnelle", "conscience-soi", "creativite", "esprit-critique", "resolution-problemes", "prise-decision", "apprentissage-continu", "curiosite"] },
            { id: "cooperate", label: text("Coopérer", "التعاون"), description: text("Créer des liens et avancer avec les autres.", "بناء الروابط والتقدم مع الآخرين."), ids: ["travail-equipe", "collaboration", "leadership", "gestion-conflits", "inclusion", "ethique"] },
            { id: "act", label: text("Agir", "المبادرة"), description: text("S’organiser, s’adapter et mener une action jusqu’au bout.", "التنظيم والتكيف ومتابعة العمل حتى إنجازه."), ids: ["gestion-stress", "resilience", "adaptabilite", "gestion-temps", "organisation", "planification", "autonomie", "initiative", "responsabilite", "fiabilite"] },
        ],
    },
    audience: {
        title: text("À chacun son point de départ.", "لكلّ نقطة انطلاقه."),
        items: [
            { title: text("Étudiants & jeunes adultes", "الطلبة والشباب البالغون"), body: text("Mieux comprendre ses choix et préparer ses prochains projets, études ou expériences professionnelles.", "فهم اختياراتك بشكل أفضل والاستعداد لمشاريعك ودراستك وتجاربك المهنية القادمة.") },
            { title: text("Enseignants & encadrants", "الأساتذة والمؤطرون"), body: text("Ouvrir une discussion pédagogique à partir de situations concrètes et d’un rapport contextualisé.", "فتح نقاش تربوي انطلاقا من مواقف ملموسة وتقرير يراعي سياق الإجابات.") },
            { title: text("Associations & structures", "الجمعيات والمؤسسات"), body: text("Intégrer un support de réflexion dans une démarche d’accompagnement. L’administration suit les participations autorisées.", "إدماج أداة للتأمل ضمن مسار المواكبة، مع متابعة المشاركات من طرف الإدارة المخولة.") },
        ],
    },
    trust: {
        title: text("Des repères, avec leurs limites.", "مؤشرات، بحدود واضحة."),
        intro: text("Le parcours sert à réfléchir et à apprendre. Il ne prétend pas résumer une personne.", "يهدف المسار إلى التأمل والتعلم، ولا يدّعي اختزال شخصيتك."),
        items: [
            { title: text("Aucun diagnostic", "دون تشخيص"), body: text("Une situation par compétence ne constitue pas un test psychométrique validé.", "موقف واحد لكل مهارة لا يشكل اختبارا نفسيا مقننا.") },
            { title: text("Aucun classement", "دون ترتيب"), body: text("Les indicateurs décrivent des choix, sans note scolaire ni hiérarchie entre participants.", "تصف المؤشرات الاختيارات دون نقطة مدرسية أو ترتيب بين المشاركين.") },
            { title: text("Un accès encadré", "وصول منظم"), body: text("Votre nom, e-mail, réponses et rapport sont consultables par l’administration autorisée pour le suivi pédagogique. Ils ne sont pas publiés.", "يمكن للإدارة المخولة الاطلاع على اسمك وبريدك وإجاباتك وتقريرك للمتابعة التربوية، ولا تُنشر هذه البيانات.") },
            { title: text("Des données maîtrisées", "بيانات بوصول محدود"), body: text("Vous pouvez supprimer votre parcours. Seuls des résultats et extraits sont envoyés à l’IA facultative, sans votre nom ni e-mail.", "يمكنك حذف مسارك. تُرسل نتائج ومقتطفات فقط إلى خدمة الذكاء الاصطناعي الاختيارية، دون اسمك أو بريدك.") },
        ],
        privacy: text("Comprendre l’utilisation de mes données", "فهم كيفية استخدام بياناتي"),
    },
    faq: {
        title: text("Avant de commencer.", "قبل أن تبدأ."),
        intro: text("Les réponses aux questions essentielles sur votre parcours.", "إجابات عن الأسئلة الأساسية حول مسارك."),
        items: [
            { question: text("Le test est-il gratuit ?", "هل الاختبار مجاني؟"), answer: text("Oui. Les questions et le bilan automatique sont accessibles sans carte bancaire. La synthèse IA facultative dépend de la disponibilité du fournisseur.", "نعم، الأسئلة والتقرير التلقائي متاحان دون بطاقة بنكية. الخلاصة الاختيارية بالذكاء الاصطناعي تعتمد على توفر خدمة المزود.") },
            { question: text("Comment les questions changent-elles ?", "كيف تتغير الأسئلة؟"), answer: text("Chaque choix a une conséquence dans la simulation et oriente la situation suivante. Le parcours aborde les 31 compétences, une fois chacune.", "كل اختيار له نتيجة في المحاكاة ويفتح موقفا تاليا مرتبطا به. يغطي المسار 31 مهارة، مرة واحدة لكل مهارة.") },
            { question: text("Puis-je faire une pause ?", "هل يمكنني التوقف؟"), answer: text("Vos choix sont sauvegardés. Revenez dans le même navigateur pendant sept jours pour reprendre votre parcours.", "تُحفظ الاختيارات تلقائيا. عد من المتصفح نفسه خلال سبعة أيام لاستئناف المسار.") },
            { question: text("Qui peut lire mon rapport ?", "من يمكنه قراءة تقريري؟"), answer: text("Vous pouvez le consulter depuis votre navigateur. L’administration autorisée y accède pour le suivi pédagogique. Il n’est pas publié sur le site.", "يمكنك قراءته من متصفحك، كما يمكن للإدارة المخولة الاطلاع عليه للمتابعة التربوية. لا يتم نشره في الموقع العام.") },
            { question: text("Que signifient les indicateurs ?", "ماذا تعني المؤشرات؟"), answer: text("Ils décrivent vos choix dans les situations proposées. Ce sont des repères pédagogiques, pas un diagnostic psychologique ni un classement.", "هي مؤشرات تربوية مرتبطة باختياراتك في مواقف محددة، وليست تشخيصا نفسيا أو ترتيبا للطلاب.") },
            { question: text("L’égogramme est-il disponible ?", "هل الإيغوغرام متاح؟"), answer: text("Pas encore. Le test disponible est celui des soft skills. L’égogramme sera développé ultérieurement.", "ليس بعد. الاختبار المتاح حاليا هو اختبار المهارات الشخصية. سيُطوّر الإيغوغرام لاحقا.") },
        ],
    },
    final: { title: text("Votre prochaine étape commence ici.", "خطوتك القادمة تبدأ هنا."), body: text("Un nom, un e-mail et vos choix. Prenez le temps de découvrir votre parcours.", "اسم وبريد إلكتروني واختياراتك أنت. خذ وقتك لاكتشاف مسارك.") },
    footer: { links: text("Liens utiles", "روابط مفيدة"), privacy: text("Confidentialité", "الخصوصية"), admin: text("Administration", "الإدارة"), description: text("Un outil pédagogique pour explorer ses compétences et trouver de nouvelles pistes d’action.", "أداة تربوية لاستكشاف المهارات واكتشاف خطوات جديدة للعمل."), note: text("Un outil pédagogique, sans classement des personnes.", "أداة تربوية، دون تصنيف الأشخاص.") },
};
export const homeDemo = demo;
```

## frontend/src/components/home/shared.tsx

```tsx
"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { homeContent } from "@/lib/home-content";
export function useHome() { const { lang } = useLanguage(); return { lang, c: homeContent, ar: lang === "ar" }; }
export function StartLink({ light = false }: {
    light?: boolean;
}) { const { c, lang } = useHome(); return <Link className={`hq-button ${light ? "hq-button-light" : ""}`} href="/entretien">{c.start[lang]}<ArrowUpRight size={20} aria-hidden="true"/></Link>; }
export function BrandArcs() { return <svg className="hq-arcs" viewBox="0 0 720 720" fill="none" aria-hidden="true"><circle cx="360" cy="360" r="310"/><circle cx="360" cy="360" r="242"/><ellipse cx="360" cy="360" rx="150" ry="310"/><path d="M50 360h620"/><circle className="hq-arc-point" cx="570" cy="132" r="12"/></svg>; }
```

## frontend/src/components/home/Hero.tsx

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, Pause, Play } from "lucide-react";
import { homeDemo } from "@/lib/home-content";
import { BrandArcs, StartLink, useHome } from "./shared";
export default function Hero() {
    const { c, lang } = useHome();
    const [paused, setPaused] = useState(false), [slide, setSlide] = useState(0), [visible, setVisible] = useState(true), [reduced, setReduced] = useState(true);
    const root = useRef<HTMLElement>(null);
    useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); update(); media.addEventListener("change", update); const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting)); if (root.current)
        obs.observe(root.current); return () => { media.removeEventListener("change", update); obs.disconnect(); }; }, []);
    useEffect(() => { if (paused || reduced || !visible)
        return; const id = setInterval(() => { if (document.visibilityState === "visible")
        setSlide(v => (v + 1) % 4); }, 3600); return () => clearInterval(id); }, [paused, reduced, visible]);
    return <section ref={root} className="hq-hero"><div className="hq-container hq-hero-grid"><div className="hq-hero-copy"><h1>{c.hero.title[lang]}</h1><p className="hq-lead">{c.hero.intro[lang]}</p><div className="hq-actions"><StartLink /><a className="hq-text-link" href="#comment-ca-marche">{c.howLink[lang]}</a></div><ul className="hq-reassurance">{c.hero.reassurance.map((s, i) => <li key={i}><Check size={15} aria-hidden="true"/>{s[lang]}</li>)}</ul></div><div className="hq-hero-visual"><BrandArcs /><div className="hq-app-window" data-ui aria-label={c.hero.preview[lang]}><div className="hq-window-bar"><span className="hq-window-dots" aria-hidden="true">● ● ●</span><span>{c.hero.example[lang]}</span><span>SkillQuest</span></div><div className="hq-mock-body"><div className="hq-progress" aria-hidden="true"><span /></div><p className="hq-kicker">{c.hero.stage[lang]}</p><p className="hq-mock-question">{c.hero.question[lang]}</p><div className="hq-mock-choices">{homeDemo.choices.map((s, i) => <div key={i} className={slide === i ? "is-active" : ""}><span className="hq-choice-mark" aria-hidden="true">{slide === i && <Check size={14}/>}</span>{s[lang]}</div>)}</div><p className="hq-mock-next">{c.hero.next[lang]}</p></div></div><figure className="hq-hero-receipt"><Image src={`/brand/previews/path-${lang}.png`} alt={c.hero.imageAlt[lang]} width={900} height={320} sizes="(max-width: 767px) 75vw, 320px" priority/></figure><button className="hq-motion" onClick={() => setPaused(v => !v)} aria-pressed={paused}>{paused ? <Play size={16} aria-hidden="true"/> : <Pause size={16} aria-hidden="true"/>}{(paused ? c.hero.play : c.hero.pause)[lang]}</button></div></div></section>; // taste-skill-ignore: this context label belongs to the data-ui test preview, not an eyebrow above a marketing heading.
}
```

## frontend/src/components/home/Stats.tsx

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useHome } from "./shared";
function Count({ value }: {
    value: number;
}) { const ref = useRef<HTMLSpanElement>(null); const [n, setN] = useState(value); useEffect(() => { if (matchMedia("(prefers-reduced-motion: reduce)").matches)
    return; let frame = 0; const obs = new IntersectionObserver(([e]) => { if (!e.isIntersecting)
    return; const start = performance.now(); const step = (now: number) => { const t = Math.min((now - start) / 900, 1); setN(Math.round(value * (1 - (1 - t) ** 3))); if (t < 1)
    frame = requestAnimationFrame(step); }; frame = requestAnimationFrame(step); obs.disconnect(); }); if (ref.current)
    obs.observe(ref.current); return () => { obs.disconnect(); cancelAnimationFrame(frame); }; }, [value]); return <span ref={ref}><span aria-hidden="true">{n}</span><span className="sr-only">{value}</span></span>; }
export default function Stats() { const { c, lang } = useHome(); return <section className="hq-stats" aria-label={c.statsLabel[lang]}><dl className="hq-container">{c.stats.map(s => <div key={s.value}><dt><Count value={s.value}/></dt><dd>{s.label[lang]}</dd></div>)}</dl></section>; }
```

## frontend/src/components/home/About.tsx

```tsx
"use client";
import Image from "next/image";
import { BrandArcs, useHome } from "./shared";
export default function About() { const { c, lang } = useHome(); return <section id="association" className="hq-about hq-section"><div className="hq-container hq-two-col"><div data-home-reveal><h2>{c.about.title[lang]}</h2><p className="hq-lead">{c.about.body[lang]}</p><h3>{c.about.mission[lang]}</h3><p>{c.about.detail[lang]}</p></div><figure className="hq-about-art" data-home-reveal><BrandArcs /><div className="hq-about-paper"><Image src={`/brand/previews/report-${lang}.png`} alt={c.about.visualAlt[lang]} width={900} height={550} sizes="(max-width: 767px) 85vw, 460px"/></div><figcaption>{c.about.signature[lang]}</figcaption></figure></div></section>; }
```

## frontend/src/components/home/HowItWorks.tsx

```tsx
"use client";
import { ArrowUpRight } from "lucide-react";
import { useHome } from "./shared";
export default function HowItWorks() { const { c, lang } = useHome(); return <section id="comment-ca-marche" className="hq-how hq-section"><div className="hq-container"><div className="hq-section-heading" data-home-reveal><h2>{c.how.title[lang]}</h2><p>{c.how.intro[lang]}</p></div><ol className="hq-journey">{c.how.steps.map((s, i) => <li key={i} data-home-reveal><span className="hq-journey-node" aria-hidden="true">{i === 3 ? <ArrowUpRight /> : i + 1}</span><h3>{s.title[lang]}</h3><p>{s.body[lang]}</p></li>)}</ol></div></section>; }
```

## frontend/src/components/home/Demo.tsx

```tsx
"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { homeDemo } from "@/lib/home-content";
import { useHome } from "./shared";
export default function Demo() { const { c, lang } = useHome(); const [selected, setSelected] = useState<number | null>(null); return <section className="hq-demo hq-section"><div className="hq-container"><div className="hq-section-heading"><h2>{c.demo.title[lang]}</h2><p>{c.demo.intro[lang]}</p></div><div className="hq-app-window" data-ui data-home-reveal><div className="hq-window-bar"><span className="hq-window-dots" aria-hidden="true">● ● ●</span><span>{c.demo.window[lang]}</span></div><div className="hq-demo-columns"><div><p className="hq-demo-question">{homeDemo.question[lang]}</p><fieldset><legend className="sr-only">{c.demo.legend[lang]}</legend>{homeDemo.choices.map((s, i) => <label key={i} className={`hq-demo-choice ${selected === i ? "is-selected" : ""}`}><input type="radio" name="demo-choice" checked={selected === i} onChange={() => setSelected(i)}/><span>{s[lang]}</span></label>)}</fieldset><p className="hq-small">{c.demo.note[lang]}</p></div><div className="sq-demo-result hq-demo-result" aria-live="polite" aria-atomic="true">{selected === null ? <p>{c.demo.hint[lang]}</p> : <div key={selected} className="hq-answer-enter"><p className="hq-context">{c.demo.result[lang]}</p><p>{homeDemo.choices[selected].reaction[lang]}</p><ArrowRight size={28} aria-hidden="true"/><p className="hq-context">{c.demo.next[lang]}</p><p className="hq-next-question">{homeDemo.choices[selected].next[lang]}</p></div>}</div></div></div></div></section>; }
```

## frontend/src/components/home/Report.tsx

```tsx
"use client";
import Image from "next/image";
import { ListChecks, Compass, FileDown } from "lucide-react";
import { useHome } from "./shared";
const icons = [ListChecks, Compass, FileDown];
export default function Report() { const { c, lang } = useHome(); return <section className="hq-report hq-section"><div className="hq-container hq-two-col"><figure className="hq-report-visual" data-home-reveal><Image src={`/brand/previews/summary-${lang}.png`} alt={c.report.alt[lang]} width={900} height={550} sizes="(max-width: 767px) 85vw, 560px"/><figcaption>{c.report.caption[lang]}</figcaption></figure><div data-home-reveal><h2>{c.report.title[lang]}</h2><p className="hq-lead">{c.report.intro[lang]}</p><dl className="hq-benefits">{c.report.benefits.map((s, i) => { const Icon = icons[i]; return <div key={i}><Icon size={24} strokeWidth={1.6} aria-hidden="true"/><div><dt>{s.title[lang]}</dt><dd>{s.body[lang]}</dd></div></div>; })}</dl></div></div></section>; }
```

## frontend/src/components/home/Skills.tsx

```tsx
"use client";
import { useRef, useState } from "react";
import { homeDemo } from "@/lib/home-content";
import { useHome } from "./shared";
export default function Skills() { const { c, lang, ar } = useHome(); const [active, setActive] = useState(0); const refs = useRef<(HTMLButtonElement | null)[]>([]); return <section id="competences" className="hq-skills hq-section"><div className="hq-container"><div className="hq-section-heading"><h2>{c.skills.title[lang]}</h2><p>{c.skills.intro[lang]}</p></div><div className="hq-tabs" role="tablist" aria-label={c.skills.tabs[lang]}>{c.skills.families.map((f, i) => <button ref={el => { refs.current[i] = el; }} key={f.id} role="tab" id={`tab-${f.id}`} aria-controls={`panel-${f.id}`} aria-selected={active === i} tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={e => { let n = active; if (e.key === "Home")
    n = 0;
else if (e.key === "End")
    n = 3;
else if (e.key === "ArrowRight")
    n = (active + (ar ? 3 : 1)) % 4;
else if (e.key === "ArrowLeft")
    n = (active + (ar ? 1 : 3)) % 4;
else
    return; e.preventDefault(); setActive(n); refs.current[n]?.focus(); }}>{f.label[lang]}<span>{f.ids.length}</span></button>)}</div>{c.skills.families.map((f, i) => <div key={f.id} className={`hq-skill-panel hq-family-${i}`} id={`panel-${f.id}`} role="tabpanel" aria-labelledby={`tab-${f.id}`} hidden={active !== i} tabIndex={0}><div><h3>{f.description[lang]}</h3><p>{f.ids.length} {c.skills.count[lang]}</p></div><ul>{f.ids.map(id => <li key={id}>{homeDemo.skills.find(s => s.id === id)?.[lang]}</li>)}</ul></div>)}</div></section>; }
```

## frontend/src/components/home/Audience.tsx

```tsx
"use client";
import { useHome } from "./shared";
export default function Audience() { const { c, lang } = useHome(); return <section className="hq-audience hq-section"><div className="hq-container"><h2>{c.audience.title[lang]}</h2><div className="hq-audience-grid">{c.audience.items.map((s, i) => <article key={i} className={`hq-audience-${i}`} data-home-reveal><h3>{s.title[lang]}</h3><p>{s.body[lang]}</p></article>)}</div></div></section>; }
```

## frontend/src/components/home/Trust.tsx

```tsx
"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useHome } from "./shared";
export default function Trust() { const { c, lang } = useHome(); return <section className="hq-trust hq-section"><div className="hq-container hq-two-col"><div><h2>{c.trust.title[lang]}</h2><p className="hq-lead">{c.trust.intro[lang]}</p><Link className="hq-text-link" href="/confidentialite">{c.trust.privacy[lang]}<ArrowUpRight size={20} aria-hidden="true"/></Link></div><dl className="hq-trust-list">{c.trust.items.map((s, i) => <div key={i}><dt>{s.title[lang]}</dt><dd>{s.body[lang]}</dd></div>)}</dl></div></section>; }
```

## frontend/src/components/home/Faq.tsx

```tsx
"use client";
import { Plus } from "lucide-react";
import { useHome } from "./shared";
export default function Faq() { const { c, lang } = useHome(); return <section className="hq-faq hq-section"><div className="hq-container hq-two-col"><div><h2>{c.faq.title[lang]}</h2><p className="hq-lead">{c.faq.intro[lang]}</p></div><div>{c.faq.items.map((s, i) => <details key={i}><summary>{s.question[lang]}<Plus size={20} aria-hidden="true"/></summary><p>{s.answer[lang]}</p></details>)}</div></div></section>; }
```

## frontend/src/components/home/FinalCta.tsx

```tsx
"use client";
import { BrandArcs, StartLink, useHome } from "./shared";
export default function FinalCta() { const { c, lang } = useHome(); return <section className="hq-final"><BrandArcs /><div className="hq-container"><h2>{c.final.title[lang]}</h2><p>{c.final.body[lang]}</p><StartLink light/></div></section>; }
```

## frontend/src/app/page.tsx

```tsx
"use client";
import { useEffect } from "react";
import Hero from "@/components/home/Hero";
import Stats from "@/components/home/Stats";
import About from "@/components/home/About";
import HowItWorks from "@/components/home/HowItWorks";
import Demo from "@/components/home/Demo";
import Report from "@/components/home/Report";
import Skills from "@/components/home/Skills";
import Audience from "@/components/home/Audience";
import Trust from "@/components/home/Trust";
import Faq from "@/components/home/Faq";
import FinalCta from "@/components/home/FinalCta";
export default function Home() { useEffect(() => { const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) {
    e.target.classList.add("hq-revealed");
    observer.unobserve(e.target);
} }), { threshold: .08 }); document.querySelectorAll("[data-home-reveal]").forEach(el => observer.observe(el)); return () => observer.disconnect(); }, []); return <div className="hq-home" data-brand-home><Hero /><Stats /><About /><HowItWorks /><Demo /><Report /><Skills /><Audience /><Trust /><Faq /><FinalCta /></div>; }
```

## frontend/src/app/home.css

```css
/* All page styles scoped to homepage or public chrome. Assessment/print styles stay independent. */
.hq-home,.hq-site-header,.hq-site-footer{color:var(--hq-ink);font-family:'Plus Jakarta Sans',sans-serif;line-height:1.7}

.hq-home{background:var(--hq-paper);overflow:clip}

.hq-container{width:min(1280px,calc(100% - 96px));margin-inline:auto}

.hq-home h1,.hq-home h2,.hq-home h3,.hq-stats dt,.hq-footer-wordmark{font-family:'Outfit','Plus Jakarta Sans',sans-serif}

.hq-home h1{font-size:var(--hq-display);font-weight:600;line-height:1.02;letter-spacing:-.055em;max-width:8ch;color:var(--hq-blue-800);margin-block:24px 32px;text-wrap:balance}

.hq-home h2{font-size:var(--hq-title);font-weight:500;line-height:1.12;letter-spacing:-.035em;margin:0 0 24px;text-wrap:balance}

.hq-home h3{font-size:clamp(1.3rem,2vw,1.75rem);line-height:1.3;font-weight:500;margin-block:24px 16px;letter-spacing:-.02em}

.hq-home p{margin-block:0 24px}
.hq-home figure{margin:0}
.hq-home ul,.hq-home ol{list-style:none;padding:0}
.hq-home dd{margin:0}

.hq-home img{max-width:100%;height:auto}
.hq-lead{font-size:clamp(1rem,1.35vw,1.18rem);line-height:1.8;color:var(--hq-muted);max-width:55ch}

.hq-kicker{font-size:.75rem;font-weight:700;letter-spacing:.05em;color:var(--hq-green-800)}

.hq-section{padding-block:clamp(72px,8vw,128px);scroll-margin-top:160px}

.hq-two-col{display:grid;grid-template-columns:1fr 1fr;gap:clamp(48px,7vw,112px);align-items:center}

.hq-section-heading{display:grid;grid-template-columns:1.1fr 1fr;gap:80px;align-items:end;margin-block-end:56px}
.hq-section-heading p{max-width:48ch;color:var(--hq-muted)}

.hq-button{display:inline-flex;align-items:center;justify-content:center;gap:20px;min-height:56px;padding:16px 24px;border-radius:var(--hq-radius-sm);background:var(--hq-green-700);color:#fff;font-size:.875rem;font-weight:700;text-decoration:none;transition:background .24s,transform .24s,box-shadow .24s;white-space:normal;text-align:center}

.hq-button:hover{background:var(--hq-green-800);box-shadow:0 6px 16px #146b2720;transform:translateY(-2px)} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */
.hq-button:active{transform:translateY(0)}
.hq-button:disabled{opacity:.5;cursor:not-allowed}
.hq-button-light{background:var(--hq-paper);color:var(--hq-blue-800)}
.hq-button-light:hover{background:var(--hq-green-100)}

.hq-home :focus-visible,.hq-site-header :focus-visible,.hq-site-footer :focus-visible{outline:3px solid #548eaf;outline-offset:5px}

.hq-text-link{min-height:44px;display:inline-flex;align-items:center;gap:8px;font-size:.875rem;font-weight:600;text-decoration:underline;text-underline-offset:6px;color:inherit}

.hq-actions{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:center}

.hq-hero{padding-block:72px 112px;background:var(--hq-paper)}
.hq-hero-grid{display:grid;grid-template-columns:1fr 1.06fr;align-items:center;gap:56px}

.hq-reassurance{display:flex;gap:8px;flex-wrap:wrap;margin-block:32px 0}
.hq-reassurance li{display:flex;align-items:center;gap:6px;background:var(--hq-green-50);border:1px solid var(--hq-green-200);padding:6px 10px;border-radius:24px;font-size:.7rem;font-weight:600;color:var(--hq-green-900)}

.hq-hero-visual{position:relative;padding:32px 0 80px;isolation:isolate}
.hq-arcs{position:absolute;z-index:-1;pointer-events:none;width:125%;height:125%;inset-block-start:-10%;inset-inline-start:-12%;stroke:var(--hq-green-300);stroke-width:1.2}
.hq-arc-point{fill:var(--hq-green-700);stroke:none}

.hq-app-window{background:#fff;border:1px solid var(--hq-line);border-radius:var(--hq-radius-md);box-shadow:var(--hq-shadow);overflow:hidden;position:relative} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */

.hq-window-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:var(--hq-blue-50);font-size:.65rem;color:var(--hq-blue-700);font-weight:600;border-block-end:1px solid var(--hq-line)}
.hq-window-dots{letter-spacing:3px;color:var(--hq-blue-300);white-space:nowrap}

.hq-mock-body{padding:24px 32px 48px}
.hq-progress{height:4px;background:var(--hq-blue-50);margin-block-end:24px;border-radius:4px;overflow:hidden}
.hq-progress span{display:block;width:28%;height:100%;background:var(--hq-green-700)}

.hq-mock-question{font-weight:700;font-size:1rem;line-height:1.5}
.hq-mock-choices{display:grid;gap:8px}
.hq-mock-choices>div{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--hq-line);border-radius:8px;font-size:.7rem;line-height:1.5;transition:background .25s,border-color .25s}
.hq-mock-choices .is-active{border-color:var(--hq-green-600);background:var(--hq-green-50)}
.hq-choice-mark{width:18px;height:18px;border:1px solid var(--hq-green-600);border-radius:50%;flex-shrink:0;display:grid;place-items:center;color:var(--hq-green-700)}
.hq-home .hq-mock-next{font-size:.65rem;color:var(--hq-green-800);margin-block:16px 0}

.hq-hero-receipt{position:absolute;inset-inline-end:-24px;inset-block-end:16px;width:64%;background:#fff;padding:8px;border-radius:8px;box-shadow:var(--hq-shadow);transform:rotate(-3deg);border:1px solid var(--hq-green-200)} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */
.hq-motion{position:absolute;inset-inline-start:0;inset-block-end:0;min-height:44px;display:flex;gap:8px;align-items:center;font-size:.75rem;padding:8px 0;color:var(--hq-muted)}

.hq-stats{background:var(--hq-blue-800);color:#fff;padding-block:40px}
.hq-stats dl{display:grid;grid-template-columns:repeat(4,1fr);gap:32px}
.hq-stats dt{font-size:clamp(2.5rem,4vw,4rem);line-height:1.2;font-weight:500;font-variant-numeric:tabular-nums}
.hq-stats dd{font-size:.8rem;color:var(--hq-blue-100);margin-block-start:8px}

.hq-about{background:#fff}
.hq-about-art{position:relative;isolation:isolate;padding:56px 24px 24px;background:var(--hq-green-50);border-radius:50% 50% 12px 12px}
.hq-about-art .hq-arcs{inset:0;width:100%;height:100%}
.hq-about-paper{transform:rotate(3deg);background:#fff;box-shadow:var(--hq-shadow);padding:8px;border-radius:8px} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */
.hq-about figcaption{font-size:.7rem;text-align:center;color:var(--hq-green-800);padding-block-start:24px}

.hq-how{background:var(--hq-blue-50)}
.hq-journey{display:grid;grid-template-columns:repeat(4,1fr);gap:32px;position:relative;margin:0}
.hq-journey:before{content:'';position:absolute;inset-inline:0;top:24px;height:1px;background:var(--hq-blue-300)} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */
.hq-journey li{position:relative}
.hq-journey-node{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--hq-blue-800);color:#fff;border:8px solid var(--hq-blue-50);box-sizing:content-box;margin-top:-8px;font-size:.8rem}
.hq-journey li:nth-child(2){padding-block-start:32px}
.hq-journey li:nth-child(3){padding-block-start:64px}
.hq-journey li:nth-child(4){padding-block-start:96px}
.hq-journey li:last-child .hq-journey-node{background:var(--hq-green-700)}
.hq-journey p{font-size:.9rem;color:var(--hq-muted)}

.hq-demo{background:var(--hq-green-100)}
.hq-demo-columns{display:grid;grid-template-columns:1.15fr 1fr}
.hq-demo-columns>div{padding:40px}
.hq-demo-question{font-weight:700;font-size:1.1rem;line-height:1.6}
.hq-demo-choice{display:flex;align-items:flex-start;gap:16px;padding:16px;margin-block:8px;border:1px solid var(--hq-line);border-radius:8px;cursor:pointer;font-size:.875rem;transition:background .24s,border-color .24s;min-height:48px}
.hq-demo-choice:hover{background:var(--hq-green-50)}
.hq-demo-choice.is-selected{background:var(--hq-green-50);border-color:var(--hq-green-700)}
.hq-demo-choice input{accent-color:var(--hq-green-700);margin-top:5px;flex-shrink:0;width:18px;height:18px}
.hq-home .hq-small{font-size:.75rem;color:var(--hq-muted);margin-block:24px 0}
.hq-demo-result.sq-demo-result{background:var(--hq-blue-800);color:#fff;display:flex;align-items:center;border:0;margin:0;min-height:340px}
.hq-demo-result .hq-kicker{color:var(--hq-green-200);margin-block:24px 12px}
.hq-next-question{font-weight:600}
.hq-answer-enter{animation:hq-enter .25s ease-out}
.hq-demo-result svg{color:var(--hq-green-300)}

.hq-report{background:var(--hq-paper)}
.hq-report-visual{position:relative;padding:40px 0 0 32px;isolation:isolate}
.hq-report-visual:before{content:'';position:absolute;inset:0 48px 48px 0;background:var(--hq-blue-100);border-radius:8px;z-index:-1}
.hq-report-visual img{box-shadow:var(--hq-shadow);border:1px solid var(--hq-line);border-radius:12px;background:#fff;transform:rotate(-2deg)} /* taste-skill-ignore: explicit brief requests layered shadows and a connected journey line. */
.hq-report figcaption{font-size:.7rem;color:var(--hq-muted);padding:24px 16px}
.hq-benefits{display:grid;gap:24px}
.hq-benefits>div{display:flex;align-items:flex-start;gap:16px}
.hq-benefits svg{color:var(--hq-green-700);flex-shrink:0;margin-block-start:4px}
.hq-benefits dt,.hq-trust-list dt{font-weight:700;margin-block-end:8px}
.hq-benefits dd{font-size:.875rem;color:var(--hq-muted)}

.hq-skills{background:var(--hq-blue-900);color:#fff}
.hq-skills .hq-section-heading p{color:var(--hq-blue-100)}
.hq-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-block-end:24px}
.hq-tabs button{display:flex;gap:16px;justify-content:space-between;align-items:center;min-height:60px;padding:16px 24px;color:var(--hq-blue-100);border:1px solid var(--hq-blue-400);border-radius:8px;font-size:.95rem;transition:background .24s,color .24s}
.hq-tabs button:hover{background:var(--hq-blue-700)}
.hq-tabs button[aria-selected=true]{background:var(--hq-green-100);color:var(--hq-green-900);border-color:var(--hq-green-100)}
.hq-tabs button span{font-variant-numeric:tabular-nums;font-size:.75rem}
.hq-skill-panel{display:grid;grid-template-columns:1fr 1.6fr;gap:48px;padding:40px;border-radius:16px;background:var(--hq-blue-50);color:var(--hq-blue-900);min-height:260px}
.hq-skill-panel[hidden]{display:none}
.hq-skill-panel h3{margin-block:0 16px;max-width:24ch}
.hq-skill-panel p{font-size:.8rem}
.hq-skill-panel ul{display:flex;flex-wrap:wrap;align-content:center;gap:12px;margin:0}
.hq-skill-panel li{padding:8px 16px;border-radius:24px;border:1px solid var(--hq-blue-300);font-size:.8rem}
.hq-family-1{background:var(--hq-green-50)}
.hq-family-2{background:var(--hq-blue-100)}
.hq-family-3{background:var(--hq-green-100)}

.hq-audience{background:#fff}
.hq-audience h2{max-width:17ch}
.hq-audience-grid{display:grid;grid-template-columns:1.2fr 1fr .9fr;gap:32px;align-items:start;margin-block-start:48px}
.hq-audience-grid article{padding:40px 32px}
.hq-audience-grid h3{margin-block:0 24px}
.hq-audience-grid p{font-size:.9rem;margin:0}
.hq-audience-0{background:var(--hq-blue-800);color:#fff;border-radius:16px 80px 16px 16px}
.hq-audience-1{background:var(--hq-green-100);border-radius:16px;margin-block-start:48px}
.hq-audience-grid .hq-audience-2{border-inline-start:2px solid var(--hq-green-700);padding-block:8px;margin-block-start:96px}

.hq-trust{background:var(--hq-blue-50)}
.hq-trust-list{display:grid;gap:24px}
.hq-trust-list>div{padding-block-end:24px;border-block-end:1px solid var(--hq-line)}
.hq-trust-list dd{font-size:.875rem;color:var(--hq-muted)}

.hq-faq{background:var(--hq-paper)}
.hq-faq .hq-two-col{align-items:start}
.hq-faq details{border-block-end:1px solid var(--hq-line)}
.hq-faq summary{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:24px;min-height:72px;padding-block:16px;font-weight:600;cursor:pointer;font-size:.9rem}
.hq-faq summary::-webkit-details-marker{display:none}
.hq-faq summary svg{flex-shrink:0;transition:transform .25s}
.hq-faq details[open] summary svg{transform:rotate(45deg)}
.hq-faq details p{font-size:.875rem;color:var(--hq-muted);padding-inline-end:32px}

.hq-final{background:var(--hq-green-900);color:#fff;padding-block:96px;position:relative;isolation:isolate;overflow:hidden}
.hq-final .hq-container{position:relative}
.hq-final .hq-arcs{width:720px;height:720px;inset-inline-start:55%;inset-block-start:-150px;opacity:.45}
.hq-final h2{max-width:16ch}
.hq-final p{max-width:50ch;color:var(--hq-green-100);margin-block-end:32px}

.hq-site-header{position:sticky;top:0;z-index:40;background:var(--hq-paper);border-block-end:1px solid var(--hq-line)}
.hq-institution{background:var(--hq-blue-800);color:var(--hq-blue-100);font-size:.65rem;padding-block:8px}
.hq-institution .hq-container{display:flex;justify-content:space-between;gap:16px}
.hq-header-inner{display:flex;align-items:center;gap:24px;min-height:96px}
.hq-header-inner .brand-logo{width:160px}
.hq-header-inner nav{display:flex;gap:24px;margin-inline:auto;align-items:center}
.hq-header-inner nav a{min-height:44px;display:flex;align-items:center;font-size:.75rem;font-weight:600}
.hq-header-inner .hq-button{min-height:48px;font-size:.75rem;padding:12px 16px}
.hq-menu-button{display:none}
.hq-site-footer{background:#fff;padding-block:56px 24px}
.hq-footer-top{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}
.hq-footer-top .brand-logo{width:180px}
.hq-footer-top p{max-width:40ch;font-size:.85rem;color:var(--hq-muted);margin-block-start:24px}
.hq-footer-top nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:16px 32px}
.hq-footer-top nav a{min-height:44px;display:flex;align-items:center;font-size:.8rem}
.hq-footer-wordmark{font-size:clamp(4.5rem,16vw,15rem);line-height:1.2;letter-spacing:-.06em;color:var(--hq-blue-800);margin-block:32px;overflow:hidden}
.hq-footer-bottom{display:flex;justify-content:space-between;gap:24px;font-size:.7rem;color:var(--hq-muted);border-block-start:1px solid var(--hq-line);padding-block-start:24px}

[data-home-reveal].hq-revealed{animation:hq-enter .5s ease-out both}
@keyframes hq-enter{from{opacity:.65;transform:translateY(12px)}
to{opacity:1;transform:translateY(0)}
}

[dir=rtl] .hq-home,[dir=rtl] .hq-site-header,[dir=rtl] .hq-site-footer{font-family:'Tajawal',sans-serif}
[dir=rtl] .hq-home h1,[dir=rtl] .hq-home h2,[dir=rtl] .hq-home h3{font-family:'Tajawal',sans-serif;letter-spacing:0;line-height:1.35}
[dir=rtl] .hq-home h1{max-width:10ch}
[dir=rtl] .hq-button svg,[dir=rtl] .hq-text-link svg,[dir=rtl] .hq-demo-result svg{transform:scaleX(-1)}

@media(max-width:1100px){.hq-container{width:calc(100% - 64px)}
.hq-header-inner{gap:16px}
.hq-header-inner nav{gap:16px}
.hq-header-inner .brand-logo{width:130px}
.hq-hero-grid{gap:32px}
.hq-mock-body{padding:24px}
.hq-hero-receipt{inset-inline-end:-8px}
.hq-two-col{gap:48px}
.hq-audience-grid{gap:16px}
.hq-audience-grid article{padding:32px 24px}
.hq-tabs button{padding:16px}
}

@media(max-width:900px){.hq-header-inner{flex-wrap:wrap;padding-block:16px;min-height:88px}
.hq-header-inner nav{order:4;width:100%;justify-content:center}
.hq-header-inner>.sq-language{margin-inline-start:auto}
.hq-header-inner>.hq-button{margin-inline-start:0}
.hq-section-heading{gap:32px}
.hq-hero-grid{grid-template-columns:1fr 1fr;gap:24px}
.hq-home h1{font-size:clamp(3rem,7.1vw,5rem)}
.hq-reassurance{gap:6px}
.hq-hero-receipt{width:76%}
.hq-mock-body{padding:20px 16px 40px}
.hq-mock-choices>div{font-size:.65rem}
.hq-demo-columns>div{padding:24px}
.hq-skill-panel{gap:32px}
.hq-audience-grid{grid-template-columns:1fr 1fr}
.hq-audience-grid .hq-audience-2{grid-column:1/-1;margin-block-start:16px;max-width:72ch}
}

@media(max-width:767px){.hq-container{width:calc(100% - 40px)}
.hq-institution .hq-container span:last-child{display:none}
.hq-header-inner{gap:12px}
.hq-header-inner .brand-logo{width:120px}
.hq-header-inner>.hq-button{min-height:44px;padding:10px 12px;font-size:.7rem}
.hq-header-inner>.hq-button svg{display:none}
.hq-header-inner nav{gap:24px;padding-block-start:0}
.hq-header-inner nav a{font-size:.7rem;min-height:32px}
.hq-header-inner .sq-language{margin-inline-start:auto}
.hq-hero{padding-block:40px 64px}
.hq-hero-grid{grid-template-columns:1fr;gap:24px}
.hq-home h1{font-size:clamp(3.6rem,14vw,5.8rem);max-width:8ch}
.hq-hero-copy .hq-kicker{margin-block-end:16px}
.hq-hero-copy .hq-lead{max-width:40ch}
.hq-hero-visual{max-width:560px;width:100%;margin-inline:auto;padding-block:32px 96px}
.hq-mock-body{padding:24px 24px 48px}
.hq-mock-choices>div{font-size:.75rem}
.hq-hero-receipt{inset-inline-end:0;width:70%;inset-block-end:40px}
.hq-mock-question{font-size:1rem}
.hq-home h2{font-size:2.5rem}
.hq-stats{padding-block:32px}
.hq-stats dl{grid-template-columns:1fr 1fr;gap:32px 24px}
.hq-stats dd{font-size:.75rem}
.hq-two-col,.hq-section-heading{grid-template-columns:1fr;gap:32px}
.hq-section-heading{margin-block-end:32px}
.hq-home .hq-section-heading p{margin:0}
.hq-about-art{margin-block-start:24px!important}
.hq-journey{grid-template-columns:1fr;gap:24px}
.hq-journey:before{inset-inline-start:23px;inset-inline-end:auto;width:1px;height:calc(100% - 40px)}
.hq-journey li,.hq-journey li:nth-child(n){padding-block-start:0;padding-inline-start:80px}
.hq-journey-node{position:absolute;inset-inline-start:-8px;top:0}
.hq-journey h3{margin-block:0 12px}
.hq-journey p{margin:0}
.hq-demo-columns{grid-template-columns:1fr}
.hq-demo-columns>div{padding:24px}
.hq-demo-result.sq-demo-result{min-height:240px}
.hq-report-visual{padding-inline-start:16px}
.hq-report .hq-two-col>div{order:-1}
.hq-tabs{grid-template-columns:1fr 1fr;gap:12px}
.hq-tabs button{font-size:.85rem;min-height:56px}
.hq-skill-panel{grid-template-columns:1fr;padding:24px;gap:16px;min-height:360px}
.hq-skill-panel ul{gap:8px}
.hq-skill-panel li{font-size:.75rem;padding:8px 12px}
.hq-skill-panel h3{font-size:1.5rem;max-width:none}
.hq-audience-grid{grid-template-columns:1fr;gap:24px}
.hq-audience-1{margin-block-start:0}
.hq-audience-grid .hq-audience-2{grid-column:auto;margin:0}
.hq-audience-grid article{padding:32px}
.hq-final{padding-block:64px}
.hq-final .hq-arcs{inset-inline-start:20%;opacity:.2}
.hq-footer-top{grid-template-columns:1fr;gap:24px}
.hq-footer-top nav{justify-content:flex-start;gap:8px 24px}
.hq-footer-bottom{flex-direction:column;gap:8px}
.hq-footer-wordmark{font-size:17vw}
.hq-section{scroll-margin-top:180px}
}

@media(max-width:420px){.hq-header-inner{column-gap:8px}
.hq-header-inner>.hq-button{width:100%;order:3}
.hq-header-inner nav{gap:20px;order:4}
.hq-hero .hq-actions{align-items:stretch;flex-direction:column;gap:8px}
.hq-hero .hq-text-link{justify-content:center}
.hq-home h1{font-size:3.5rem}
.hq-reassurance li{font-size:.65rem}
.hq-window-bar{padding:12px 16px}
.hq-window-bar>span:last-child:nth-child(3){display:none}
.hq-mock-body{padding:20px 16px 40px}
}

@media(prefers-reduced-motion:reduce){.hq-home *,.hq-site-header *,.hq-site-footer *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}

.hq-header-inner nav a{min-height:44px}

/* Review fixes: readable secondary text, compact sticky navigation, tinted neutral. */
:root{--hq-paper:#f7faf9}

.hq-home{font-size:16px}

.hq-home .hq-lead{font-size:18px}

.hq-home .hq-kicker,.hq-small,.hq-home figcaption,.hq-motion,.hq-window-bar,.hq-home .hq-mock-next,.hq-reassurance li,.hq-stats dd,.hq-footer-bottom,.hq-institution,.hq-header-inner nav a,.hq-header-inner .hq-button,.hq-text-link,.hq-skill-panel li,.hq-skill-panel p,.hq-tabs button span{font-size:13px}

.hq-mock-choices>div{font-size:13px}

.hq-demo-choice,.hq-benefits dd,.hq-trust-list dd,.hq-faq details p,.hq-audience-grid p,.hq-journey p,.hq-footer-top p{font-size:16px}

.hq-window-dots{color:var(--hq-blue-600)}

.hq-hero-copy>.hq-kicker,.hq-about .hq-two-col>div>.hq-kicker{display:none}

@media(max-width:767px){.hq-header-inner{gap:8px;padding-block:8px}
.hq-header-inner .brand-logo{width:96px}
.hq-header-inner>.hq-button{width:auto;order:0;margin-inline-start:0;padding:8px 12px;font-size:13px;flex:1;max-width:140px;line-height:1.4}
.hq-header-inner>.sq-language{margin-inline-start:auto}
.hq-header-inner nav{gap:20px;order:4}
.hq-header-inner nav a{font-size:13px;min-height:44px}
.hq-hero-copy .hq-lead{font-size:18px}
.hq-hero{padding-block-start:24px}
.hq-home h1{margin-block-start:16px}
.hq-reassurance li{font-size:13px}
.hq-mock-choices>div{font-size:13px}
}

.hq-context{font-size:13px;font-weight:700;color:var(--hq-green-200);margin-block:24px 12px!important}
.hq-home .hq-small{font-size:13px}

/* Keep the opening composition usable at 100% on laptop/HiDPI viewports.
   Layout adapts to available CSS pixels; browser zoom and text size stay native. */
@media screen {
  .hq-institution{padding-block:4px;line-height:1.5;font-size:12px}
  .hq-header-inner{min-height:76px}
  .hq-header-inner .brand-logo{width:128px}
  .hq-hero{padding-block:clamp(24px,4vh,48px) clamp(40px,6vh,72px)}
  .hq-hero-grid{grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);gap:40px}
  .hq-hero-copy,.hq-hero-visual{min-width:0}
  .hq-hero h1{font-size:clamp(3.25rem,5.5vw,5.5rem);margin-block:0 24px}
  .hq-hero .hq-lead{margin-block-end:24px}
  .hq-hero-visual{padding-block:12px 64px}
  .hq-hero .hq-window-bar{padding:12px 20px}
  .hq-hero .hq-mock-body{padding:20px 24px 32px}
  .hq-hero .hq-progress{margin-block-end:16px}
  .hq-hero .hq-kicker{margin-block-end:12px}
  .hq-hero .hq-mock-question{margin-block-end:16px}
  .hq-hero .hq-mock-choices>div{padding:10px;line-height:1.5}
  .hq-hero .hq-reassurance{margin-block-start:24px}
}

@media screen and (min-width:1024px) and (max-height:720px) {
  .hq-institution{font-size:11px;padding-block:3px}
  .hq-header-inner{min-height:64px}
  .hq-header-inner .brand-logo{width:108px}
  .hq-header-inner .hq-button{min-height:44px;padding-block:10px}
  .hq-hero{padding-block:16px 24px}
  .hq-hero-grid{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:32px}
  .hq-hero h1{font-size:clamp(3rem,5vw,4rem);margin-block-end:16px}
  .hq-hero .hq-lead{font-size:16px;line-height:1.65;margin-block-end:16px}
  .hq-hero .hq-actions{gap:8px 20px}
  .hq-hero .hq-button{min-height:48px;padding:12px 20px}
  .hq-hero .hq-reassurance{margin-block-start:16px}
  .hq-hero-visual{padding-block:0 44px}
  .hq-hero .hq-window-bar{padding:8px 16px;font-size:12px}
  .hq-hero .hq-mock-body{padding:16px}
  .hq-hero .hq-progress{margin-block-end:10px}
  .hq-hero .hq-kicker{margin-block-end:8px;line-height:1.4}
  .hq-hero .hq-mock-question{font-size:14px;line-height:1.45;margin-block-end:12px}
  .hq-hero .hq-mock-choices{gap:6px}
  .hq-hero .hq-mock-choices>div{padding:8px;gap:8px;line-height:1.4}
  .hq-hero .hq-mock-next{margin-block-start:10px;line-height:1.4}
  .hq-hero-receipt{display:none}
  .hq-hero .hq-arcs{width:110%;height:110%;inset-inline-start:-5%;inset-block-start:-5%}
}

@media screen and (min-width:768px) and (max-width:1023px) {
  .hq-header-inner{flex-wrap:wrap;padding-block:8px;gap:12px}
  .hq-header-inner nav{order:4;width:100%;justify-content:center}
  .hq-header-inner>.sq-language{margin-inline-start:auto}
  .hq-hero-grid{grid-template-columns:minmax(0,1fr);gap:32px}
  .hq-hero-copy{max-width:720px}
  .hq-hero h1{max-width:12ch;font-size:clamp(3.25rem,6vw,4.5rem)}
  .hq-hero .hq-lead{max-width:60ch}
  .hq-hero-visual{width:min(100%,640px);margin-inline:auto}
}

@media screen and (max-width:767px) {
  .hq-header-inner{min-height:64px}
  .hq-header-inner .brand-logo{width:96px}
  .hq-hero{padding-block:24px 48px}
  .hq-hero-grid{grid-template-columns:minmax(0,1fr);gap:24px}
  .hq-hero h1{font-size:clamp(3rem,13vw,3.75rem);margin-block:8px 24px}
  .hq-hero .hq-lead{font-size:17px;line-height:1.75}
  .hq-hero-visual{width:min(100%,560px);padding-block:24px 88px}
}

@media screen and (min-width:768px) and (max-width:1023px) and (max-height:600px) {
  .hq-header-inner .brand-logo{width:96px}
  .hq-hero{padding-block-start:16px}
  .hq-hero h1{font-size:44px;line-height:1.15;margin-block-end:16px}
  .hq-hero .hq-lead{font-size:16px;line-height:1.6;margin-block-end:16px}
  .hq-hero .hq-button{min-height:44px;padding-block:10px}
}
```

## frontend/src/app/globals.css

```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700;800;900&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --brand-blue: #074f78;
  --brand-green: #2d6624;
  --brand-ink: #123348;
  --brand-canvas: #f5f8f7;
}

[dir="rtl"], .font-arabic {
  font-family: 'Tajawal', 'Plus Jakarta Sans', system-ui, sans-serif;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: 180px;
}

body {
  background: var(--brand-canvas);
  color: var(--brand-ink);
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: #e2efd8;
  color: #082f47;
}

h1, h2, h3 { text-wrap: balance; }
p { text-wrap: pretty; }
button, a, input, select, summary { -webkit-tap-highlight-color: transparent; }
button:not(:disabled), select, summary { cursor: pointer; }
input, select { accent-color: var(--brand-green); }
input[type="text"], input[type="email"], input[type="password"], select { min-height: 46px; }
input::placeholder { color: #71838d; }
.brand-logo { position: relative; display: block; aspect-ratio: 500 / 290; overflow: hidden; flex-shrink: 0; }
.brand-logo img { position: absolute; inset-inline-start: 0; top: -35.8%; width: 100%; height: auto; max-width: none; }
.brand-hero { background: linear-gradient(115deg, #f5f9fc 0%, #fff 60%, #f1f7ed 100%); }
.brand-eyebrow { display: inline-flex; align-items: center; gap: .5rem; font-size: .75rem; font-weight: 800; line-height: 1.8; letter-spacing: .075em; color: var(--brand-blue); }
[dir="rtl"] .brand-eyebrow { letter-spacing: 0; }
.brand-button { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; gap: .75rem; border-radius: 12px; padding: .875rem 1.5rem; background: var(--brand-green); color: white; font-weight: 800; font-size: .875rem; box-shadow: 0 5px 15px -10px #132b10; transition: background-color .18s ease, box-shadow .18s ease; }
.brand-button:hover { background: #285321; box-shadow: 0 7px 20px -12px #132b10; }
.skip-link { position: fixed; inset-inline-start: 16px; top: -80px; z-index: 100; border-radius: 8px; padding: 12px 18px; background: var(--brand-blue); color: white; font-weight: 700; }
.skip-link:focus { top: 12px; }
.admin-drawer { margin: 0; inset-inline-start: 0; inset-inline-end: auto; width: min(320px, 90vw); height: 100dvh; max-height: none; border: 0; padding: 0; color: var(--brand-ink); }
.admin-drawer::backdrop { background: rgb(8 47 71 / 48%); backdrop-filter: blur(3px); }
@media (min-width: 1024px) { html { scroll-padding-top: 125px; } }

body:has([data-admin-root]) > header,
body:has([data-admin-root]) > footer {
  display: none !important;
}

:focus-visible { outline: 3px solid #2d6624; outline-offset: 4px; }
#main-content:focus { outline: none; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
@media print {
  .skip-link, dialog { display: none !important; }
  [data-admin-root] { display: block !important; background: white !important; }
  [data-admin-root] .admin-content { padding: 0 !important; max-width: none !important; }
  @page { size: A4; margin: 14mm; }
  body { background: white !important; color: #123348; }
  header, footer, aside, nav, button, [role="navigation"] { display: none !important; }
  [data-report-root] { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  [data-report-root] > div { break-inside: avoid; box-shadow: none !important; }
  [data-report-root] .grid { display: block; }
  [data-report-root] .grid > div { margin-bottom: 5mm; break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}

@media print { [data-report-root] [class*="text-brand-blue-200"], [data-report-root] [class*="text-slate-300"] { color: #475569 !important; } }

@media print {
  [data-adaptive-root] { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  [data-adaptive-report] { font-size: 10pt; }
  [data-adaptive-report] > .grid { display: block !important; }
  [data-adaptive-summary] { padding: 0 0 5mm !important; border: 0 !important; border-radius: 0 !important; }
  [data-adaptive-skill] { break-inside: avoid; margin-bottom: 5mm; padding: 4mm !important; box-shadow: none !important; }
  [data-adaptive-skill] details { display: none; }
}
/* Homepage design tokens: derived from the supplied SkillQuest logo. */
:root {
 --hq-blue-50:#edf5f9;--hq-blue-100:#d9e9f2;--hq-blue-200:#b6d2e4;--hq-blue-300:#8ab3d0;--hq-blue-400:#548eaf;--hq-blue-500:#2f6e95;--hq-blue-600:#175378;--hq-blue-700:#073e65;--hq-blue-800:#012754;--hq-blue-900:#09223b;
 --hq-green-50:#f0f6ed;--hq-green-100:#e3efdd;--hq-green-200:#c8dfbb;--hq-green-300:#a3c88d;--hq-green-400:#79a960;--hq-green-500:#4c8c3b;--hq-green-600:#28782f;--hq-green-700:#146b27;--hq-green-800:#165427;--hq-green-900:#163e26;
 --hq-paper:#fafaf5;--hq-ink:#123348;--hq-muted:#526877;--hq-line:#c4d5d8;
 --hq-space-1:8px;--hq-space-2:16px;--hq-space-3:24px;--hq-space-4:32px;--hq-space-6:48px;--hq-space-8:64px;--hq-space-12:96px;
 --hq-radius-sm:8px;--hq-radius-md:16px;--hq-radius-lg:24px;
 --hq-shadow:0 4px 10px #01275408,0 24px 64px #01275414;
 --hq-title:clamp(2.25rem,4.1vw,4rem);--hq-display:clamp(3.6rem,7.1vw,7rem);
}
```

## frontend/src/app/layout.tsx

```tsx
import type { Metadata } from "next";
import { LanguageProvider } from "@/lib/language-context";
import { PublicHeader, PublicFooter } from "@/components/public-header";
import "./globals.css";
import "./editorial.css";
import "./assessment.css";
import "./home.css";

export const metadata: Metadata = {
  title: "SkillQuest | Chabab Connect",
  description: "Parcours interactif d'évaluation et de développement des soft skills.",
  icons: { icon: "/brand/skillquest-logo.png", apple: "/brand/skillquest-logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased flex flex-col justify-between">
        <LanguageProvider>
          <PublicHeader />
          <main id="main-content" tabIndex={-1} className="flex-1">{children}</main>
          <PublicFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}
```

## frontend/src/components/public-header.tsx

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/language-context";
import { homeContent as c } from "@/lib/home-content";
import { LanguageSwitcher } from "./language-switcher";
import { BrandLogo } from "./brand-logo";
import { StartLink } from "./home/shared";
export function PublicHeader() { const { lang } = useLanguage(), pathname = usePathname(); if (pathname.startsWith("/admin"))
    return null; return <><a href="#main-content" className="skip-link">{c.skip[lang]}</a><header className="public-header hq-site-header"><div className="hq-institution"><div className="hq-container"><span>{c.association[lang]}</span><span>{c.institution[lang]}</span></div></div><div className="hq-container hq-header-inner"><Link href="/" aria-label="SkillQuest"><BrandLogo /></Link><nav aria-label={c.navLabel[lang]}>{c.nav.map(n => <Link key={n.href} href={n.href}>{n.label[lang]}</Link>)}</nav><LanguageSwitcher /><StartLink /></div></header></>; }
export function PublicFooter() { const { lang } = useLanguage(), pathname = usePathname(); if (pathname.startsWith("/admin"))
    return null; return <footer className="hq-site-footer"><div className="hq-container"><div className="hq-footer-top"><div><Link href="/" aria-label="SkillQuest"><BrandLogo /></Link><p>{c.footer.description[lang]}</p></div><nav aria-label={c.footer.links[lang]}>{c.nav.map(n => <Link key={n.href} href={n.href}>{n.label[lang]}</Link>)}<Link href="/entretien">{c.start[lang]}</Link><Link href="/confidentialite">{c.footer.privacy[lang]}</Link><Link href="/admin/login">{c.footer.admin[lang]}</Link></nav></div><p className="hq-footer-wordmark" aria-hidden="true" dir="ltr">SkillQuest</p><div className="hq-footer-bottom"><p>{c.association[lang]}</p><p>{c.footer.note[lang]}</p></div></div></footer>; }
```
