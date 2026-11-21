"use client";
import { PdfDownloadButton } from "@/components/pdf-download-button";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { PathwaySteps } from "@/components/pathway-steps";
import { ReportSummaryAction } from "@/components/report-summary-action";
import { ReportEmailStatus } from "@/components/report-email-status";
import { ArrowRight, BrainCircuit, Check, CheckCircle2, LoaderCircle, MessageCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import type { AdaptiveConfig, AdaptiveInterview } from "@/lib/adaptive-types";
import { parseEmailVerification, verificationCopy, normalizeOtpDigits, type EmailVerificationInfo } from "@/lib/email-verification";

class RequestError extends Error {
  constructor(message: string, public status: number, public code = "", public retryAfterSeconds = 0, public verification: EmailVerificationInfo | null = null) { super(message); }
}

async function apiRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/adaptive/${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const retry = Number(data.retryAfterSeconds ?? response.headers.get("retry-after"));
    throw new RequestError(data.error || "Service temporairement indisponible.", response.status, data.code || "", response.status === 429 && Number.isFinite(retry) ? Math.max(0, Math.min(86400, retry)) : 0, parseEmailVerification(data));
  }
  return data as T;
}

export default function AdaptiveInterviewPage() {
  const { lang } = useLanguage();
  const ar = lang === "ar";
  function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return apiRequest<T>(`${path}${path.includes("?") ? "&" : "?"}lang=${lang}`, method, body);
  }
  const [config, setConfig] = useState<AdaptiveConfig | null>(null);
  const [interview, setInterview] = useState<AdaptiveInterview | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verification, setVerification] = useState<EmailVerificationInfo | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [answer, setAnswer] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const retryTime = [Math.floor(retrySeconds / 3600), Math.floor(retrySeconds % 3600 / 60), retrySeconds % 60].map(value => String(value).padStart(2, "0")).join(":");

  // A provider response belongs to the language of its request. Keep the code
  // form and saved answers when switching language, but discard stale copy.
  useEffect(() => { setError(null); }, [lang]);

  function showFailure(err: unknown) {
    if (err instanceof RequestError && err.retryAfterSeconds > 0) {
      const current = Date.now(), deadline = current + err.retryAfterSeconds * 1000;
      setNow(current); setRetryAt(deadline);
      try { sessionStorage.setItem("sq_interview_retry_at", String(deadline)); } catch { /* optional */ }
    }
    setError(err instanceof RequestError && err.verification && err.code !== "RETAKE_COOLDOWN" ? null : err instanceof Error ? err.message : "Service temporairement indisponible.");
  }

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem("sq_interview_retry_at"));
      if (saved > Date.now() && saved <= Date.now() + 86400000) { setNow(Date.now()); setRetryAt(saved); }
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    if (!retryAt && !resendAt) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (retryAt && current >= retryAt) {
        setRetryAt(0);
        try { sessionStorage.removeItem("sq_interview_retry_at"); } catch { /* optional */ }
      }
      if (resendAt && current >= resendAt) setResendAt(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt, resendAt]);

  function updateVerification(value: EmailVerificationInfo) {
    setVerification(previous => ({ ...previous, ...value }));
    if (value.resendAfterSeconds !== undefined) { const current = Date.now(); setNow(current); setResendAt(current + value.resendAfterSeconds * 1000); }
  }

  useEffect(() => {
    const id = verification?.challengeId;
    if (!id || interview || !["PENDING", "SENT", "UNCERTAIN"].includes(verification.verificationStatus)) return;
    let active = true;
    const refreshStatus = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await request<unknown>(`email-verification?challenge=${encodeURIComponent(id)}`);
        const info = parseEmailVerification(data);
        if (active && info) updateVerification(info);
      } catch { /* Keep the usable code and entered form when status is unavailable. */ }
    };
    const timer = setInterval(() => { void refreshStatus(); }, 10000);
    void refreshStatus();
    return () => { active = false; clearInterval(timer); };
  }, [verification?.challengeId, verification?.verificationStatus, interview, lang]);

  useEffect(() => {
    let active = true;
    request<AdaptiveConfig>(`config?lang=${lang}`).then(data => {
      if (active) {
        setConfig(data);
        if (data.mode?.startsWith("prepared-")) {
          setRetryAt(0);
          try { sessionStorage.removeItem("sq_interview_retry_at"); } catch { /* obsolete AI-question cooldown */ }
        }
      }
    }).catch(err => { if (active) showFailure(err); });
    return () => { active = false; };
  }, [lang, refresh]);

  useEffect(() => {
    let active = true;
    request<AdaptiveInterview | null>("me").then(async data => {
      if (active) { setInterview(data); }
      if (active && data?.currentQuestion && (data.mode === "legacy-ai" || !data.currentQuestion.choices?.length)) {
        const prepared = await request<AdaptiveInterview>("choices", "POST", { questionId: data.currentQuestion.id });
        if (active) setInterview(prepared);
      }
    }).catch(err => {
      if (!active) return;
      if (err instanceof RequestError && err.status === 401) { setInterview(null); ; }
      else showFailure(err);
    }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [refresh, lang]);

  const reportStatus = interview?.report?.aiStatus;
  const emailStatus = interview?.report?.emailStatus;
  useEffect(() => {
    if (!interview?.report || !["PENDING", "PROCESSING", "RETRY"].includes(reportStatus ?? "") && !["PENDING", "PROCESSING", "RETRY"].includes(emailStatus ?? "")) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void request<AdaptiveInterview | null>("me").then(data => { if (active && data) setInterview(data); }).catch(() => { /* The complete local report remains available. */ });
    }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [interview?.id, reportStatus, emailStatus, lang]);

  const questionId = interview?.currentQuestion?.id;
  useEffect(() => {
    try {
      const saved = questionId ? sessionStorage.getItem(`sq_interview_choice_${questionId}`) : null;
      setAnswer(saved && interview?.currentQuestion?.choices?.some(choice => choice.id === saved) ? saved : "");
    }
    catch { setAnswer(""); }
  }, [questionId]);

  function updateAnswer(value: string) {
    setAnswer(value);
    try { if (questionId) sessionStorage.setItem(`sq_interview_choice_${questionId}`, value); } catch { /* The form remains usable without browser storage. */ }
  }

  async function start(event: FormEvent, requestCodeOnly = false) {
    event.preventDefault();
    if (busy || retrySeconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await request<AdaptiveInterview>("start", "POST", { fullName: name.trim(), email: email.trim(), language: lang, consent, adult, emailReport: true,
        ...(verification?.challengeId ? { challengeId: verification.challengeId } : {}), ...(requestCodeOnly ? { requestNewCode: true } : {}), ...(!requestCodeOnly && verificationCode ? { verificationCode } : {}) });
      setInterview(data);
      setVerificationRequired(false);
      setVerificationCode("");
      setVerification({ verificationStatus: "VERIFIED" });
    } catch (err) {
      if (err instanceof RequestError && err.status === 401) setInterview(null);
      else {
        if (err instanceof RequestError && err.verification) { setVerificationRequired(true); updateVerification(err.verification); }
        else if (err instanceof RequestError && ["RETAKE_VERIFICATION_REQUIRED", "RETAKE_CODE_INVALID"].includes(err.code)) setVerificationRequired(true);
        showFailure(err);
      }
    }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!questionId || !answer.trim() || busy || retrySeconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await request<AdaptiveInterview>("answer", "POST", { questionId, choiceId: answer });
      setInterview(data);
      try { sessionStorage.removeItem(`sq_interview_choice_${questionId}`); } catch { /* optional selection storage */ }
    } catch (err) {
      // A response can be saved even if the browser loses the server reply.
      // Recover the saved question before offering a retry of the same answer.
      try {
        const latest = await request<AdaptiveInterview | null>("me");
        if (!latest) { setInterview(null); }
        else if (latest.currentQuestion?.id !== questionId) { setInterview(latest); return; }
      } catch (recoveryError) {
        if (recoveryError instanceof RequestError && recoveryError.status === 401) { setInterview(null); ; }
      }
      showFailure(err);
    } finally { setBusy(false); }
  }

  const skills = interview?.skills ?? config?.skills ?? [];
  const currentSkill = skills.find(skill => skill.id === interview?.currentQuestion?.skillId);
  const report = interview?.report;
  const dataDirection = interview?.language === "ar" ? "rtl" : "ltr";
  const levelLabels = ar
    ? ["المعطيات غير كافية", "مهارة تحتاج إلى استكشاف", "في طور التطوير", "نقطة قوة ملاحظة", "نقطة قوة مدعومة في هذا الموقف"]
    : ["Éléments insuffisants", "À explorer", "En développement", "Point fort observé", "Point fort étayé dans cette situation"];

  return (
    <div className="sq-interview mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14" data-adaptive-root data-ui data-state={!interview ? "enrol" : report ? "report" : "question"}>
      <div className="sq-interview-navigation print:hidden">
      <div className="sq-interview-top mb-8 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link href="/entretien" className="text-sm font-semibold text-slate-500 hover:text-brand-blue-600">{ar ? "العودة إلى الاختبارات" : "Retour aux tests"}</Link>
        {interview && <span className="inline-flex items-center gap-2 rounded-full border border-brand-blue-200 bg-brand-blue-50 px-3 py-1.5 text-xs font-bold text-brand-blue-700"><Sparkles size={14} />{ar ? "مقابلة تكيفية · 31 مهارة" : "Entretien adaptatif · 31 soft skills"}</span>}
      </div>

      <PathwaySteps current={!interview ? 2 : interview.report ? 4 : 3} />
      </div>

      {interview && interview.language !== lang && <p role="status" className="mb-5 rounded-xl bg-brand-blue-50 px-4 py-3 text-xs leading-6 text-brand-blue-900 print:hidden">{ar ? "تستمر هذه المقابلة باللغة الفرنسية التي اخترتها عند البداية." : "Cet entretien se poursuit en arabe, la langue choisie au démarrage."}</p>}
      {interview?.emailVerified && <p role="status" className="mb-4 text-sm font-bold text-brand-green-700 print:hidden">{verificationCopy("VERIFIED", lang)}</p>}

      {(error || retrySeconds > 0) && <div role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 print:hidden"><p>{error || (ar ? "يرجى انتظار انتهاء المهلة قبل تأكيد اختيارك. تقدمك محفوظ." : "Patientez avant de valider à nouveau votre choix. Votre progression est conservée.")}</p><button type="button" onClick={() => { setError(null); setRefresh(value => value + 1); }} disabled={busy || retrySeconds > 0} className="mt-3 inline-flex items-center gap-2 font-bold underline disabled:cursor-wait disabled:no-underline"><RefreshCw size={14} />{retrySeconds > 0 ? (ar ? `يمكن إعادة المحاولة بعد ${retryTime}` : `Nouvel essai possible dans ${retryTime}`) : (ar ? "إعادة الاتصال" : "Réessayer la connexion")}</button></div>}

      {restoring ? (
        <div role="status" className="flex min-h-60 items-center justify-center gap-3 text-slate-500"><LoaderCircle className="animate-spin" size={22} />{ar ? "جارٍ البحث عن مقابلة محفوظة…" : "Recherche de votre entretien sauvegardé…"}</div>
      ) : !interview ? (
        <>
          <section className="sq-enrol-layout grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-2">
            <div className="sq-enrol-intro bg-brand-blue-950 p-7 text-white sm:p-10">
              <h1 className="text-3xl font-black leading-tight sm:text-4xl">{ar ? "اختبار المهارات الشخصية" : "Test de soft skills"}</h1>
              <p className="mt-5 text-sm leading-7 text-slate-300">{ar ? "استكشف 31 موقفا معدا مسبقا مع أربعة خيارات في كل مرحلة. تحدد اختياراتك المسار التالي. التقرير الكامل فوري ويمكن للذكاء الاصطناعي إثراء خلاصته لاحقا." : "Explorez 31 situations préparées, avec quatre choix à chaque étape. Vos choix orientent la suite. Le bilan complet est immédiat ; l’IA peut ensuite enrichir sa synthèse."}</p>
              <ul className="mt-7 space-y-3 text-sm text-brand-blue-100">
                {[ar ? "بدون حساب أو رمز جلسة" : "Sans compte ni code de session", ar ? "أربعة خيارات لكل سؤال وحفظ تلقائي" : "Quatre choix par question et sauvegarde automatique", ar ? "تقرير قابل للطباعة أو الحفظ بصيغة PDF" : "Rapport imprimable ou enregistrable en PDF"].map(text => <li key={text} className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand-green-300" />{text}</li>)}
              </ul>
              <p className="mt-8 text-xs leading-6 text-brand-blue-100">{ar ? "هذه أداة للتأمل والتعلّم، وليست اختباراً نفسياً معتمداً أو ترتيباً للطلاب." : "Un outil de réflexion et d’apprentissage : ce parcours ne constitue pas un test psychométrique validé ni un classement des étudiants."}</p>
            </div>
            <form onSubmit={start} className="sq-enrol-form p-7 sm:p-10">
              <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-brand-blue-900 flex items-center justify-between gap-2">
                <span>{ar ? "لديك رمز جلسة من مؤطرك؟" : "Vous avez un code de session ?"}</span>
                <Link href="/rejoindre" className="font-bold underline hover:text-brand-blue-700">
                  {ar ? "الانضمام إلى جلسة" : "Rejoindre une session"} →
                </Link>
              </div>
              <div><p className="text-xs font-bold uppercase tracking-widest text-brand-blue-600">{ar ? "اختبار المهارات الشخصية" : "Test de soft skills"}</p><h2 className="mt-2 text-xl font-extrabold">{ar ? "معلوماتك قبل البدء" : "Vos informations avant de commencer"}</h2><p className="mt-2 text-xs leading-6 text-slate-500">{ar ? "أدخل اسمك الكامل وبريدك الإلكتروني، ثم أكد البريد بالرمز المرسل لبدء الاختبار." : "Indiquez votre nom complet et votre adresse e-mail, puis vérifiez celle-ci avec le code reçu pour commencer le test."}</p></div>
              {!config?.configured && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{config ? (ar ? "المسار غير متاح مؤقتا. الأسئلة لا تحتاج إلى الاتصال بخدمة ذكاء اصطناعي." : "Le parcours est temporairement indisponible. Les questions ne nécessitent pas de connexion à une IA.") : (ar ? "جارٍ التحقق من توفر الخدمة…" : "Vérification de la disponibilité du service…")}</div>}
              <div className="sq-enrol-name"><label htmlFor="interview-name" className="mb-2 block text-sm font-bold">{ar ? "الاسم الكامل" : "Nom complet"}</label><input id="interview-name" name="fullName" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required autoComplete="name" placeholder={ar ? "الاسم الشخصي والعائلي" : "Prénom et nom"} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-brand-blue-500 focus:outline-none focus:ring-2 focus:ring-brand-blue-200" /></div>
              <div className="sq-enrol-email"><label htmlFor="interview-email" className="mb-2 block text-sm font-bold">{ar ? "البريد الإلكتروني" : "Adresse e-mail"}</label><input id="interview-email" name="email" type="email" value={email} onChange={event => { setEmail(event.target.value); setVerificationRequired(false); setVerificationCode(""); setVerification(null); setResendAt(0); }} maxLength={254} required autoComplete="email" inputMode="email" dir="ltr" placeholder="exemple@gmail.com" aria-describedby="interview-email-help" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-brand-blue-500 focus:outline-none focus:ring-2 focus:ring-brand-blue-200" /><p id="interview-email-help" className="mt-2 text-xs leading-6 text-slate-500">{ar ? "يمكن استخدام Gmail أو أي بريد إلكتروني آخر. لا حاجة لإنشاء حساب." : "Gmail ou toute autre adresse e-mail. Aucun compte à créer."}</p></div>
              <p className="text-xs leading-6 text-slate-500">{ar ? "اختبار واحد كل 30 يوما لكل بريد إلكتروني. عند الإعادة، يُطلب رمز تأكيد بالبريد وتُحدّث النتائج في الملف نفسه بعد الإكمال. الحذف متاح للإدارة فقط." : "Un test tous les 30 jours par adresse e-mail. Pour le refaire, un code de confirmation est envoyé par e-mail ; les résultats sont actualisés dans la même fiche à la fin du test. Seule l’administration peut supprimer une participation."}</p>
              {verificationRequired && <div className="rounded-xl border border-brand-blue-200 bg-brand-blue-50 p-4" data-retake-verification>
                <label htmlFor="retake-code" className="mb-2 block text-sm font-bold">{ar ? "رمز التأكيد المرسل بالبريد" : "Code de confirmation reçu par e-mail"}</label>
                <input id="retake-code" name="verificationCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required dir="ltr" value={verificationCode} onChange={event => setVerificationCode(normalizeOtpDigits(event.target.value))} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base tracking-widest" aria-describedby="retake-code-help email-verification-status" aria-invalid={["INVALID", "EXPIRED"].includes(verification?.verificationStatus ?? "")} />
                <p id="retake-code-help" className="mt-2 text-xs leading-6 text-slate-600">{ar ? "الرمز صالح لمدة 10 دقائق. لن يبدأ الاختبار قبل تأكيد البريد. عند إعادة الاختبار، يبقى التقرير السابق محفوظا حتى إكمال المسار الجديد." : "Le code est valable 10 minutes. Le test commence après vérification de l’e-mail. Lors d’une reprise, le rapport précédent reste conservé jusqu’à la fin du nouveau test."}</p>
                {verification && <p id="email-verification-status" data-email-verification-status={verification.verificationStatus} role={["INVALID", "EXPIRED", "LIMIT_REACHED", "UNAVAILABLE"].includes(verification.verificationStatus) ? "alert" : "status"} aria-live="polite" aria-atomic="true" className="mt-3 text-sm leading-6">{verificationCopy(verification.verificationStatus, lang)}</p>}
                <button type="button" disabled={busy || resendSeconds > 0 || retrySeconds > 0 || ["PENDING", "UNCERTAIN"].includes(verification?.verificationStatus ?? "")} onClick={event => { setVerificationCode(""); void start(event, true); }} className="mt-3 min-h-11 text-sm font-bold underline disabled:cursor-not-allowed disabled:opacity-50">{ar ? "طلب رمز جديد" : "Demander un nouveau code"}{resendSeconds > 0 ? ` (${resendSeconds}s)` : ""}</button>
              </div>}
              <label className="flex cursor-pointer items-start gap-3 text-xs leading-6 text-slate-600"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} required className="mt-1.5 h-4 w-4 shrink-0 accent-brand-blue-600" /><span>{ar ? "أؤكد أن عمري 18 سنة أو أكثر." : "Je confirme avoir 18 ans ou plus."}</span></label>
              <label className="flex cursor-pointer items-start gap-3 text-xs leading-6 text-slate-600"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required className="mt-1.5 h-4 w-4 shrink-0 accent-brand-blue-600" /><span>{ar ? "أوافق على حفظ اسمي وبريدي واختياراتي والتقرير واطلاع الإدارة عليها للمتابعة التربوية. تتلقى Groq نتائج ومقتطفات دون بيانات اتصالي لإثراء الخلاصة؛ وتتلقى Brevo بريدي الإلكتروني والتقرير لإرساله إليّ." : "J’accepte l’enregistrement de mon nom, de mon e-mail, de mes choix et du rapport, ainsi que leur consultation par l’administration pour le suivi pédagogique. Groq reçoit des résultats et extraits sans mes coordonnées pour la synthèse IA ; Brevo reçoit mon e-mail et mon rapport pour me l’envoyer."} <Link className="underline" href="/confidentialite">{ar ? "الخصوصية واستخدام البيانات" : "Confidentialité et utilisation des données"}</Link></span></label>
              <button type="submit" disabled={!config?.configured || !consent || !adult || busy || retrySeconds > 0 || name.trim().length < 2 || !email.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green-700 px-5 py-3.5 text-sm font-extrabold text-white transition hover:bg-brand-green-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowRight size={18} className={ar ? "rotate-180" : ""} />}{busy ? (ar ? "جارٍ التحقق…" : "Vérification en cours…") : verificationRequired ? (ar ? "تأكيد البريد وبدء الاختبار" : "Vérifier l’e-mail et commencer") : (ar ? "تلقي رمز التأكيد" : "Recevoir mon code")}</button>
              <p className="text-xs leading-6 text-slate-500">{ar ? "الأسئلة الـ31 لا تعتمد على حصة ذكاء اصطناعي. التقرير الكامل فوري وقد تتأخر الخلاصة الاختيارية فقط. يمكن العودة خلال 7 أيام." : "Les 31 questions fonctionnent sans quota d’IA. Le bilan complet est immédiat ; seule la synthèse IA facultative peut être différée. Reprise possible pendant 7 jours."}</p>
            </form>
          </section>
          <details className="sq-skill-disclosure"><summary>{ar ? "عرض المهارات الـ31" : "Voir les 31 compétences"}</summary><div className="sq-enrol-skill-list">{skills.map(skill => <div key={skill.id}><h3>{skill.label}</h3><p>{skill.description}</p></div>)}</div></details>
        </>
      ) : report ? (
        <section data-adaptive-report>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden"><span className="flex items-center gap-2 text-sm font-bold text-brand-green-700"><CheckCircle2 size={18} />{ar ? "اكتملت المقابلة وحُفظ التقرير" : "Entretien terminé et rapport sauvegardé"}</span><PdfDownloadButton url={`/api/adaptive/me/report?lang=${lang}`} lang={lang} expiresAt={interview.expiresAt} label={ar ? "تحميل تقرير PDF" : "Télécharger le rapport PDF"} className="inline-flex items-center gap-2 rounded-xl bg-brand-green-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-green-800" /></div>
          <ReportSummaryAction key={`${interview.id}:${lang}`} interview={interview} available={config?.aiReportAvailable === true} lang={lang}
            onUpdate={updated => setInterview(current => current?.id === updated.id ? updated : current)} />
          <ReportEmailStatus report={report} lang={lang} />
          {!!report.legacyObservationCount && <p className="mb-4 text-xs leading-6 text-slate-500">{ar ? `${report.legacyObservationCount} إجابات محفوظة من المسار السابق أُبقيت في هذا التقرير.` : `${report.legacyObservationCount} réponses de l’ancien parcours ont été conservées dans ce bilan.`}</p>}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-9" data-adaptive-summary><BrandLogo className="mb-5 w-[160px]" />
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-brand-blue-600">SkillQuest · {ar ? "تقرير استكشافي" : "Rapport exploratoire"}</p><h1 className="text-3xl font-black">{ar ? "تقرير مهاراتك الشخصية" : "Votre rapport de soft skills"}</h1><p className="mt-3 text-sm text-slate-600">{interview.displayName} · {interview.answeredCount}/{interview.totalQuestions} {ar ? "إجابة" : "réponses"}</p><p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-700" dir={dataDirection}>{report.summary}</p><p className="mt-6 rounded-xl bg-brand-blue-50 p-4 text-xs leading-6 text-brand-blue-900" dir={dataDirection}>{report.disclaimer}</p><p className="mt-4 text-xs leading-6 text-slate-500">{ar ? "كل مؤشر يعتمد على موقف واحد فقط. قد تختلف استجابتك في سياقات أخرى. عدم توفر دليل كافٍ لا يعني انعدام المهارة." : "Chaque indicateur repose sur une seule situation. Votre comportement peut varier dans un autre contexte. Un manque d’éléments ne signifie pas une absence de compétence."}</p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2" dir={dataDirection}>{report.skills.map((skill, index) => <article key={skill.id} className="rounded-2xl border border-slate-200 bg-white p-5" data-adaptive-skill>
            <div className="flex items-start justify-between gap-3"><h2 className="text-base font-extrabold"><span className="me-2 text-brand-blue-400">{index + 1}.</span>{skill.label}</h2><span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${skill.level === null ? "bg-slate-100 text-slate-500" : skill.level >= 3 ? "bg-brand-green-50 text-brand-green-800" : "bg-amber-50 text-amber-800"}`}>{skill.level === null ? "—" : `${skill.level}/4`}</span></div>
            <p className="mt-2 text-xs font-bold text-slate-500">{levelLabels[skill.level ?? 0]}</p><p className="mt-4 text-sm leading-6 text-slate-700">{skill.rationale}</p>
            {skill.evidenceQuote && <blockquote className="mt-4 border-s-2 border-brand-blue-200 ps-3 text-xs italic leading-6 text-slate-500">“{skill.evidenceQuote}”</blockquote>}
            <div className="mt-4 rounded-xl bg-slate-50 p-3"><h3 className="text-xs font-extrabold text-brand-blue-700">{ar ? "خطوة عملية للتقدم" : "Une action pour progresser"}</h3><p className="mt-1 text-xs leading-6 text-slate-600">{skill.advice}</p></div>
            <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">{ar ? "السؤال وإجابتي" : "Revoir la question et ma réponse"}</summary><p className="mt-3 whitespace-pre-wrap leading-6">{skill.question}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-slate-700">{skill.answer}</p></details>
          </article>)}</div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 print:hidden"><p>{ar ? "يمكنك العودة إلى هذا التقرير من نفس المتصفح حتى " : "Rapport accessible dans ce navigateur jusqu’au "}{new Date(interview.expiresAt).toLocaleDateString(ar ? "ar-MA" : "fr-FR")}</p></div>
          {interview.nextTestAllowedAt && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 print:hidden">
            <p>{ar ? "يمكن إعادة الاختبار ابتداء من " : "Vous pourrez refaire le test à partir du "}{new Date(interview.nextTestAllowedAt).toLocaleDateString(ar ? "ar-MA" : "fr-FR")}. {ar ? "الحذف متاح للإدارة فقط." : "La suppression est réservée à l’administration."}</p>
            {Date.now() >= new Date(interview.nextTestAllowedAt).getTime() && <button type="button" className="mt-3 min-h-11 font-bold text-brand-green-700 underline" onClick={() => { setName(interview.displayName); setInterview(null); setError(null); }}>{ar ? "إعادة الاختبار" : "Refaire le test"}</button>}
          </div>}
        </section>
      ) : (
        <section className="sq-question-stage mx-auto max-w-3xl">
          <div className="sq-question-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
            <aside className="sq-question-overview">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-500">{ar ? "مرحباً" : "Bonjour"}, {interview.displayName}</span><span className="flex items-center gap-1.5 text-brand-green-700"><ShieldCheck size={15} />{ar ? "الإجابات السابقة محفوظة" : "Réponses précédentes sauvegardées"}</span></div>
            <div className="mb-2 mt-6 flex justify-between text-xs font-bold text-slate-500"><span>{ar ? "تقدم المقابلة" : "Progression de l’entretien"}</span><span>{interview.answeredCount}/{interview.totalQuestions}</span></div>
            <div role="progressbar" aria-label={ar ? "تقدم المقابلة" : "Progression de l’entretien"} aria-valuemin={0} aria-valuemax={interview.totalQuestions} aria-valuenow={interview.answeredCount} className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-blue-500 transition-all" style={{ width: `${interview.answeredCount / interview.totalQuestions * 100}%` }} /></div>
            <div className="mt-8 flex items-center gap-2 text-xs font-extrabold text-brand-blue-600"><MessageCircle size={17} />{ar ? `السؤال ${interview.answeredCount + 1} من ${interview.totalQuestions}` : `Question ${interview.answeredCount + 1} sur ${interview.totalQuestions}`}</div>
            {interview.currentQuestion?.previousDecision && <aside className="mt-4 rounded-2xl border border-brand-blue-200 bg-brand-blue-50 p-4" dir={dataDirection} data-decision-consequence>
              <p className="text-xs font-extrabold text-brand-blue-700">{ar ? "اختيارك السابق" : "Votre choix précédent"}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{interview.currentQuestion.previousDecision.choiceLabel}</p>
              <p className="mt-3 text-xs font-extrabold text-brand-blue-700">{ar ? "ما يحدث بعده في المحاكاة" : "Ce qui se passe ensuite dans la simulation"}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{interview.currentQuestion.previousDecision.consequence}</p>
            </aside>}
            {currentSkill && <p className="sq-question-skill mt-3 text-xs leading-6 text-slate-500" dir={dataDirection}>{currentSkill.label} · {currentSkill.description}</p>}
            </aside>
            <div className="sq-question-content">
            <h1 className="mt-3 text-xl font-extrabold sm:text-2xl" dir={dataDirection}>{currentSkill?.label}</h1>
            <p className="sq-question-prompt" dir={dataDirection}>{interview.currentQuestion?.prompt ?? interview.currentQuestion?.text}</p>
            <form onSubmit={submit} className="mt-7">
              <fieldset disabled={busy} dir={dataDirection}>
                <legend className="mb-4 text-sm font-bold">{ar ? "اختر التصرف الأقرب إلى ما ستفعله:" : "Choisissez l’action qui vous correspond le mieux :"}</legend>
                <div className="sq-question-choices">
                  {interview.currentQuestion?.choices?.map((choice, index) => (
                    <label key={choice.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-colors ${answer === choice.id ? "border-brand-blue-500 bg-brand-blue-50" : "border-slate-200 bg-white hover:border-brand-blue-300 hover:bg-slate-50"} ${busy ? "cursor-wait opacity-70" : ""}`}>
                      <input type="radio" name="interview-choice" value={choice.id} checked={answer === choice.id} onChange={() => updateAnswer(choice.id)} required className="mt-1 h-4 w-4 shrink-0 accent-brand-blue-600" />
                      <span className="flex-1 text-sm leading-7 text-slate-700"><span className="me-2 font-extrabold text-brand-blue-600">{["A", "B", "C", "D"][index]}.</span>{choice.label}</span>
                    </label>
                  ))}
                  {!interview.currentQuestion?.choices?.length && <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{ar ? "إعداد الخيارات. إذا ظهر خطأ، اضغط إعادة الاتصال." : "Chargement des choix préparés. Si une erreur apparaît, cliquez sur Réessayer la connexion."}</p>}
                </div>
              </fieldset>
              <button type="submit" disabled={busy || retrySeconds > 0 || !interview.currentQuestion?.choices?.some(choice => choice.id === answer)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green-700 px-5 py-3.5 text-sm font-extrabold text-white hover:bg-brand-green-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}{busy ? (ar ? "جارٍ حفظ اختيارك…" : "Sauvegarde de votre choix…") : interview.answeredCount + 1 === interview.totalQuestions ? (ar ? "إنشاء تقريري" : "Générer mon rapport") : (ar ? "تأكيد الاختيار والمتابعة" : "Valider mon choix et continuer")}</button>
              <p role="status" aria-live="polite" className="mt-3 min-h-5 text-center text-xs text-slate-500">{busy ? (ar ? "جارٍ حفظ اختيارك." : "Votre choix est en cours de sauvegarde.") : (ar ? "لن تُرسل الإجابة إلا بعد الضغط على الزر." : "Votre réponse est envoyée uniquement lorsque vous validez.")}</p>
            </form>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>{ar ? "يمكنك التوقف والعودة من هذا المتصفح خلال 7 أيام." : "Vous pouvez faire une pause et revenir dans ce navigateur pendant 7 jours."}</span></div>
        </section>
      )}
    </div>
  );
}

