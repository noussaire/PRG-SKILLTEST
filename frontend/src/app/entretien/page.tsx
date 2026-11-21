"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

export default function AdaptivePathwaysPage() {
  const { lang } = useLanguage(), ar = lang === "ar";
  return <div className="sq-wrap sq-tests" data-pathway-selection>
    <h1>{ar ? "اختر اختبارك." : "Choisissez votre test."}</h1>
    <p className="sq-tests-intro">{ar ? "ابدأ بمسار المهارات الشخصية. عد من المتصفح نفسه لاستئناف أي مشاركة محفوظة." : "Commencez par le parcours de soft skills. Revenez dans le même navigateur pour reprendre une participation sauvegardée."}</p>
    <div className="sq-test-catalog">
      <Link href="/entretien/soft-skills" className="sq-test-available" data-soft-skills-card>
        <div><h2>{ar ? "المهارات الشخصية" : "Soft skills"}</h2><p>{ar ? "31 مهارة، أربعة اختيارات في كل موقف. قراراتك تحدد المسار." : "31 compétences, quatre choix par situation. Vos décisions déterminent le parcours."}</p><p className="sq-test-format">{ar ? "بالفرنسية والعربية · تقرير شخصي · حفظ تلقائي" : "Français & arabe · Rapport personnel · Sauvegarde automatique"}</p></div>
        <span className="sq-test-launch">{ar ? "بدء الاختبار" : "Commencer"}<ArrowUpRight size={28} aria-hidden="true" /></span>
      </Link>
      <Link href="/rejoindre" className="sq-test-available" data-session-code-card>
        <div><h2>{ar ? "جلسة برمز" : "Session organisée"}</h2><p>{ar ? "انضم إلى ورشة أو تدريب برمز من 6 أحرف للوصول المباشر إلى الاختبار دون بريد إلكتروني." : "Rejoignez un atelier ou une formation avec un code à 6 caractères sans validation e-mail requise."}</p><p className="sq-test-format">{ar ? "31 مهارة · وصول فوري برمز · تقرير نهائي" : "31 compétences · Accès direct · Rapport personnel"}</p></div>
        <span className="sq-test-launch">{ar ? "إدخال الرمز" : "Rejoindre"}<ArrowUpRight size={28} aria-hidden="true" /></span>
      </Link>
      <article className="sq-test-upcoming" data-egogram-card><h2>{ar ? "الإيغوغرام" : "Égogramme"}</h2><p>{ar ? "مسار جديد قيد التحضير. سيُطوّر هذا الاختبار لاحقا." : "Un nouveau parcours en préparation. Ce test sera développé ultérieurement."}</p><button type="button" disabled>{ar ? "قريبا" : "Bientôt disponible"}</button></article>
    </div>
    <div className="sq-test-guidance"><p>{ar ? "المسار مخصص للبالغين. يُطلب الاسم الكامل والبريد الإلكتروني قبل البدء." : "Le parcours est destiné aux adultes. Votre nom complet et votre e-mail sont demandés avant de commencer."}</p><Link href="/confidentialite">{ar ? "استخدام البيانات" : "Utilisation des données"}</Link></div>
  </div>;
}
