import type { AdaptiveInterview, InterviewLanguage } from "@/lib/adaptive-types";

export function ReportEmailStatus({ report, lang }: { report: NonNullable<AdaptiveInterview["report"]>; lang: InterviewLanguage }) {
  const status = report.emailStatus;
  if (!status || status === "NOT_REQUESTED" || status === "DISABLED") return null;
  const ar = lang === "ar";
  const failed = status === "FAILED" || status === "UNKNOWN";
  const message = status === "SENT"
    ? ar ? "أُحيل تقريرك إلى خدمة إرسال البريد الإلكتروني. تحقق من بريدك الوارد ومجلد الرسائل غير المرغوب فيها." : "Votre rapport a été confié au service d’envoi. Vérifiez votre boîte e-mail et vos courriers indésirables."
    : failed
      ? ar ? "لم نتمكن من تأكيد إرسال التقرير بالبريد الإلكتروني. يظل تقريرك متاحا هنا للطباعة أو الحفظ." : "L’envoi du rapport par e-mail n’a pas pu être confirmé. Votre rapport reste disponible ici pour l’imprimer ou le sauvegarder."
      : status === "WAITING_AI"
        ? ar ? "سيُرسل التقرير إلى البريد الإلكتروني الذي أدخلته عندما تصبح خلاصة الذكاء الاصطناعي جاهزة. لا تحتاج إلى إبقاء هذه الصفحة مفتوحة." : "Le rapport sera envoyé à l’adresse renseignée lorsque la synthèse IA sera prête. Vous pouvez fermer cette page."
        : ar ? "إرسال تقريرك بالبريد الإلكتروني قيد التحضير. يمكنك مغادرة هذه الصفحة؛ تقريرك محفوظ." : "L’envoi de votre rapport par e-mail est en préparation. Vous pouvez quitter cette page : votre rapport est sauvegardé.";
  return <p role="status" data-report-email-status className={`mb-4 rounded-lg p-3 text-xs leading-6 print:hidden ${failed ? "bg-amber-50 text-amber-900" : "bg-brand-blue-50 text-brand-blue-900"}`}>{message}</p>;
}
