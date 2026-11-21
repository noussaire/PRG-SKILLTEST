export const PDF_RETRY_MAX_WAIT_MS = 20_000;
export type PdfDownloadPhase = "downloading" | "waiting";
export class PdfDownloadError extends Error {
  constructor(public readonly kind: "auth" | "expired" | "unavailable" | "invalid") { super(kind); }
}

// Reject excessive delays rather than retrying earlier than the server requested.
export function pdfRetryDelay(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  let ms: number;
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else {
    const date = new Date(text);
    // Canonical HTTP-date only; Date.parse alone also accepts ambiguous inputs.
    if (!Number.isFinite(date.getTime()) || date.toUTCString() !== text) return null;
    ms = date.getTime() - now;
  }
  if (!Number.isFinite(ms) || ms < 0 || ms > PDF_RETRY_MAX_WAIT_MS) return null;
  return Math.max(1000, ms);
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchReportPdf(url: string, options: {
  signal: AbortSignal;
  expiresAt?: string;
  onPhase: (phase: PdfDownloadPhase) => void;
}, dependencies: { fetch?: typeof fetch; sleep?: typeof wait; now?: () => number } = {}): Promise<Blob> {
  const request = dependencies.fetch ?? fetch, sleep = dependencies.sleep ?? wait, now = dependencies.now ?? Date.now;
  const check = () => {
    options.signal.throwIfAborted();
    if (options.expiresAt && Date.parse(options.expiresAt) <= now()) throw new PdfDownloadError("expired");
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    check(); options.onPhase("downloading");
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 70_000);
    let retry: number | null = null;
    try {
      const response = await request(url, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new PdfDownloadError("auth");
      if (response.status === 200) {
        if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/pdf") throw new PdfDownloadError("invalid");
        const blob = await response.blob();
        if (await blob.slice(0, 5).text() !== "%PDF-") throw new PdfDownloadError("invalid");
        check(); return blob;
      }
      const data = await response.json().catch(() => ({}));
      const permanentCodes = ["UNAUTHORIZED", "FORBIDDEN", "SESSION_EXPIRED", "REPORT_NOT_READY", "REPORT_PDF_CONFIGURATION", "REPORT_PDF_BROWSER_VERSION"];
      const permanent = data?.retryable === false || permanentCodes.includes(data?.reason) || permanentCodes.includes(data?.code);
      if (attempt === 0 && response.status === 503 && !permanent) retry = pdfRetryDelay(response.headers.get("retry-after"), now());
      if (retry === null) throw new PdfDownloadError("unavailable");
    } finally {
      clearTimeout(timeout); options.signal.removeEventListener("abort", abort);
    }
    check();
    // Do not start a wait that we already know will outlive this participant session.
    if (options.expiresAt && Date.parse(options.expiresAt) <= now() + retry!) throw new PdfDownloadError("expired");
    options.onPhase("waiting"); await sleep(retry!, options.signal);
  }
  throw new PdfDownloadError("unavailable");
}

export const pdfDownloadCopy = {
  fr: {
    waiting: "Votre rapport est en préparation. Le téléchargement reprendra automatiquement.",
    downloading: "Téléchargement du rapport…",
    failed: "Le téléchargement n’a pas abouti. Vous pourrez réessayer plus tard avec ce bouton.",
    auth: "Votre session a expiré ou cet accès n’est plus autorisé. Reconnectez-vous pour télécharger le rapport.",
    success: "Le téléchargement du rapport a été lancé.",
  },
  ar: {
    waiting: "تقريرك قيد الإعداد. سيُستأنف التنزيل تلقائيًا.",
    downloading: "جارٍ تنزيل التقرير…",
    failed: "لم يكتمل التنزيل. يمكنك المحاولة لاحقًا باستخدام هذا الزر.",
    auth: "انتهت صلاحية جلستك أو لم يعد الوصول مسموحًا. سجّل الدخول مجددًا لتنزيل التقرير.",
    success: "بدأ تنزيل التقرير.",
  },
} as const;
