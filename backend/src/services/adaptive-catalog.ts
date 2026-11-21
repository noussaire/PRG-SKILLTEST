// Proposition pédagogique modifiable, sans prétention de référentiel universel.
export type InterviewLanguage = "fr" | "ar";
export const ADAPTIVE_SKILLS = [
  ["communication", "Communication", "التواصل", "Expliquer clairement une idée et vérifier sa compréhension.", "شرح الفكرة بوضوح والتحقق من فهمها."],
  ["ecoute-active", "Écoute active", "الإنصات الفعال", "Reformuler et poser des questions avant de répondre.", "إعادة الصياغة وطرح الأسئلة قبل الإجابة."],
  ["assertivite", "Assertivité", "التعبير الحازم", "Exprimer ses besoins et ses limites avec respect.", "التعبير عن الاحتياجات والحدود باحترام."],
  ["empathie", "Empathie", "التعاطف", "Chercher à comprendre le point de vue d'une autre personne.", "محاولة فهم وجهة نظر شخص آخر."],
  ["travail-equipe", "Travail en équipe", "العمل الجماعي", "Contribuer à un objectif partagé et répartir les tâches.", "المساهمة في هدف مشترك وتوزيع المهام."],
  ["collaboration", "Collaboration", "التعاون", "Partager les informations et coordonner des contributions différentes.", "تبادل المعلومات وتنسيق المساهمات المختلفة."],
  ["leadership", "Leadership", "القيادة", "Donner une direction et aider les autres à agir.", "تحديد الاتجاه ومساعدة الآخرين على العمل."],
  ["gestion-conflits", "Gestion des conflits", "إدارة النزاعات", "Traiter un désaccord en recherchant une solution constructive.", "معالجة الخلاف بالبحث عن حل بناء."],
  ["negociation", "Négociation", "التفاوض", "Identifier les intérêts et rechercher un accord équilibré.", "تحديد المصالح والبحث عن اتفاق متوازن."],
  ["influence", "Influence et persuasion", "التأثير والإقناع", "Argumenter honnêtement et tenir compte des objections.", "تقديم حجج صادقة ومراعاة الاعتراضات."],
  ["prise-parole", "Prise de parole", "التحدث أمام الجمهور", "Structurer une présentation et s'adapter à son public.", "تنظيم عرض وتكييفه مع الجمهور."],
  ["intelligence-emotionnelle", "Régulation émotionnelle", "تنظيم المشاعر", "Reconnaître une émotion et choisir une réaction adaptée.", "التعرف على المشاعر واختيار رد فعل مناسب."],
  ["conscience-soi", "Connaissance de soi", "الوعي بالذات", "Reconnaître ses forces, ses limites et demander du retour.", "معرفة نقاط القوة والحدود وطلب الملاحظات."],
  ["gestion-stress", "Gestion du stress", "إدارة الضغط", "Prioriser et demander du soutien dans une situation de pression.", "تحديد الأولويات وطلب الدعم تحت الضغط."],
  ["resilience", "Résilience", "القدرة على التعافي", "Tirer un apprentissage d'un échec et définir une prochaine action.", "التعلم من الإخفاق وتحديد الخطوة التالية."],
  ["adaptabilite", "Adaptabilité", "التكيف", "Modifier sa méthode lorsque les contraintes changent.", "تغيير الطريقة عندما تتغير الظروف."],
  ["creativite", "Créativité", "الإبداع", "Proposer plusieurs pistes et expérimenter une solution nouvelle.", "اقتراح مسارات متعددة وتجربة حل جديد."],
  ["esprit-critique", "Esprit critique", "التفكير النقدي", "Vérifier les sources, les hypothèses et les contre-exemples.", "التحقق من المصادر والافتراضات والأمثلة المضادة."],
  ["resolution-problemes", "Résolution de problèmes", "حل المشكلات", "Analyser les causes, tester une solution et vérifier son effet.", "تحليل الأسباب وتجربة حل والتحقق من أثره."],
  ["prise-decision", "Prise de décision", "اتخاذ القرار", "Comparer des options, leurs risques et les informations manquantes.", "مقارنة الخيارات ومخاطرها والمعلومات الناقصة."],
  ["gestion-temps", "Gestion du temps", "إدارة الوقت", "Estimer les délais et arbitrer entre urgence et importance.", "تقدير المواعيد والموازنة بين الاستعجال والأهمية."],
  ["organisation", "Organisation", "التنظيم", "Mettre en place une méthode pour suivre ses tâches et ses ressources.", "وضع طريقة لمتابعة المهام والموارد."],
  ["planification", "Planification", "التخطيط", "Définir des étapes, des dépendances et une marge pour les imprévus.", "تحديد المراحل والترابط بينها وهامش للطوارئ."],
  ["autonomie", "Autonomie", "الاستقلالية", "Avancer sans supervision constante et savoir quand demander de l'aide.", "التقدم دون إشراف مستمر ومعرفة متى تطلب المساعدة."],
  ["initiative", "Prise d'initiative", "المبادرة", "Proposer une action utile sans attendre une consigne détaillée.", "اقتراح عمل مفيد دون انتظار تعليمات مفصلة."],
  ["responsabilite", "Sens des responsabilités", "تحمل المسؤولية", "Assumer une erreur, prévenir les personnes concernées et la corriger.", "تحمل الخطأ وإبلاغ المعنيين وتصحيحه."],
  ["fiabilite", "Fiabilité", "الموثوقية", "Tenir ses engagements et alerter tôt lorsqu'un engagement est menacé.", "الوفاء بالالتزامات والتنبيه المبكر عند تعذرها."],
  ["apprentissage-continu", "Apprentissage continu", "التعلم المستمر", "Transformer un retour en objectif de progression et en pratique.", "تحويل الملاحظات إلى هدف للتطور وممارسة عملية."],
  ["curiosite", "Curiosité", "الفضول المعرفي", "Explorer une question nouvelle et chercher à comprendre avant de conclure.", "استكشاف مسألة جديدة والسعي لفهمها قبل الاستنتاج."],
  ["inclusion", "Ouverture et inclusion", "الانفتاح والشمول", "Faire place à des points de vue et des besoins différents.", "إتاحة المجال لوجهات نظر واحتياجات مختلفة."],
  ["ethique", "Éthique professionnelle", "الأخلاق المهنية", "Agir avec honnêteté et protéger la confidentialité même sous pression.", "التصرف بأمانة وحماية السرية حتى تحت الضغط."],
] as const;

export function getAdaptiveCatalog(language: InterviewLanguage) {
  return ADAPTIVE_SKILLS.map(([id, fr, ar, descriptionFr, descriptionAr]) => ({
    id,
    label: language === "ar" ? ar : fr,
    description: language === "ar" ? descriptionAr : descriptionFr,
  }));
}
