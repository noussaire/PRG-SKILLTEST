import { setTimeout as delay } from "node:timers/promises";
import type { Response } from "express";
import { ReportEmailError } from "./brevo.service.js";
import { reportPdfRenderer } from "./report-pdf.service.js";

export const PDF_DOWNLOAD_WAIT_MS = 20000;
export const PDF_DOWNLOAD_RENDER_MS = 30000;
export const PDF_DOWNLOAD_MAX_PENDING = 5; // one active download + four waiting
export const PDF_DOWNLOAD_MAX_POLLS = 48;

// Instance-local admission only: no global/serverless semaphore is claimed.
// All channels still share the underlying renderer's one-browser lock in this
// process. Email workers retain their durable retry/lease policy, without waiting here.
export function createPdfDownloads(options: {
  renderer?: Pick<typeof reportPdfRenderer, "render">;
  waitMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
} = {}) {
  const tickets: symbol[] = [];
  const waitMs = options.waitMs ?? PDF_DOWNLOAD_WAIT_MS;
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > PDF_DOWNLOAD_WAIT_MS) throw Error("PDF_WAIT_BUDGET_INVALID");
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const renderer = options.renderer ?? reportPdfRenderer;
  return {
    snapshot: () => ({ pending: tickets.length }),
    async render(row: Parameters<typeof reportPdfRenderer.render>[0], job: Parameters<typeof reportPdfRenderer.render>[1], language?: "fr" | "ar", signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (tickets.length >= PDF_DOWNLOAD_MAX_PENDING) throw new ReportEmailError("REPORT_PDF_QUEUE_FULL", true, 2);
      const ticket = Symbol(); tickets.push(ticket);
      const deadline = performance.now() + waitMs;
      try {
        for (let poll = 0; poll < PDF_DOWNLOAD_MAX_POLLS; poll++) {
          signal?.throwIfAborted();
          if (performance.now() >= deadline) break;
          if (tickets[0] === ticket) {
            try {
              return await renderer.render(row, job, language, { renderTimeoutMs: PDF_DOWNLOAD_RENDER_MS });
            } catch (error) {
              // BUSY means no Chromium was launched by this call. Never retry
              // timeouts, cleanup failures, invalid PDFs or actual render failures here.
              if (!(error instanceof ReportEmailError) || error.code !== "REPORT_PDF_BUSY") throw error;
            }
          }
          const remaining = deadline - performance.now();
          if (remaining <= 0) break;
          await sleep(Math.min(remaining, 50 * 2 ** Math.min(poll, 4)), signal);
        }
        throw new ReportEmailError("REPORT_PDF_WAIT_TIMEOUT", true, 2);
      } finally {
        const index = tickets.indexOf(ticket);
        if (index !== -1) tickets.splice(index, 1);
      }
    },
  };
}

export const pdfDownloads = createPdfDownloads();

// Keep stable public PDF_UNAVAILABLE while exposing a safe, actionable reason.
export function pdfDownloadFailure(error: unknown) {
  const issue = error instanceof ReportEmailError && error.code.startsWith("REPORT_PDF_") ? error : undefined;
  const retryable = issue?.retryable ?? false;
  return { status: retryable ? 503 : 500, retryAfter: retryable ? issue?.retryAfterSeconds : undefined,
    body: { error: "Génération du PDF indisponible. Réessayez ultérieurement.", code: "PDF_UNAVAILABLE", reason: issue?.code ?? "REPORT_PDF_UNAVAILABLE", retryable } };
}

export async function downloadPdf(res: Response, row: Parameters<typeof pdfDownloads.render>[0], job: Parameters<typeof pdfDownloads.render>[1], language?: "fr" | "ar") {
  const abort = new AbortController();
  const onClose = () => abort.abort();
  res.once("close", onClose);
  try { return await pdfDownloads.render(row, job, language, abort.signal); }
  finally { res.off("close", onClose); }
}
