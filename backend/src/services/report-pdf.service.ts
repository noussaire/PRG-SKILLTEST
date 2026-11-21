import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { Browser } from "playwright";
import type { AdaptiveInterview, AdaptiveReportJob } from "@prisma/client";
import { buildReportEmail } from "./report-email-template.js";
import { ReportEmailError } from "./brevo.service.js";
import { resolvePdfBrowser, type PdfBrowserRuntime } from "./report-browser.service.js";
import { PDF_RENDER_TIMEOUT_MS, PDF_CLOSE_TIMEOUT_MS } from "./report-limits.js";
export { PDF_RENDER_TIMEOUT_MS, PDF_CLOSE_TIMEOUT_MS } from "./report-limits.js";

let assets: Promise<{
  logo: string;
  cairoLight: string;
  cairoRegular: string;
  cairoSemiBold: string;
  cairoBold: string;
  cairoExtraBold: string;
  regular: string;
  bold: string;
}> | undefined;

async function embeddedAssets() {
  assets ??= Promise.all([
    readFile(new URL("../../assets/skillquest-logo-white.png", import.meta.url)),
    readFile(new URL("../../assets/fonts/Cairo-Light.ttf", import.meta.url)),
    readFile(new URL("../../assets/fonts/Cairo-Regular.ttf", import.meta.url)),
    readFile(new URL("../../assets/fonts/Cairo-SemiBold.ttf", import.meta.url)),
    readFile(new URL("../../assets/fonts/Cairo-Bold.ttf", import.meta.url)),
    readFile(new URL("../../assets/fonts/Cairo-ExtraBold.ttf", import.meta.url)),
  ]).then(([logo, cLight, cRegular, cSemiBold, cBold, cExtraBold]) => {
    const reg = cRegular.toString("base64"), bld = cBold.toString("base64");
    return {
      logo: `data:image/png;base64,${logo.toString("base64")}`,
      cairoLight: cLight.toString("base64"),
      cairoRegular: reg,
      cairoSemiBold: cSemiBold.toString("base64"),
      cairoBold: bld,
      cairoExtraBold: cExtraBold.toString("base64"),
      regular: reg,
      bold: bld,
    };
  }).catch(error => { assets = undefined; throw error; });
  return assets;
}

export async function pdfBrowserOptions() {
  return (await resolvePdfBrowser()).options;
}

export async function printableReportHTML(
  row: Pick<AdaptiveInterview, "id" | "displayName" | "state" | "expiresAt"> & { email?: string | null },
  job: Pick<AdaptiveReportJob, "status" | "summary" | "nextAttemptAt">,
  language?: "fr" | "ar",
) {
  const { logo, cairoLight, cairoRegular, cairoSemiBold, cairoBold, cairoExtraBold } = await embeddedAssets();
  const fontCSS = `
@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${cairoLight}) format('truetype');font-weight:300;font-display:block}
@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${cairoRegular}) format('truetype');font-weight:400;font-display:block}
@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${cairoSemiBold}) format('truetype');font-weight:600;font-display:block}
@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${cairoBold}) format('truetype');font-weight:700;font-display:block}
@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${cairoExtraBold}) format('truetype');font-weight:800;font-display:block}
@font-face{font-family:SkillQuestReport;src:url(data:font/ttf;base64,${cairoRegular}) format('truetype');font-weight:400;font-display:block}
@font-face{font-family:SkillQuestReport;src:url(data:font/ttf;base64,${cairoBold}) format('truetype');font-weight:700;font-display:block}
body{font-family:'Cairo',SkillQuestReport,Tahoma,Arial,sans-serif!important}
  `.trim();
  return buildReportEmail(row, job, { logoDataURL: logo, printable: true, fontCSS, language }).htmlContent.replace("<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`);
}

function normalizePdfTimestamps(pdf: Buffer): Buffer {
  let str = pdf.toString("latin1");
  str = str.replace(/\/CreationDate \([^)]+\)/g, "/CreationDate (D:20260101000000+00'00')");
  str = str.replace(/\/ModDate \([^)]+\)/g, "/ModDate (D:20260101000000+00'00')");
  str = str.replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<00000000000000000000000000000000> <00000000000000000000000000000000>]");
  return Buffer.from(str, "latin1");
}

type Row = Pick<AdaptiveInterview, "id" | "displayName" | "state" | "expiresAt"> & { email?: string | null };
type Job = Pick<AdaptiveReportJob, "status" | "summary" | "nextAttemptAt">;

// Production uses the fixed budgets above. Injectable dependencies/budgets are
// for local qualification only, never HTTP-selected parameters.
export function createReportPdfRenderer(dependencies: {
  runtime?: () => Promise<PdfBrowserRuntime>;
  html?: (row: Row, job: Job, language?: "fr" | "ar") => Promise<string>;
  renderTimeoutMs?: number;
  closeTimeoutMs?: number;
} = {}) {
  let owner: symbol | undefined, quarantined = false;
  let completed = 0, failed = 0, lastDurationMs = 0;
  const renderTimeout = dependencies.renderTimeoutMs ?? PDF_RENDER_TIMEOUT_MS;
  const closeTimeout = dependencies.closeTimeoutMs ?? PDF_CLOSE_TIMEOUT_MS;
  if (!Number.isInteger(renderTimeout) || renderTimeout < 1 || renderTimeout > PDF_RENDER_TIMEOUT_MS ||
      !Number.isInteger(closeTimeout) || closeTimeout < 1 || closeTimeout > PDF_CLOSE_TIMEOUT_MS) throw new Error("PDF_BUDGET_INVALID");
  return {
    snapshot: () => ({ active: owner ? 1 : 0, quarantined, completed, failed, lastDurationMs }),
    async render(row: Row, job: Job, language?: "fr" | "ar", options?: { renderTimeoutMs: number }): Promise<Buffer> {
      // Downloads may shorten the render budget to reserve time for bounded admission.
      const attemptTimeout = options?.renderTimeoutMs ?? renderTimeout;
      if (!Number.isInteger(attemptTimeout) || attemptTimeout < 1 || attemptTimeout > renderTimeout) throw new Error("PDF_BUDGET_INVALID");
      // Immediate backpressure: no unbounded in-memory queue consumes leases.
      if (owner) throw new ReportEmailError("REPORT_PDF_BUSY", true, 15);
      const token = Symbol(); owner = token; const started = performance.now();
      let browser: Browser | undefined, stopped = false, settled = false, closed = false;
      let closing: Promise<boolean> | undefined;
      const releaseIfSafe = () => {
        if (owner === token && (closed || (settled && !browser))) { owner = undefined; quarantined = false; }
      };
      const close = (): Promise<boolean> => {
        if (!browser) return Promise.resolve(true);
        closing ??= Promise.resolve().then(() => browser!.close()).then(() => {
          closed = true; releaseIfSafe(); return true;
        }, () => false);
        return closing;
      };
      const check = () => { if (stopped || performance.now() - started >= attemptTimeout) { stopped = true; throw new ReportEmailError("REPORT_PDF_TIMEOUT", true, 60); } };
      const work = (async () => {
        const effectiveLang: "fr" | "ar" = language === "ar" || language === "fr" ? language : ((row.state as { language?: string })?.language === "ar" ? "ar" : "fr");
        const html = await (dependencies.html ?? printableReportHTML)(row, job, effectiveLang); check();
        const runtime = await (dependencies.runtime ?? resolvePdfBrowser)(); check();
        browser = await runtime.launch({ ...runtime.options, headless: true, timeout: Math.min(15000, attemptTimeout),
          args: [...(runtime.options.args ?? []), "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--no-first-run"] });
        check();
        if (runtime.expectedMajor !== undefined && Number(browser.version().split(".")[0]) !== runtime.expectedMajor) {
          throw new ReportEmailError("REPORT_PDF_BROWSER_VERSION");
        }
      // Participant text is escaped; scripts and all external resources are
      // additionally disabled. The logo and font travel inside the PDF.
      const page = await browser.newPage({ javaScriptEnabled: false, serviceWorkers: "block", offline: true }); check();
      await page.route("**/*", route => route.abort());
      await page.setContent(html, { waitUntil: "load", timeout: Math.min(20000, attemptTimeout) }); check();
      await page.evaluate("document.fonts.ready"); check();
      const ar = effectiveLang === "ar";
      const footerTemplate = `<div style="width:100%;margin:0 39.7pt;font-family:'Cairo',Tahoma,sans-serif;font-size:8pt;color:#8a97a3;display:flex;justify-content:space-between;align-items:center;${ar ? "direction:rtl;" : "direction:ltr;"}"><span>SkillQuest · Association Chabab Connect</span><span><bdi dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></bdi></span></div>`;
      const rawPdf = await page.pdf({ format: "A4", printBackground: true, tagged: true, outline: true,
        margin: { top: "0mm", right: "0mm", bottom: "14mm", left: "0mm" }, displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate,
      });
      check();
      const pdf = normalizePdfTimestamps(rawPdf);
      const structure = pdf.toString("latin1");
      if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || pdf.length > 12 * 1024 * 1024 ||
          !/\/FontFile[23]\b/.test(structure) || !structure.includes("/Subtype /Image") || !structure.includes("/StructTreeRoot")) {
        throw new ReportEmailError("REPORT_PDF_INVALID", true, 60);
      }
      return pdf;
      })();
      // Observe late launch/work completion. A timed-out launch may still yield
      // a browser; close it before releasing this instance's capacity.
      const observe = () => { settled = true; if (stopped) void close(); releaseIfSafe(); };
      void work.then(observe, observe);
      let deadline: ReturnType<typeof setTimeout> | undefined, cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
      let result: Buffer | undefined, failure: ReportEmailError | undefined;
      try {
        result = await Promise.race([work, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => { stopped = true; reject(new ReportEmailError("REPORT_PDF_TIMEOUT", true, 60)); }, attemptTimeout);
        })]);
      } catch (error) { failure = error instanceof ReportEmailError ? error : new ReportEmailError("REPORT_PDF_UNAVAILABLE", true, 60); }
      finally {
        if (deadline) clearTimeout(deadline); stopped = true;
        const cleanup = await Promise.race([close(), new Promise<boolean>(resolve => { cleanupDeadline = setTimeout(() => resolve(false), closeTimeout); })]);
        if (cleanupDeadline) clearTimeout(cleanupDeadline);
        releaseIfSafe();
        if (owner === token) quarantined = true;
        if (!cleanup) failure = new ReportEmailError("REPORT_PDF_CLEANUP", true, 60);
        lastDurationMs = performance.now() - started;
      }
      if (failure) { failed++; throw failure; }
      completed++; return result!;
    },
  };
}

export const reportPdfRenderer = createReportPdfRenderer();
