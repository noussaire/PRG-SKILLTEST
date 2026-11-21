"use client";

import { FormEvent, useState, useEffect, useRef } from "react";
import { registrationIntent } from "@/lib/registration-intent";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LoaderCircle, KeyRound, User, AlertCircle, Sparkles } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

export function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang, isRtl } = useLanguage();

  const [name, setName] = useState("");
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const intent = useRef<{ scope: string; id: string } | null>(null);

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c.toUpperCase().trim());
  }, [searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setLoading(true);
    setError("");

    const cleanCode = code.toUpperCase().trim();
    const cleanName = name.trim();

    if (cleanName.length < 2) {
      setError(
        lang === "ar"
          ? "يجب أن يحتوي الاسم على حرفين على الأقل."
          : "Le nom affiché doit contenir au moins 2 caractères."
      );
      setLoading(false);
      return;
    }

    if (cleanCode.length < 6) {
      setError(
        lang === "ar"
          ? "يجب أن يحتوي رمز الجلسة على 6 أحرف على الأقل."
          : "Le code de session doit comporter au moins 6 caractères."
      );
      setLoading(false);
      return;
    }

    try {
      submitting.current = true;
      const scope = JSON.stringify([cleanCode, cleanName.normalize("NFKC").replace(/\s+/g, " "), lang]);
      if (intent.current?.scope !== scope) {
        let storage: Storage | undefined;
        try { storage = window.sessionStorage; } catch { /* Preserve retries in the ref. */ }
        intent.current = { scope, id: await registrationIntent(scope, storage) };
      }
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode, displayName: cleanName, language: lang, registrationId: intent.current.id }),
      });

      const data: { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error ||
            (lang === "ar"
              ? "تعذر الانضمام إلى هذه الجلسة. يرجى التحقق من صحة الرمز."
              : "Impossible de rejoindre cette session. Vérifiez le code.")
        );
      }

      router.push("/entretien/soft-skills");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : lang === "ar"
          ? "حدث خطأ غير متوقع أثناء الاتصال."
          : "Une erreur est survenue lors de la connexion."
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="participant-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1.5">
          <User size={14} className="text-brand-blue-700" />
          <span>{t("join.name_label")} *</span>
        </label>
        <input
          required
          minLength={2}
          maxLength={100}
          id="participant-name"
          autoComplete="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("join.name_placeholder")}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand-blue-700 focus:bg-white focus:ring-4 focus:ring-brand-blue-700/10 transition-all"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          {lang === "ar"
            ? "سيظهر هذا الاسم في بطاقة تقرير مهاراتك النهائي."
            : "Ce nom apparaîtra sur votre rapport de synthèse final."}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="session-code" className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <KeyRound size={14} className="text-brand-blue-700" />
            <span>{t("join.code_label")} *</span>
          </label>

        </div>
        <input
          required
          minLength={6}
          maxLength={32}
          id="session-code"
          autoCapitalize="characters"
          autoComplete="off"
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder={t("join.code_placeholder")}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-black text-slate-800 uppercase tracking-widest outline-none focus:border-brand-blue-700 focus:bg-white focus:ring-4 focus:ring-brand-blue-700/10 transition-all font-mono"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-red-50 p-4 text-xs font-semibold text-red-700 border border-red-200 flex items-center gap-2"
        >
          <AlertCircle size={16} className="text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-blue-700 hover:bg-brand-blue-800 px-5 py-4 font-black text-sm text-white shadow-lg shadow-brand-blue-700/25 transition-all transform active:scale-98 disabled:opacity-60 cursor-pointer"
      >
        {loading ? (
          <>
            <LoaderCircle size={18} className="animate-spin" />
            <span>{t("join.loading")}</span>
          </>
        ) : (
          <>
            <span>{t("join.submit")}</span>
            <ArrowRight size={18} className={isRtl ? "rotate-180" : ""} />
          </>
        )}
      </button>

      <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
        <Sparkles size={14} className="text-brand-blue-700" />
        <span>{t("join.anonymous_hint")}</span>
      </div>
    </form>
  );
}
