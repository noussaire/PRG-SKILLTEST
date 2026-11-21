"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { adminContent as c } from "@/lib/admin-content";
import type { AdaptiveParticipantDetail } from "@/lib/adaptive-admin-types";
import type { AdminLanguage } from "@/lib/admin-content";

interface Props {
  participantId: string;
  /** aiStatus from participant or report */
  aiStatus: string;
  /** Whether the aiReport feature is globally available (from /api/adaptive/config) */
  available: boolean;
  lang: AdminLanguage;
  /** Called with the refreshed detail after a successful generation */
  onUpdate: (data: AdaptiveParticipantDetail) => void;
}

/**
 * Admin-triggered AI summary generation button.
 * Mirrors the student ReportSummaryAction but calls the admin BFF route and
 * operates with the admin sq_admin cookie — no student token required.
 */
export function AdminSummaryAction({ participantId, aiStatus, available, lang, onUpdate }: Props) {
  const ar = lang === "ar";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"unauthorized" | "failed" | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Countdown timer when in RETRY state or when we imposed a local back-off
  const retryAt = blockedUntil;
  useEffect(() => {
    setNow(Date.now());
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const complete = aiStatus === "COMPLETE";
  const terminal = aiStatus === "UNAVAILABLE";
  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));

  async function generate() {
    if (inFlight.current || !available || complete || terminal || waiting > 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/adaptive/participants/${participantId}/summary?lang=${lang}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
          signal: AbortSignal.timeout(65000),
        }
      );
      if (!mounted.current) return;
      if (response.status === 401) {
        setError("unauthorized");
        return;
      }
      if (!response.ok) {
        const raw = response.headers.get("retry-after");
        const seconds = raw && /^\d+$/.test(raw)
          ? Number(raw)
          : raw ? (Date.parse(raw) - Date.now()) / 1000 : 60;
        setBlockedUntil(Date.now() + Math.max(1, Math.min(86400, Number.isFinite(seconds) ? seconds : 60)) * 1000);
        throw new Error("ADMIN_SUMMARY_REQUEST_FAILED");
      }
      const updated = await response.json() as AdaptiveParticipantDetail;
      if (mounted.current) onUpdate(updated);
    } catch {
      if (mounted.current) {
        setError("failed");
        setBlockedUntil(v => Math.max(v, Date.now() + 60000));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Don't render if already complete or terminal
  if (complete || terminal) return null;

  const statusText = busy
    ? c.generatingSummary[lang]
    : waiting > 0
    ? c.aiRetry[lang].replace("{s}", String(waiting))
    : !available
    ? c.aiUnavailable[lang]
    : aiStatus === "PROCESSING"
    ? c.aiProcessing[lang]
    : ar
    ? "اضغط لإعداد الخلاصة بشكل يدوي."
    : "Cliquez pour générer la synthèse manuellement.";

  const buttonLabel = busy
    ? c.generatingSummary[lang]
    : aiStatus === "PROCESSING"
    ? c.verifySummary[lang]
    : aiStatus === "RETRY" || error
    ? c.retrySummary[lang]
    : c.generateSummary[lang];

  return (
    <div
      className="mb-4 rounded-xl bg-purple-50 p-4 text-sm leading-6 text-purple-900"
      data-admin-summary-action
    >
      <p aria-live="polite" role="status">{statusText}</p>
      {error && (
        <p role="alert" className="mt-2 font-semibold">
          {error === "unauthorized"
            ? (ar ? "انتهت صلاحية جلسة الإدارة. أعد تسجيل الدخول." : "Session administrateur expirée. Reconnectez-vous.")
            : c.summaryFailed[lang]}
        </p>
      )}
      {available && (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || waiting > 0}
          aria-busy={busy}
          data-admin-summary-generate
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles size={16} aria-hidden="true" />
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

