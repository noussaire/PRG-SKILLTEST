"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type Language = "fr" | "ar";

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
  isRtl: boolean;
}

export const translations: Record<Language, Record<string, string>> = {
  fr: {
    // Nav
    "nav.home": "Accueil",
    "nav.join": "Participer",
    "nav.admin": "Administration",
    "nav.tagline": "par Chabab Connect",
    "nav.switch_lang": "العربية",

    // Home
    "home.badge": "Évaluation bienveillante & interactive",
    "home.title": "Révélez vos Soft Skills à travers vos décisions",
    "home.subtitle": "Plongez dans des missions immersives réalistes. Vos choix guident le scénario et révèlent vos compétences comportementales : communication, travail d'équipe, gestion du stress et leadership.",
    "home.cta_start": "Commencer ma mission",
    "home.cta_admin": "Espace Formateur / Admin",
    "home.feature1_title": "100% Adaptatif",
    "home.feature1_desc": "Chaque décision modifie le cours de l'histoire. Vous vivez une expérience unique.",
    "home.feature2_title": "Sans Jugement ni Note",
    "home.feature2_desc": "Pas de note éliminatoire. Une analyse constructive de vos réflexes professionnels.",
    "home.feature3_title": "Bilan & Conseils Immédiats",
    "home.feature3_desc": "Découvrez vos points forts, vos axes d'amélioration et téléchargez votre synthèse PDF.",

    // Join Form
    "join.badge": "Accès Sécurisé",
    "join.title": "Rejoindre une Mission",
    "join.subtitle": "Entrez le code de session fourni par votre animateur ou coordinateur Chabab Connect.",
    "join.code_label": "Code de session",
    "join.code_placeholder": "Code fourni par le formateur",
    "join.name_label": "Votre prénom ou pseudo",
    "join.name_placeholder": "Ex: Youssef, Salma...",
    "join.submit": "Démarrer l'aventure →",
    "join.loading": "Connexion à la mission en cours...",
    "join.anonymous_hint": "Votre nom ou pseudonyme, vos décisions et votre bilan sont visibles par les administrateurs autorisés.",

    // Mission Runner
    "runner.participant_space": "Espace Participant",
    "runner.id": "Identifiant",
    "runner.hello": "Bonjour",
    "runner.step": "Situation",
    "runner.completed": "Mission terminée",
    "runner.autosave": "Sauvegarde continue de vos choix",
    "runner.decision_needed": "Décision requise",
    "runner.choose_option": "Que décidez-vous de faire ?",
    "runner.submitting": "Enregistrement de votre décision...",
    "runner.confirm": "Valider cette décision",
    "runner.congratulations": "Félicitations, vous êtes arrivé au bout du scénario !",
    "runner.congrats_desc": "Toutes vos décisions ont été enregistrées. Le système a analysé vos réflexes et vos compétences pour dresser votre profil complet.",
    "runner.see_results": "Découvrir mon bilan Soft Skills & mes résultats →",

    // Report
    "report.badge_student": "Bilan Personnel Soft Skills",
    "report.badge_admin": "Rapport Administrateur",
    "report.title": "Synthèse Comportementale & Profil",
    "report.print": "Imprimer / Télécharger en PDF",
    "report.back": "Retour",
    "report.profile_identified": "Profil Déterminé",
    "report.decisions_count": "décisions analysées",
    "report.positives_title": "Points Forts observés (Ce que vous avez bien fait)",
    "report.negatives_title": "Axes d'amélioration & Vigilances (Ce qu'il faut corriger)",
    "report.radar_title": "Indicateurs des compétences observées",
    "report.recommendations_title": "Conseils pratiques pour booster vos compétences",
    "report.timeline_title": "Historique chronologique de vos choix",
    "report.evaluated": "Observé",
    "report.neutral": "Non sollicité",

    // Admin Common
    "admin.dashboard": "Tableau de bord",
    "admin.participants": "Participants",
    "admin.sessions": "Sessions d'évaluation",
    "admin.missions": "Constructeur de Missions",
    "admin.reports": "Rapports Soft Skills",
    "admin.logout": "Se déconnecter",
    "admin.view_site": "Voir le site",
    "admin.role": "Administrateur",
  },
  ar: {
    // Nav
    "nav.home": "الرئيسية",
    "nav.join": "المشاركة الآن",
    "nav.admin": "لوحة الإدارة",
    "nav.tagline": "مبادرة جمعية شباب كونكت",
    "nav.switch_lang": "Français",

    // Home
    "home.badge": "تقييم تفاعلي وإيجابي للمهارات الشخصية",
    "home.title": "اكتشف مهاراتك القيادية من خلال قراراتك الواقعية",
    "home.subtitle": "انغمس في مهمات تفاعلية واقعية تحاكي مواقف الحياة المهنية. كل قرار تتخذه يغيّر مجرى القصة ويكشف مهاراتك في التواصل، العمل الجماعي، وإدارة الأزمات.",
    "home.cta_start": "ابدأ مهمتك الآن",
    "home.cta_admin": "فضاء المدرب / المسؤول",
    "home.feature1_title": "سيناريو تفاعلي 100%",
    "home.feature1_desc": "كل قرار يؤثر في مسار الأحداث. تجربتك تنفرد باختياراتك.",
    "home.feature2_title": "بدون علامات أو رسوب",
    "home.feature2_desc": "لا توجد علامة من 20. هدفنا تسليط الضوء على قدراتك وتوجيهك للتطور.",
    "home.feature3_title": "تقرير ونصائح فورية",
    "home.feature3_desc": "اكتشف نقاط قوتك والنقاط التي تحتاج تحسيناً، وحمل ملف تقريرك بصيغة PDF.",

    // Join Form
    "join.badge": "دخول آمن",
    "join.title": "الانضمام إلى جلسة تقييم",
    "join.subtitle": "أدخل رمز الجلسة الذي حصلت عليه من منسق جمعية شباب كونكت واسمك للبدء.",
    "join.code_label": "رمز الجلسة (Code)",
    "join.code_placeholder": "الرمز الذي يقدمه المؤطر",
    "join.name_label": "اسمك أو لقبك",
    "join.name_placeholder": "مثال: يوسف، سلمى، مهدي...",
    "join.submit": "انطلاق المغامرة ←",
    "join.loading": "جارٍ التحقق وبدء المهمة...",
    "join.anonymous_hint": "اسمك أو لقبك وقراراتك وتقريرك متاحة للمسؤولين المخولين.",

    // Mission Runner
    "runner.participant_space": "فضاء المشارك",
    "runner.id": "المعرّف",
    "runner.hello": "مرحباً",
    "runner.step": "الموقف",
    "runner.completed": "اكتملت المهمة بنجاح",
    "runner.autosave": "حفظ تلقائي مستمر لقراراتك",
    "runner.decision_needed": "قرار مطلوب منك",
    "runner.choose_option": "ماذا تقرر أن تفعل في هذا الموقف؟",
    "runner.submitting": "جارٍ تسجيل قرارك وتحليل الأثر...",
    "runner.confirm": "تأكيد هذا القرار والمتابعة",
    "runner.congratulations": "تهانينا! لقد وصلت إلى خاتمة هذا السيناريو بنجاح",
    "runner.congrats_desc": "تم تسجيل وتحليل كافة اختياراتك وفق شبكة المهارات الشخصية المهنية. يمكنك الآن الاطلاع على تقريرك المتكامل.",
    "runner.see_results": "عرض نتائجك وتحليلك الشامل ←",

    // Report
    "report.badge_student": "تقرير المهارات الشخصية للمشارك",
    "report.badge_admin": "تقرير المسؤول",
    "report.title": "الملف السلوكي وتحليل القرارات",
    "report.print": "طباعة / تحميل التقرير PDF",
    "report.back": "رجوع",
    "report.profile_identified": "الملف المحدد لشخصيتك",
    "report.decisions_count": "قرارات تم تحليلها",
    "report.positives_title": "نقاط القوة المرصودة (ما أحسنت فعله)",
    "report.negatives_title": "نقاط تحتاج إلى تحسين (أخطاء وحالات تنبيه)",
    "report.radar_title": "مؤشرات المهارات الملاحظة",
    "report.recommendations_title": "إرشادات وتوجيهات عملية لتطوير أدائك",
    "report.timeline_title": "السجل الزمني لكافة القرارات المتخذة",
    "report.evaluated": "تم رصده",
    "report.neutral": "غير مفعّل في هذا المسار",

    // Admin Common
    "admin.dashboard": "لوحة القيادة",
    "admin.participants": "المشاركون",
    "admin.sessions": "جلسات التقييم",
    "admin.missions": "مُصمم المهمات",
    "admin.reports": "تقارير المهارات",
    "admin.logout": "تسجيل الخروج",
    "admin.view_site": "مشاهدة الموقع",
    "admin.role": "مدير النظام",
  },
};

const LanguageContext = createContext<LanguageContextType>({
  lang: "ar",
  setLang: () => {},
  t: (key: string) => key,
  isRtl: true,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("ar");

  useEffect(() => {
    // If not explicitly set to Arabic or French after v3 migration, default strictly to Arabic
    const migrationKey = "sq_lang_v3_arabic_default";
    let initialLang: Language = "ar";
    if (readPreference(migrationKey) === "true") {
      const saved = readPreference("sq_lang") as Language;
      if (saved === "fr" || saved === "ar") {
        initialLang = saved;
      }
    } else {
      // First time on Arabic-first version: force Arabic
      initialLang = "ar";
      writePreference("sq_lang", "ar");
      writePreference(migrationKey, "true");
    }

    const requested = new URLSearchParams(window.location.search).get("lang");
    if (requested === "fr" || requested === "ar") {
      initialLang = requested;
      writePreference("sq_lang", requested);
    }
    setLangState(initialLang);
    document.documentElement.lang = initialLang;
    document.documentElement.dir = initialLang === "ar" ? "rtl" : "ltr";
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    writePreference("sq_lang", newLang);
    writePreference("sq_lang_v3_arabic_default", "true");
    document.documentElement.lang = newLang;
    document.documentElement.dir = newLang === "ar" ? "rtl" : "ltr";
  };

  const t = (key: string): string => {
    return translations[lang][key] || translations["fr"][key] || key;
  };

  const isRtl = lang === "ar";

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, isRtl }}>
      <div className={isRtl ? "font-arabic" : ""}>{children}</div>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

function readPreference(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function writePreference(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* preference stays in memory */ } }
