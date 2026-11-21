import { access, constants } from "node:fs/promises";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { ReportEmailError } from "./brevo.service.js";

export type PdfBrowserRuntime = {
  launch: (options: LaunchOptions) => Promise<Browser>;
  options: LaunchOptions;
  expectedMajor?: number;
};
export const SERVERLESS_CHROMIUM_MAJOR = 153;
let executable: Promise<string> | undefined;

export async function resolvePdfBrowser(): Promise<PdfBrowserRuntime> {
  const mode = process.env.REPORT_PDF_BROWSER_MODE ?? "local";
  if (mode !== "local" && mode !== "serverless") throw new ReportEmailError("REPORT_PDF_CONFIGURATION");
  if (mode === "serverless") {
    // Never silently run a Linux binary on Windows or choose an unqualified
    // architecture. No remote pack URL is accepted or fetched at runtime.
    if (process.platform !== "linux" || process.arch !== "x64" ||
        process.versions.node.split(".")[0] !== "24" || process.env.REPORT_CHROMIUM_EXECUTABLE) {
      throw new ReportEmailError("REPORT_PDF_CONFIGURATION");
    }
    const [{ default: binary }, core] = await Promise.all([
      import("@sparticuz/chromium"), import("playwright-core-serverless"),
    ]);
    executable ??= binary.executablePath().catch(error => { executable = undefined; throw error; });
    return {
      // The adapter uses only the shared launch/newPage/pdf/close API. The
      // independent client keeps Windows Playwright 1.62.1 unchanged.
      launch: async options => await core.chromium.launch(options) as unknown as Browser,
      options: { executablePath: await executable, args: binary.args },
      expectedMajor: SERVERLESS_CHROMIUM_MAJOR,
    };
  }
  const configured = process.env.REPORT_CHROMIUM_EXECUTABLE;
  if (configured) return { launch: options => chromium.launch(options), options: { executablePath: configured } };
  if (process.platform === "win32") {
    for (const file of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) {
      if (await access(file, constants.F_OK).then(() => true, () => false)) {
        return { launch: options => chromium.launch(options), options: { executablePath: file } };
      }
    }
  }
  return { launch: options => chromium.launch(options), options: {} };
}
