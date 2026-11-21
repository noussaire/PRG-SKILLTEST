"use client";

import { Suspense } from "react";
import Link from "next/link";
import { JoinForm } from "@/components/join-form";
import { useLanguage } from "@/lib/language-context";
import { ArrowLeft, ArrowRight, Sparkles, Users } from "lucide-react";

export default function RejoindrePage() {
  const { lang, isRtl } = useLanguage();
  const ar = lang === "ar";
  const BackArrow = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <Link
            href="/entretien"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-brand-blue-700 transition-colors"
          >
            <BackArrow size={14} aria-hidden="true" />
            <span>{ar ? "العودة إلى المسارات" : "Retour aux parcours"}</span>
          </Link>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-xl shadow-slate-200/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-blue-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />

          <div className="flex items-center gap-2.5 text-brand-blue-700 font-bold text-xs uppercase tracking-wider mb-2">
            <Users size={16} />
            <span>{ar ? "جلسة جماعية" : "Session organisée"}</span>
          </div>

          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            {ar ? "الانضمام إلى جلسة منظمة" : "Rejoindre une session"}
          </h1>

          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            {ar
              ? "أدخل الرمز المكون من 6 أحرف المقدم من المؤطر أو المدرب لبدء اختبار المهارات الـ31 مباشرة."
              : "Saisissez le code à 6 caractères transmis par votre formateur pour accéder directement au test des 31 Soft Skills."}
          </p>

          <Suspense
            fallback={
              <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                {ar ? "جاري تحميل النموذج..." : "Chargement du formulaire..."}
              </div>
            }
          >
            <JoinForm />
          </Suspense>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              {ar
                ? "هل ترغب في اجتياز الاختبار الفردي المستقل؟"
                : "Vous souhaitez passer le test individuel avec e-mail ?"}
            </p>
            <Link
              href="/entretien/soft-skills"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-brand-blue-700 hover:text-brand-blue-800 transition-colors"
            >
              <Sparkles size={13} />
              <span>{ar ? "بدء الاختبار الفردي" : "Accéder au parcours individuel"}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
