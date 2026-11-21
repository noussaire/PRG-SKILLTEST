"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  LoaderCircle,
  Sparkles,
  Compass,
  Lightbulb,
  ShieldCheck,
  History,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type { ParticipantView } from "@/lib/types";
import { useLanguage } from "@/lib/language-context";
import { localize } from "@/lib/localize";

export function MissionRunner({ initial }: { initial: ParticipantView }) {
  const { t, lang, isRtl } = useLanguage();
  const [view, setView] = useState(initial);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const stepNumber = view.attempt.completedDecisions + 1;
  const remaining = view.attempt.remainingQuestions;
  const progress = finishedProgress(view);

  const node = view.attempt.currentNode;
  const finished = view.attempt.status === "COMPLETED";

  async function choose(choiceId: string) {
    if (loading || finished || !view.session.acceptingDecisions) return;
    setLoading(choiceId);
    setError("");

    try {
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choiceId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error ||
            (lang === "ar"
              ? "تعذر تسجيل القرار. يرجى إعادة المحاولة."
              : "Choix non enregistré. Veuillez réessayer."),
        );
      }

      setView(data as ParticipantView);

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : lang === "ar"
            ? "حدث خطأ غير متوقع."
            : "Une erreur inattendue est survenue.",
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 py-10 md:py-16 space-y-6">
      {/* Participant Header Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-brand-blue-700 bg-brand-blue-50 px-2.5 py-0.5 rounded-full border border-brand-blue-100">
              {t("runner.participant_space")}
            </span>
            <span className="text-xs text-slate-400 font-mono font-bold">
              {t("runner.id")} : {view.participant.publicId}
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-black text-brand-blue-950 tracking-tight">
            {t("runner.hello")}, {view.participant.displayName}
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {view.session.label} · {view.session.assessment}
          </p>
        </div>

        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold border ${
              finished
                ? "bg-brand-green-50 text-brand-green-700 border-brand-green-200"
                : "bg-brand-blue-50 text-brand-blue-700 border-brand-blue-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                finished ? "bg-brand-green-500" : "bg-brand-blue-500 animate-pulse"
              }`}
            />
            {finished
              ? t("runner.completed")
              : `${t("runner.step")} ${stepNumber}`}
          </span>
          {!finished && (
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
              <History size={12} /> {t("runner.autosave")}
            </span>
          )}
        </div>
      </div>

      {!finished && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-slate-600">
            {lang === "ar"
              ? `قرارات محفوظة: ${view.attempt.completedDecisions} · مواقف متبقية: ${remaining.min === remaining.max ? remaining.min : `${remaining.min}–${remaining.max}`}`
              : `${view.attempt.completedDecisions} décision(s) enregistrée(s) · ${remaining.min === remaining.max ? remaining.min : `${remaining.min}–${remaining.max}`} situation(s) restante(s) selon vos choix`}
          </p>
          <progress
            className="w-full h-2"
            value={progress}
            max={100}
            aria-label={
              lang === "ar" ? "التقدم التقريبي" : "Progression indicative"
            }
          />
          {!view.session.acceptingDecisions && (
            <p
              role="alert"
              className="rounded-xl bg-amber-50 p-4 text-amber-900"
            >
              {lang === "ar"
                ? "الجلسة مغلقة أو انتهى أجلها. تم حفظ قراراتك السابقة."
                : "La session est fermée ou sa date limite est dépassée. Vos décisions précédentes sont conservées."}
            </p>
          )}
        </div>
      )}
      {/* Main Mission Scenario Container */}
      <div className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-soft transition-all">
        {/* Node Header Banner */}
        <div className="bg-brand-blue-950 px-7 py-6 text-white border-b border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-blue-200">
              {finished ? (
                <CheckCircle2 size={18} className="text-brand-green-400" />
              ) : (
                <CircleHelp size={18} className="text-brand-blue-400" />
              )}
              <span>
                {finished
                  ? lang === "ar"
                    ? "خاتمة السيناريو والنتيجة"
                    : "Dénouement & Conclusion"
                  : lang === "ar"
                    ? "موقف تفاعلي جديد"
                    : "Mise en situation adaptative"}
              </span>
            </div>
            {!finished && (
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">
                {t("runner.decision_needed")}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-white leading-snug">
            {localize(node.title, lang)}
          </h2>
        </div>

        {/* Node Body Content */}
        <div className="space-y-6 p-6 sm:p-9">
          {/* Situation Narrative Story */}
          <div className="rounded-2xl bg-canvas p-6 text-base sm:text-lg leading-8 text-slate-800 border border-slate-200/60 font-medium">
            {localize(node.story, lang)}
          </div>

          {finished ? (
            /* Finished State Banner */
            <div className="rounded-3xl bg-gradient-to-br from-brand-green-50 to-teal-50/50 p-6 sm:p-8 text-brand-green-950 border border-brand-green-200 space-y-4">
              <div className="flex items-center gap-2.5 text-base sm:text-lg font-black text-brand-green-900">
                <Sparkles size={22} className="text-brand-green-600" />
                <span>{t("runner.congratulations")}</span>
              </div>
              <p className="text-sm leading-relaxed text-brand-green-800 font-medium">
                {t("runner.congrats_desc")}
              </p>
              <div className="pt-2">
                <Link
                  href="/mes-resultats"
                  id="btn-view-results"
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-brand-blue-700 hover:bg-brand-blue-800 text-white text-xs sm:text-sm font-black shadow-lg shadow-brand-blue-700/25 transition-all transform active:scale-95"
                >
                  <Sparkles size={18} />
                  <span>{t("runner.see_results")}</span>
                </Link>
              </div>
            </div>
          ) : (
            /* Active Choices & Question */
            <>
              {/* Question Headline */}
              {node.question && (
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-brand-blue-50/60 border border-brand-blue-100">
                  <Lightbulb
                    size={20}
                    className="text-brand-blue-700 shrink-0 mt-0.5"
                  />
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-blue-700 block mb-0.5">
                      {t("runner.choose_option")}
                    </span>
                    <h3 className="text-sm sm:text-base font-extrabold text-brand-blue-950">
                      {localize(node.question, lang)}
                    </h3>
                  </div>
                </div>
              )}

              {/* Choices Options List */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  {lang === "ar"
                    ? `الخيارات المتاحة (${node.choices.length}) :`
                    : `Options disponibles (${node.choices.length}) :`}
                </span>
                {node.choices.map((choice, i) => {
                  const isOptionLoading = loading === choice.id;

                  return (
                    <button
                      data-testid="mission-choice"
                      key={choice.id}
                      onClick={() => choose(choice.id)}
                      disabled={!!loading || !view.session.acceptingDecisions}
                      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 sm:p-5 text-left rtl:text-right transition-all cursor-pointer ${
                        isOptionLoading
                          ? "border-brand-blue-700 bg-brand-blue-50/50 ring-2 ring-brand-blue-700/20"
                          : "border-slate-200 bg-white hover:border-brand-blue-700 hover:bg-brand-blue-50/30 hover:scale-[1.01]"
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-700 group-hover:bg-brand-blue-700 group-hover:text-white transition-colors">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1 text-xs sm:text-sm font-bold text-slate-800 leading-relaxed group-hover:text-brand-blue-950">
                        {localize(choice.label, lang)}
                      </span>
                      {isOptionLoading ? (
                        <LoaderCircle
                          size={18}
                          className="animate-spin text-brand-blue-700 shrink-0"
                        />
                      ) : (
                        <ArrowRight
                          size={18}
                          className={`text-slate-300 group-hover:text-brand-blue-700 transition-colors shrink-0 ${
                            isRtl ? "rotate-180" : ""
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Error Alert */}
          {error && (
            <div
              role="alert"
              className="rounded-2xl bg-red-50 p-4 text-xs font-semibold text-red-700 border border-red-200 flex items-center gap-2"
            >
              <AlertCircle size={18} className="text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer Ethical Notice */}
      <div className="flex items-center justify-center gap-2 text-center text-xs text-slate-500 font-medium">
        <ShieldCheck size={16} className="text-brand-green-600 shrink-0" />
        <p>
          {lang === "ar"
            ? "السيناريوهات مواقف تعليمية تفاعلية لتحفيز التفكير الإيجابي والتعاون، وليست امتحاناً إقصائياً."
            : "Les scénarios sont des exercices de réflexion et d'apprentissage comportemental, sans caractère psychométrique."}
        </p>
      </div>
    </section>
  );
}

function finishedProgress(view: ParticipantView) {
  return view.attempt.status === "COMPLETED"
    ? 100
    : Math.round(
        (view.attempt.completedDecisions /
          Math.max(
            1,
            view.attempt.completedDecisions +
              view.attempt.remainingQuestions.max,
          )) *
          100,
      );
}
