export type EmailVerificationStatus = "PENDING" | "SENT" | "UNCERTAIN" | "UNAVAILABLE" | "INVALID" | "EXPIRED" | "VERIFIED" | "LIMIT_REACHED";
export interface EmailVerificationInfo { verificationStatus: EmailVerificationStatus; challengeId?: string; expiresAt?: string; resendAfterSeconds?: number }
const states: EmailVerificationStatus[] = ["PENDING", "SENT", "UNCERTAIN", "UNAVAILABLE", "INVALID", "EXPIRED", "VERIFIED", "LIMIT_REACHED"];
export function parseEmailVerification(value: unknown): EmailVerificationInfo | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (!states.includes(data.verificationStatus as EmailVerificationStatus)) return null;
  return { verificationStatus: data.verificationStatus as EmailVerificationStatus,
    ...(typeof data.challengeId === "string" ? { challengeId: data.challengeId } : {}),
    ...(typeof data.expiresAt === "string" ? { expiresAt: data.expiresAt } : {}),
    ...(typeof data.resendAfterSeconds === "number" ? { resendAfterSeconds: Math.max(0, Math.min(600, data.resendAfterSeconds)) } : {}) };
}
export function verificationCopy(state: EmailVerificationStatus, language: string): string {
  const copy: Record<EmailVerificationStatus, [string, string]> = {
    PENDING: ["Envoi du code en attente. Vous pourrez le saisir dès sa réception.", "إرسال الرمز قيد الانتظار. يمكنك إدخاله فور تلقيه."],
    SENT: ["Code envoyé. Consultez votre boîte e-mail et les courriers indésirables.", "أُرسل الرمز. تحقق من بريدك والرسائل غير المرغوب فيها."],
    UNCERTAIN: ["Envoi non confirmé. Un code reçu reste valable ; nous évitons de vous envoyer des doublons.", "الإرسال غير مؤكد. يبقى الرمز الذي تلقيته صالحا؛ نتجنب إرسال نسخ مكررة."],
    UNAVAILABLE: ["Envoi indisponible. Réessayez plus tard ; aucun accès n’a été accordé.", "الإرسال غير متاح. حاول لاحقا؛ لم يُمنح أي وصول للاختبار."],
    INVALID: ["Code incorrect ou déjà utilisé. Vérifiez-le ou demandez un nouveau code.", "الرمز غير صحيح أو سبق استعماله. تحقق منه أو اطلب رمزا جديدا."],
    EXPIRED: ["Code expiré. Demandez un nouveau code.", "انتهت صلاحية الرمز. اطلب رمزا جديدا."],
    VERIFIED: ["Adresse e-mail vérifiée.", "تم تأكيد عنوان البريد الإلكتروني."],
    LIMIT_REACHED: ["Limite de demandes ou d’essais atteinte. Respectez le délai indiqué avant de réessayer.", "تم بلوغ حد الطلبات أو المحاولات. انتظر المدة المحددة قبل المحاولة مجددا."],
  };
  return copy[state][language === "ar" ? 1 : 0];
}
export function normalizeOtpDigits(value: string): string {
  return value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/\D/g, "").slice(0, 6);
}
