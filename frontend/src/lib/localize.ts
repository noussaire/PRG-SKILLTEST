export function localize(text: string | null | undefined, lang: "fr" | "ar"): string {
  if (!text) return "";
  if (lang === "ar") {
    const names: Record<string, string> = { "Communication": "التواصل", "Leadership": "القيادة", "Travail en équipe": "العمل الجماعي", "Gestion du temps": "إدارة الوقت", "Organisation": "التنظيم", "Résolution de problèmes": "حل المشكلات", "Adaptabilité": "المرونة", "Écoute et empathie": "الاستماع والتعاطف" };
    if (names[text]) return names[text];
  }
  if (text.includes(":::ar") && text.includes(":::fr")) {
    const parts = text.split(":::ar");
    const frPart = parts[0].replace(":::fr", "").trim();
    const arPart = (parts[1] || "").trim();
    return lang === "ar" ? arPart : frPart;
  }
  return text;
}

export const profileArabicTranslations: Record<
  string,
  { title: string; tagline: string; description: string; ruleExplanation: string }
> = {
  "Observations insuffisantes": { title: "ملاحظات غير كافية", tagline: "تغذية راجعة أولية دون ملف نهائي", description: "القرارات المتاحة لا تكفي لاستنتاج اتجاه موثوق. ناقش الملاحظات مع المؤطر.", ruleExplanation: "يتطلب التحليل أربعة قرارات وملاحظتين لكل مهارة معنية على الأقل." },
  "Parcours en attente": { title: "المسار في الانتظار", tagline: "لا توجد قرارات بعد", description: "ابدأ المسار لجمع الملاحظات.", ruleExplanation: "لا توجد بيانات كافية." },
  "Axes de progression à explorer": { title: "محاور للتطوير والاستكشاف", tagline: "سلوكيات للنقاش حسب السياق", description: "تظهر بعض القرارات تأثيرات غير ملائمة وفق شبكة هذه المهمة. ناقش أسبابها قبل أي استنتاج عام.", ruleExplanation: "متوسطات التأثير حسب القرارات الملاحظة." },
  "Tendances à approfondir": { title: "اتجاهات تحتاج إلى تعميق", tagline: "لا يوجد اتجاه مهيمن واضح", description: "لا يظهر المسار اتجاهاً واضحاً وفق القواعد المختارة. هذا لا يعني نجاحاً أو فشلاً.", ruleExplanation: "متوسطات التأثير حسب القرارات الملاحظة." },
  "Collaborateur Stratégique": {
    title: "المتعاون الاستراتيجي",
    tagline: "قوة العمل الجماعي والرؤية التحليلية الواضحة",
    description: "تضع نجاح الفريق دائماً في المقدمة، وتبحث بهدوء عن حلول عملية للعقبات مع حشد طاقات زملائك نحو هدف مشترك.",
    ruleExplanation: "تحقيق مؤشر مرتفع في 'العمل الجماعي' مصحوباً بـ 'حل المشكلات' أو 'المرونة والتأقلم'.",
  },
  "Communicant Réfléchi": {
    title: "المتواصل الحكيم",
    tagline: "الاستماع الإيجابي والحوار البناء وتفهم الآخرين",
    description: "تنزع فتيل الخلافات بالاستماع للظروف الإنسانية قبل فرض آرائك، وتتميز بأسلوب متزن يجمع ولا يفرق.",
    ruleExplanation: "تحقيق مؤشر مرتفع في 'التواصل' مصحوباً بـ 'الاستماع النشط والتعاطف الإنساني'.",
  },
  "Coordinateur d'Équipe": {
    title: "منسق وقائد الفريق",
    tagline: "المبادرة المسؤولة، القيادة وحسن إدارة الأولويات",
    description: "أمام ضيق الوقت وحالات الطوارئ، تتخذ خطوات واضحة ومسؤولة تعيد ترتيب المهام وتوجه الفريق نحو الإنجاز.",
    ruleExplanation: "تحقيق مؤشر مرتفع في 'القيادة' مصحوباً بـ 'إدارة الوقت' أو 'العمل الجماعي'.",
  },
  "Résolveur Créatif": {
    title: "حلال الأزمات والمبتكر",
    tagline: "المرونة الذهنية وسرعة إيجاد الحلول البديلة",
    description: "تتميز بالقدرة على تفكيك المشكلات المعقدة واقتراح مسارات ذكية وسريعة دون الاستسلام للجمود أو الخوف.",
    ruleExplanation: "تحقيق مؤشر مرتفع في 'حل المشكلات' مصحوباً بـ 'المرونة والتأقلم'.",
  },
  "Profil Polyvalent & Équilibré": {
    title: "شخصية متوازنة ومتعددة المهارات",
    tagline: "المرونة والتأقلم المتوازن مع المواقف",
    description: "أظهرت قراراتك نضجاً متزناً يوظف مختلف المهارات بحسب مقتضى الموقف دون إفراط أو تفريط.",
    ruleExplanation: "توزيع متوازن للمهارات في مختلف المواقف دون تركز مفرط على مهارة واحدة.",
  },
};

export const competencyArabicNames: Record<string, string> = {
  "communication": "التواصل والتعبير الفعال",
  "leadership": "القيادة والتأثير الإيجابي",
  "travail-en-equipe": "العمل الجماعي والتعاون",
  "gestion-du-temps": "إدارة الوقت والأولويات",
  "resolution-de-problemes": "حل المشكلات والتفكير النقدي",
  "adaptabilite": "المرونة والتأقلم مع المتغيرات",
  "ecoute-et-empathie": "الاستماع النشط والتعاطف الإنساني",
};

export function translateInterpretation(text: string, lang: "fr" | "ar"): string {
  if (lang !== "ar") return localize(text, lang);
  if (text.includes(":::ar")) return localize(text, lang);
  const limited = text.includes("Observation limitée") ? "ملاحظة محدودة: " : "";
  if (text.includes("Dimension non observée")) return "لم تُلاحظ هذه المهارة في قرارات هذا المسار.";
  if (text.includes("favorisent cette compétence")) return limited + "القرارات الملاحظة تدعم هذه المهارة في سياق المهمة.";
  if (text.includes("tendance constructive légère")) return limited + "تظهر نزعة إيجابية محدودة في هذا السياق.";
  if (text.includes("se compensent")) return limited + "التأثيرات متوازنة أو محايدة، ولا تسمح باستنتاج عام.";
  if (text.includes("axe de progression apparaît")) return limited + "يظهر محور للتطوير في هذا السياق. ناقش القرارات مع المؤطر.";
  if (text.includes("Point fort marquant")) {
    return "نقطة قوة بارزة : أظهرت تصرفاً حكيماً وثابتاً في اللحظات الحرجة.";
  }
  if (text.includes("Comportement constructif")) {
    return "سلوك إيجابي وبناء : قرارات مدروسة ساهمت بشكل مباشر في نجاح المرحلة.";
  }
  if (text.includes("Posture équilibrée")) {
    return "موقف متوازن ومحايد بدون تأثير سلبي.";
  }
  if (text.includes("Zone de vigilance contextuelle")) {
    return "منطقة تنبيه : تردد ملحوظ أو ميل للعزلة تحت وطأة الضغط.";
  }
  if (text.includes("Axe d'amélioration prioritaire")) {
    return "أولوية للتحسين : فرصة هامة لتطوير مهارات التهدئة والتشارك في أوقات التوتر.";
  }
  return text;
}
