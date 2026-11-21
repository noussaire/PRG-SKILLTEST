"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Compass,
  Printer,
  Sparkles,
  Target,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Layers,
  ArrowLeft,
  ShieldCheck,
  Award,
  Calendar,
  ThumbsUp,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import {
  localize,
  profileArabicTranslations,
  competencyArabicNames,
  translateInterpretation,
} from "@/lib/localize";

export interface ContributingDecision {
  nodeId: string;
  nodeTitle: string;
  question: string | null;
  choiceId: string;
  choiceLabel: string;
  delta: number;
  missionTitle: string;
  timestamp: string;
}

export interface CompetencyIndicator {
  slug: string;
  label: string;
  description: string | null;
  cumulativeValue: number;
  averageValue: number;
  decisionCount: number;
  evaluated: boolean;
  pedagogicalInterpretation: string;
  contributions: ContributingDecision[];
}

export interface SoftSkillsProfile {
  title: string;
  tagline: string;
  description: string;
  ruleExplanation: string;
  dominantCompetencies: string[];
}

export interface StudentReportProps {
  report: {
    participant: {
      id: string;
      publicId: string;
      displayName: string;
      createdAt: string;
    };
    session: {
      id: string;
      label: string;
      status: string;
      assessmentTitle: string;
    };
    attempt: {
      id: string;
      status: "IN_PROGRESS" | "COMPLETED";
      missionVersion: number;
      startedAt: string;
      completedAt: string | null;
      totalDecisions: number;
    };
    mission: {
      id: string;
      title: string;
      version: number;
      description: string | null;
      pedagogicalGoal: string | null;
      targetCompetencies: string | null;
      estimatedDuration: number;
    };
    profile: SoftSkillsProfile;
    indicators: CompetencyIndicator[];
    strengths: Array<{ competency: string; summary: string }>;
    improvements: Array<{ competency: string; summary: string }>;
    recommendations: Array<{ title: string; action: string }>;
    decisionTimeline: Array<{
      stepIndex: number;
      nodeTitle: string;
      storyExcerpt: string;
      question: string | null;
      chosenOption: string;
      date: string;
      impacts: Array<{ competency: string; delta: number }>;
    }>;
    methodologyNote: string;
    historicalNotice?: string | null;
    generatedAt: string;
  };
  isAdminView?: boolean;
}

export function StudentReportView({ report, isAdminView = false }: StudentReportProps) {
  const { t, lang, isRtl } = useLanguage();

  const [selectedCompetency, setSelectedCompetency] = useState<CompetencyIndicator | null>(
    report.indicators.find((i) => i.evaluated) || report.indicators[0] || null
  );
  const [showRuleModal, setShowRuleModal] = useState(false);

  function handlePrint() {
    window.print();
  }

  const isCompleted = report.attempt.status === "COMPLETED";
  const formattedDate = report.attempt.completedAt
    ? new Date(report.attempt.completedAt).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR", {
        timeZone: "Africa/Casablanca",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date(report.attempt.startedAt).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR", {
        timeZone: "Africa/Casablanca",
        day: "numeric",
        month: "long",
        year: "numeric",
      });

  return (
    <div className="min-h-screen bg-canvas text-slate-800 pb-20 print:bg-white print:pb-0">
      {/* Top Banner (Hidden in print) */}
      <div className="bg-brand-blue-950 text-white py-4 px-6 border-b border-slate-800 print:hidden">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={isAdminView ? "/admin/reports" : "/espace"}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-blue-700/30 text-brand-blue-300 border border-brand-blue-400/30">
                  {isAdminView ? t("report.badge_admin") : t("report.badge_student")}
                </span>
                <span className="text-xs text-slate-400 font-mono">{report.participant.publicId}</span>
              </div>
              <h1 className="text-sm sm:text-base font-extrabold text-white mt-0.5">
                {lang === "ar"
                  ? `تقرير المهارات السلوكية — ${report.participant.displayName}`
                  : `Bilan Soft Skills — ${report.participant.displayName}`}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              id="btn-print-report"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue-700 hover:bg-brand-blue-800 text-white text-xs font-bold shadow-md shadow-brand-blue-700/25 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{t("report.print")}</span>
            </button>
          </div>
        </div>
      </div>

      <main data-report-root className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 space-y-8 print:p-0 print:max-w-none">
        {/* Printable Official Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 print:border-none print:shadow-none print:p-0">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-brand-blue-50 text-brand-blue-700 text-xs font-extrabold tracking-wide uppercase border border-brand-blue-100">
                SkillQuest · Chabab Connect
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  isCompleted
                    ? "bg-brand-green-50 text-brand-green-700 border-brand-green-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {isCompleted
                  ? lang === "ar"
                    ? "✓ مسار مكتمل بنجاح"
                    : "✓ Mission complétée"
                  : lang === "ar"
                  ? "قيد الإنجاز"
                  : "En cours"}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-brand-blue-950 tracking-tight">
              {report.participant.displayName}
            </h2>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-brand-blue-700" />
                <span>
                  {lang === "ar" ? "المهمة : " : "Mission : "}
                  <strong>{localize(report.mission.title, lang)}</strong>
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>{formattedDate}</span>
              </span>
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {report.attempt.totalDecisions} {t("report.decisions_count")}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end justify-center border-t md:border-t-0 md:border-l rtl:md:border-l-0 rtl:md:border-r border-slate-100 pt-4 md:pt-0 md:px-6 text-xs text-slate-400">
            <div className="font-mono text-[11px] text-slate-500">ID : {report.participant.publicId}</div>
            <div className="text-[11px]">{localize(report.session.assessmentTitle, lang)}</div>
            <div className="text-[11px]">{localize(report.session.label, lang)}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-brand-blue-200 bg-brand-blue-50 p-5 text-sm leading-relaxed" role="note">
          {!isCompleted && <p className="font-bold">{lang === "ar" ? "تقرير مؤقت — المسار غير مكتمل" : "Bilan provisoire — parcours non terminé"}</p>}
          <p>{localize(report.methodologyNote, lang)}</p>
          {report.historicalNotice && <p className="mt-2 text-amber-900">{lang === "ar" ? "أُعيد بناء النسخة القديمة من البيانات المتاحة عند التحديث. لا يمكن استعادة التعديلات السابقة." : report.historicalNotice}</p>}
        </div>
        {/* Section 1 : Profil Soft Skills Clé */}
        {(() => {
          const prof =
            lang === "ar" && profileArabicTranslations[report.profile.title]
              ? profileArabicTranslations[report.profile.title]
              : {
                  title: report.profile.title,
                  tagline: report.profile.tagline,
                  description: report.profile.description,
                  ruleExplanation: report.profile.ruleExplanation,
                };

          return (
            <div className="rounded-3xl bg-gradient-to-br from-brand-blue-950 via-[#1a2b50] to-brand-blue-950 text-white p-6 sm:p-8 shadow-xl relative overflow-hidden print:bg-none print:text-brand-blue-950 print:border print:border-slate-300 print:shadow-none">
              <div className="relative z-10 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-brand-blue-500/30 flex items-center justify-center border border-brand-blue-400/30 text-amber-300">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-brand-blue-200">
                      {t("report.profile_identified")}
                    </span>
                  </div>

                  <button
                    onClick={() => setShowRuleModal(!showRuleModal)}
                    className="text-xs font-semibold text-brand-blue-300 hover:text-white underline transition-colors print:hidden cursor-pointer"
                  >
                    {lang === "ar" ? "كيف تم استنتاج هذا الملف؟" : "Comment ce profil est-il calculé ?"}
                  </button>
                </div>

                <div>
                  <h3 className="text-2xl sm:text-3xl font-black text-white print:text-brand-blue-950 tracking-tight">
                    {prof.title}
                  </h3>
                  <p className="text-sm text-brand-blue-200 print:text-slate-600 font-semibold mt-1">
                    {prof.tagline}
                  </p>
                </div>

                <p className="text-xs sm:text-sm text-slate-300 print:text-slate-700 leading-relaxed max-w-3xl">
                  {prof.description}
                </p>

                {/* Dominant Competencies Tags */}
                {report.profile.dominantCompetencies.length > 0 && (
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {lang === "ar" ? "المهارات المحركة :" : "Compétences motrices :"}
                    </span>
                    {report.profile.dominantCompetencies.map((comp, idx) => {
                      const foundSlug = Object.keys(competencyArabicNames).find(
                        (k) => comp.toLowerCase().includes(k) || comp.includes("équipe") && k === "travail-en-equipe" || comp.includes("problème") && k === "resolution-de-problemes"
                      );
                      const displayComp = (lang === "ar" && foundSlug ? competencyArabicNames[foundSlug] : null) || comp;

                      return (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-xl bg-white/10 text-white print:bg-slate-100 print:text-slate-800 text-xs font-bold border border-white/20 print:border-slate-200"
                        >
                          ★ {displayComp}
                        </span>
                      );
                    })}
                  </div>
                )}

                {showRuleModal && (
                  <div className="p-4 rounded-2xl bg-white/10 border border-white/15 text-xs text-brand-blue-100 space-y-1.5 animate-in fade-in duration-150 print:block print:bg-slate-50 print:text-slate-700">
                    <div className="font-bold flex items-center gap-1.5 text-white print:text-brand-blue-950">
                      <ShieldCheck className="w-4 h-4 text-brand-green-400" />
                      <span>
                        {lang === "ar" ? "قاعدة التحليل الخوارزمية :" : "Règle algorithmique transparente :"}
                      </span>
                    </div>
                    <p>{lang === "ar" ? "تُحسب المتوسطات على مقياس من −3 إلى +3. يتطلب استنتاج اتجاه أربعة قرارات على الأقل وملاحظتين لكل مهارة معنية. لا تمثل هذه القواعد اختباراً نفسياً مقنناً." : report.profile.ruleExplanation}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* SECTION CRUCIALE : POINTS POSITIFS ET POINTS NÉGATIFS (DEMANDE UTILISATEUR) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 🟢 POINTS POSITIFS (Ce que vous avez bien fait) */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border-2 border-brand-green-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-brand-green-700 pb-3 border-b border-brand-green-100">
              <div className="w-10 h-10 rounded-2xl bg-brand-green-50 flex items-center justify-center font-bold">
                <ThumbsUp className="w-5 h-5 text-brand-green-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-brand-blue-950">
                  {t("report.positives_title")}
                </h3>
                <span className="text-[11px] font-bold text-brand-green-600">
                  {lang === "ar" ? "سلوكيات مميزة وقرارات حكيمة" : "Tendances constructives observées"}
                </span>
              </div>
            </div>

            {report.strengths.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">
                {lang === "ar"
                  ? "لم تسجل أي مهارة مؤشراً إيجابياً مرتفعاً في هذه المحاولة."
                  : "Aucune compétence n'a enregistré de score positif marqué dans cette tentative."}
              </p>
            ) : (
              <div className="space-y-3">
                {report.strengths.map((s, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-brand-green-50/70 border border-brand-green-200/80 space-y-1"
                  >
                    <span className="text-xs font-black text-brand-green-950 uppercase tracking-wider block">
                      ★ {localize(s.competency, lang)}
                    </span>
                    <p className="text-xs text-brand-green-900 leading-relaxed font-medium">
                      {translateInterpretation(s.summary, lang)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 🔴 POINTS NÉGATIFS / VIGILANCES (Ce qu'il faut corriger) */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border-2 border-amber-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-amber-700 pb-3 border-b border-amber-100">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center font-bold">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-brand-blue-950">
                  {t("report.negatives_title")}
                </h3>
                <span className="text-[11px] font-bold text-amber-600">
                  {lang === "ar" ? "أخطاء في اتخاذ القرار وتنبيهات للتطوير" : "Points de vigilance & opportunités d'amélioration"}
                </span>
              </div>
            </div>

            {report.improvements.length === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-50 text-xs text-slate-500">
                {lang === "ar"
                  ? "لم يُلاحظ تأثير سلبي في هذا المسار. هذا لا يثبت إتقان المهارات بشكل عام."
                  : "Aucun impact négatif observé dans ce parcours. Cela ne permet pas de conclure à une maîtrise générale."}
              </div>
            ) : (
              <div className="space-y-3">
                {report.improvements.map((imp, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-1"
                  >
                    <span className="text-xs font-black text-amber-950 uppercase tracking-wider block">
                      ⚠ {localize(imp.competency, lang)}
                    </span>
                    <p className="text-xs text-amber-900 leading-relaxed font-medium">
                      {translateInterpretation(imp.summary, lang)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section 2 : Indicateurs des Soft Skills */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-brand-blue-700" />
              <h3 className="text-lg font-black text-brand-blue-950">
                {t("report.radar_title")}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "ar"
                ? "متوسط التأثير لكل قرار ملاحظ، من −3 إلى +3. يمثل وسط الشريط الصفر، والمهارة غير الملاحظة لا تملك نتيجة."
                : "Moyenne des impacts par décision observée, de −3 à +3. Le milieu de la barre représente 0. Une compétence non observée n’a pas de score."}
            </p>
          </div>

          {/* Bar Chart Visualization */}
          <div className="space-y-4">
            {report.indicators.map((indicator) => {
              const val = indicator.averageValue;
              const isSelected = selectedCompetency?.slug === indicator.slug;
              const normalized = Math.min(Math.max(val, -3), 3);
              const percentage = Math.round(((normalized + 3) / 6) * 100);
              const displayLabel = lang === "ar" ? competencyArabicNames[indicator.slug] || localize(indicator.label, lang) : localize(indicator.label, lang);

              return (
                <div
                  key={indicator.slug}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${displayLabel}: ${indicator.evaluated ? val.toFixed(2) : t("report.neutral")}`}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCompetency(indicator); } }}
                  onClick={() => setSelectedCompetency(indicator)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? "border-brand-blue-700 bg-brand-blue-50/30 shadow-sm"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold mb-2">
                    <span className="text-slate-800 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand-blue-700" />
                      <span>{displayLabel}</span>
                    </span>
                    <span
                      className={`font-black px-2 py-0.5 rounded-md ${
                        val > 0
                          ? "bg-brand-green-50 text-brand-green-700"
                          : val < 0
                          ? "bg-rose-50 text-rose-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {indicator.evaluated ? `${val > 0 ? "+" : ""}${val.toFixed(2)} / 3` : t("report.neutral")}
                    </span>
                  </div>

                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        val > 0 ? "bg-brand-green-500" : val < 0 ? "bg-rose-500" : "bg-slate-300"
                      }`}
                      style={{ width: `${indicator.evaluated ? percentage : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Competency Detail View */}
          {selectedCompetency && (
            <div className="mt-6 p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-brand-blue-700" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-brand-blue-950">
                    {lang === "ar"
                      ? `تفاصيل المهارة: ${localize(selectedCompetency.label, lang)}`
                      : `Détail de la compétence : ${localize(selectedCompetency.label, lang)}`}
                  </h4>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-700">
                <span className="font-bold text-brand-blue-950 block mb-1">
                  {lang === "ar" ? "التحليل السلوكي :" : "Interprétation pédagogique :"}
                </span>
                {translateInterpretation(selectedCompetency.pedagogicalInterpretation, lang)}
              </div>
            </div>
          )}
        </div>

        {/* Section 3 : Recommandations Pratiques */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-brand-blue-700">
            <Lightbulb className="w-5 h-5 shrink-0" />
            <h3 className="text-base font-extrabold text-brand-blue-950">
              {t("report.recommendations_title")}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="p-4 rounded-2xl bg-brand-blue-50/40 border border-brand-blue-100 space-y-1.5"
              >
                <span className="text-xs font-black text-brand-blue-700 block">
                  💡 {localize(rec.title, lang)}
                </span>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {localize(rec.action, lang)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4 : Chronologie complète des décisions */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-black text-brand-blue-950">
              {t("report.timeline_title")}
            </h3>
            <span className="text-xs font-bold text-slate-400">
              {report.decisionTimeline.length} {lang === "ar" ? "محطات" : "étapes"}
            </span>
          </div>

          <div className="space-y-3">
            {report.decisionTimeline.map((step) => (
              <div
                key={step.stepIndex}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 text-xs space-y-2"
              >
                <div className="flex items-center justify-between font-bold text-brand-blue-950">
                  <span>
                    {lang === "ar" ? `الموقف ${step.stepIndex}` : `Situation ${step.stepIndex}`} : {localize(step.nodeTitle, lang)}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200 font-semibold text-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase mb-0.5">
                    {lang === "ar" ? "القرار الذي اتخذته :" : "Option choisie :"}
                  </span>
                  &quot;{localize(step.chosenOption, lang)}&quot;
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
