"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import { fetchReportPdf, PdfDownloadError, pdfDownloadCopy, type PdfDownloadPhase } from "@/lib/pdf-download";

export function PdfDownloadButton({ url, lang, label, className, expiresAt }: {
  url: string; lang: "fr" | "ar"; label: string; className: string; expiresAt?: string;
}) {
  const [state, setState] = useState<PdfDownloadPhase | "idle" | "failed" | "auth" | "success">("idle");
  const active = useRef<AbortController | null>(null), descriptionId = useId();
  const copy = pdfDownloadCopy[lang], busy = state === "downloading" || state === "waiting";
  useEffect(() => {
    setState("idle");
    return () => { active.current?.abort(); active.current = null; };
  }, [url, expiresAt]);
  async function download() {
    // Ref lock also blocks a second click before React has committed disabled.
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    try {
      const blob = await fetchReportPdf(url, { signal: controller.signal, expiresAt, onPhase: setState });
      if (controller.signal.aborted) return;
      const href = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = href; link.download = "SkillQuest-rapport.pdf";
      document.body.appendChild(link); link.click(); link.remove();
      // Leave the URL alive long enough for mobile browsers to consume it.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setState("success");
    } catch (error) {
      if (!controller.signal.aborted) setState(error instanceof PdfDownloadError && ["auth", "expired"].includes(error.kind) ? "auth" : "failed");
    } finally { if (active.current === controller) active.current = null; }
  }
  return <div data-pdf-download className="min-w-0 max-w-full" dir={lang === "ar" ? "rtl" : "ltr"}>
    <button type="button" onClick={download} disabled={busy} aria-busy={busy} aria-describedby={descriptionId}
      className={`${className} min-h-[44px] max-w-full whitespace-normal disabled:cursor-wait disabled:opacity-60`}>
      <Download size={18} className="shrink-0" aria-hidden="true" /><span>{label}</span>
    </button>
    <p id={descriptionId} role="status" aria-live="polite" aria-atomic="true" className="mt-2 max-w-sm text-sm leading-relaxed text-slate-700">
      {state === "idle" ? "" : state === "waiting" ? copy.waiting : state === "downloading" ? copy.downloading : state === "auth" ? copy.auth : state === "failed" ? copy.failed : copy.success}
    </p>
  </div>;
}
