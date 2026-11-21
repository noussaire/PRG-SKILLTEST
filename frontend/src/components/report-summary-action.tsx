"use client";

import { useEffect, useRef, useState } from "react";
import type { AdaptiveInterview, InterviewLanguage } from "@/lib/adaptive-types";

export function ReportSummaryAction({ interview, available, lang, onUpdate }: {
  interview: AdaptiveInterview; available: boolean; lang: InterviewLanguage;
  onUpdate: (value: AdaptiveInterview) => void;
}) {
  const ar = lang === "ar", report = interview.report;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"expired" | "failed" | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const retryAt = Math.max(blockedUntil, report?.aiStatus === "RETRY" ? Date.parse(report.aiRetryAt ?? "") || 0 : 0);
  useEffect(() => {
    setNow(Date.now());
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= retryAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  if (!report) return null;
  const complete = report.summarySource === "ai" || report.aiStatus === "COMPLETE";
  const terminal = report.aiStatus === "UNAVAILABLE";
  const expired = error === "expired" || Date.parse(interview.expiresAt) <= now;
  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  async function generate() {
    if (inFlight.current || !available || complete || terminal || expired || retryAt > Date.now()) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/adaptive/me/summary?lang=${lang}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        cache: "no-store", signal: AbortSignal.timeout(65000),
      });
      if (!mounted.current) return;
      if (response.status === 401) { setError("expired"); return; }
      if (!response.ok) {
        const raw = response.headers.get("retry-after");
        const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - Date.now()) / 1000 : 60;
        setBlockedUntil(Date.now() + Math.max(1, Math.min(86400, Number.isFinite(seconds) ? seconds : 60)) * 1000);
        throw Error("SUMMARY_REQUEST_FAILED");
      }
      const updated = await response.json() as AdaptiveInterview;
      if (updated.id !== interview.id || updated.language !== lang || !updated.report) throw Error("SUMMARY_RESPONSE_INVALID");
      if (mounted.current) onUpdate(updated);
    } catch {
      if (mounted.current) { setError("failed"); setBlockedUntil(value => Math.max(value, Date.now() + 60000)); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div className="mb-4 rounded-xl bg-brand-blue-50 p-4 text-sm leading-6 text-brand-blue-900" data-ai-report-status>
    <p>{complete
      ? (ar ? "أُضيفت الخلاصة إلى تقريرك. تفاصيل المهارات مبنية على شبكة التصحيح المعدّة." : "La synthèse a été ajoutée à votre rapport. Le détail des compétences reste fondé sur la grille préparée.")
      : (ar ? "تقريرك التربوي الكامل متاح الآن ويمكن حفظه بصيغة PDF." : "Votre bilan pédagogique complet est disponible et peut être enregistré en PDF.")}</p>
    {!complete && <div className="mt-3 print:hidden">
      <p aria-live="polite" role="status">{busy
        ? (ar ? "جارٍ إعداد الخلاصة… يمكنك مواصلة قراءة تقريرك." : "Génération en cours… Vous pouvez continuer à lire votre bilan.")
        : terminal || !available ? (ar ? "إضافة الخلاصة غير متاحة حالياً. يبقى تقريرك محفوظاً." : "L’enrichissement est indisponible. Votre bilan reste sauvegardé.")
        : waiting > 0 ? (ar ? `يمكنك إعادة المحاولة بعد ${waiting} ثانية.` : `Nouvelle tentative possible dans ${waiting} s.`)
        : (ar ? "اضغط لطلب الخلاصة. لن تبدأ أي محاولة تلقائياً." : "Cliquez pour demander la synthèse. Aucune tentative ne démarre automatiquement.")}</p>
      {error && <p role="alert" className="mt-2 font-semibold">{error === "expired"
        ? (ar ? "انتهت صلاحية الوصول. يمكنك حفظ التقرير المعروض بصيغة PDF." : "Votre accès a expiré. Vous pouvez enregistrer le bilan affiché en PDF.")
        : (ar ? "تعذر تأكيد النتيجة. يبقى تقريرك متاحاً؛ انتظر قبل إعادة المحاولة." : "Le résultat n’a pas pu être confirmé. Votre bilan reste disponible ; patientez avant de réessayer.")}</p>}
      {available && !terminal && <button type="button" onClick={() => void generate()} disabled={busy || waiting > 0 || expired}
        aria-busy={busy} data-summary-generate
        className="mt-3 min-h-11 rounded-xl bg-brand-blue-700 px-4 py-2.5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? (ar ? "جارٍ إعداد الخلاصة…" : "Génération en cours…")
          : report.aiStatus === "PROCESSING" ? (ar ? "التحقق من الخلاصة" : "Vérifier la synthèse")
          : report.aiStatus === "RETRY" || error ? (ar ? "إعادة محاولة إعداد الخلاصة" : "Réessayer la synthèse")
          : (ar ? "إعداد الخلاصة" : "Générer la synthèse")}
      </button>}
    </div>}
  </div>;
}
