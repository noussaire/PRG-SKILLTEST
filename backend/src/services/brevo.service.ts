import { z } from "zod";
import { createHash } from "node:crypto";
import { EmailBudget } from "./email-budget.service.js";
import { EmailLimitError } from "./email-limits.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertSyntheticDatabase, stagingConfiguration, syntheticEmail, syntheticName } from "../security/synthetic-staging.js";
import { realProviderAllowed, providerFetch } from "../security/provider-mode.js";
import { logOtpEvent, safeOtpCode, withOtpContext } from "./otp-diagnostic.service.js";

const senderSchema = z.object({
  key: z.string().trim().min(1),
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(100).refine(value => !/[\r\n]/.test(value)),
});

function settings() {
  return senderSchema.safeParse({ key: process.env.BREVO_API_KEY, email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "SkillQuest · Chabab Connect" });
}

export function brevoConfigured(): boolean { return !!stagingConfiguration() || realProviderAllowed("BREVO") && settings().success; }
export function reportEmailConfigured(): boolean { return !!stagingConfiguration() || brevoConfigured(); }

export class ReportEmailError extends Error {
  constructor(public code: string, public retryable = false, public retryAfterSeconds = 60, public uncertain = false) {
    // Provider messages can contain contact details. Keep a safe internal code only.
    super(code);
  }
}

export interface ReportEmailMessage { subject: string; htmlContent: string; attachments?: Array<{ name: string; content: string }> }

type EmailInput = ReportEmailMessage & { recipient: string; recipientName: string; idempotencyKey: string; purpose?: "OTP" | "REPORT"; networkOrigin?: string; reportSourceHash?: string;
  beforeClaim?: (tx: Prisma.TransactionClient, now: Date) => Promise<void> };

export async function sendReportEmail(input: EmailInput, database?: PrismaClient) {
  return withOtpContext({ traceId: input.idempotencyKey }, async () => {
  let providerAccepted = false;
  try {
  const simulated = !!stagingConfiguration();
  if (!simulated && !brevoConfigured()) {
    logOtpEvent("BREVO_SEND_SKIPPED", "disabled", { code: "BREVO_NOT_CONFIGURED", mode: "real" });
    throw new ReportEmailError("BREVO_NOT_CONFIGURED");
  }
  if (!z.string().email().max(254).safeParse(input.recipient).success || !z.string().uuid().safeParse(input.idempotencyKey).success) throw new ReportEmailError("EMAIL_INVALID_RECIPIENT");
  // Generated PDFs can differ in metadata on a retry. The worker supplies the
  // immutable report source hash; HTML and attachment names remain fingerprinted.
  const sourceHash = input.purpose !== "OTP" && z.string().regex(/^[a-f0-9]{64}$/).safeParse(input.reportSourceHash).success ? input.reportSourceHash : undefined;
  const attachments = input.attachments?.map(file => ({ name: file.name, content: sourceHash ?? file.content })) ?? [];
  const requestHash = createHash("sha256").update(JSON.stringify([input.recipient, input.recipientName, input.subject, input.htmlContent, attachments])).digest("hex");
  const prisma = database ?? (await import("../db/prisma.js")).prisma;
  if (simulated) {
    await assertSyntheticDatabase(prisma);
    if (!syntheticEmail(input.recipient) || !syntheticName(input.recipientName)) throw new ReportEmailError("SYNTHETIC_IDENTITY_REQUIRED");
    validateAttachments(input);
  }
  const budget = new EmailBudget(prisma);
  try {
    const claim = await budget.claim({ key: input.idempotencyKey, requestHash, recipient: input.recipient, purpose: input.purpose ?? "REPORT", networkOrigin: input.networkOrigin }, input.beforeClaim);
    if (claim.duplicate) {
      logOtpEvent("BREVO_SEND_SKIPPED", "skipped", { code: "ALREADY_ACCEPTED" });
      return { messageId: null, duplicate: true };
    }
    let accepted: { messageId: string | null; duplicate: boolean };
    try {
      if (simulated) {
        logOtpEvent("BREVO_SEND_SKIPPED", "skipped", { mode: "synthetic", code: "SYNTHETIC_TRANSPORT" });
        if (!stagingConfiguration()) throw new ReportEmailError("BREVO_NOT_CONFIGURED");
        const { simulateEmail } = await import("./synthetic-providers.service.js");
        const result = await simulateEmail(prisma, input);
        if (result.outcome === "RATE_LIMIT") throw new ReportEmailError("BREVO_RATE_LIMIT", true, 60);
        if (result.outcome === "REJECTED") throw new ReportEmailError("BREVO_REJECTED");
        if (result.outcome === "UNCERTAIN") throw new ReportEmailError("BREVO_RESPONSE_UNKNOWN", true, 30, true);
        accepted = { messageId: `synthetic:${input.idempotencyKey}`, duplicate: false };
      } else accepted = await deliverReportEmail(input);
    }
    catch (error) {
      const issue = error instanceof ReportEmailError ? error : new ReportEmailError("BREVO_RESPONSE_UNKNOWN", true, 60, true);
      await budget.finish(claim, { uncertain: issue.uncertain, code: issue.code, retryAfterSeconds: issue.retryAfterSeconds });
      throw issue;
    }
    providerAccepted = true;
    await budget.finish(claim, { accepted: true });
    return accepted;
  } catch (error) {
    if (error instanceof EmailLimitError) {
      logOtpEvent("BREVO_SEND_SKIPPED", "waiting", { code: safeOtpCode(error) });
      throw new ReportEmailError(error.code, true, error.retryAfterSeconds, error.uncertain);
    }
    throw error;
  }
  } catch (error) {
    if (providerAccepted) logOtpEvent(input.purpose === "OTP" ? "OTP_STATUS_PERSIST_FAILED" : "WORKER_FAILED", "uncertain", { code: safeOtpCode(error) });
    else logOtpEvent("BREVO_SEND_FAILED", error instanceof ReportEmailError && error.uncertain ? "uncertain" : "failed", { code: safeOtpCode(error) });
    throw error;
  }
  });
}

function validateAttachments(input: EmailInput) {
  if (input.attachments && (!z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_.-]+\.pdf$/), content: z.string().min(1).max(20 * 1024 * 1024) })).max(1).safeParse(input.attachments).success
    || input.attachments.some(file => !Buffer.from(file.content, "base64").subarray(0, 5).equals(Buffer.from("%PDF-"))))) throw new ReportEmailError("EMAIL_INVALID_ATTACHMENT");
}

async function deliverReportEmail(input: EmailInput) {
  const started = performance.now();
  try {
  const config = settings();
  if (!config.success || !realProviderAllowed("BREVO")) throw new ReportEmailError("BREVO_NOT_CONFIGURED");
  if (!z.string().email().max(254).safeParse(input.recipient).success || !z.string().uuid().safeParse(input.idempotencyKey).success) throw new ReportEmailError("EMAIL_INVALID_RECIPIENT");
  validateAttachments(input);
  logOtpEvent("BREVO_SEND_STARTED", "started", { mode: "real" });
  let response: Response;
  try {
    response = await providerFetch("BREVO", "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.data.key, accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: config.data.name, email: config.data.email },
        replyTo: { name: config.data.name, email: config.data.email },
        to: [{ email: input.recipient, name: input.recipientName }],
        subject: input.subject, htmlContent: input.htmlContent,
        ...(input.attachments?.length ? { attachment: input.attachments } : {}),
        headers: { IdempotencyKey: input.idempotencyKey },
        tags: ["skillquest-report"],
      }),
      // Delivery runs in a worker; browser HTTP requests never wait for it.
      signal: AbortSignal.timeout(input.purpose === "OTP" ? 8000 : 20000),
    });
  } catch { throw new ReportEmailError("BREVO_RESPONSE_UNKNOWN", true, 30, true); }

  const payload: unknown = await response.json().catch(() => null);
  const code = z.object({ code: z.string() }).safeParse(payload);
  if (response.status === 201) {
    const accepted = z.object({ messageId: z.string().min(1).max(512) }).safeParse(payload);
    if (!accepted.success) throw new ReportEmailError("BREVO_RESPONSE_UNKNOWN", true, 30, true);
    logOtpEvent("BREVO_SEND_OK", "ok", { mode: "real", code: "PROVIDER_ACCEPTED", httpStatus: response.status, durationMs: performance.now() - started });
    if (input.purpose === "OTP") logOtpEvent("OTP_DELIVERY_STATUS", "waiting", { code: "DELIVERY_NOT_OBSERVABLE" });
    return { messageId: accepted.data.messageId, duplicate: false };
  }
  // This endpoint documents duplicate_parameter for a previously processed UUID key.
  if (response.status === 400 && code.success && code.data.code === "duplicate_parameter") {
    logOtpEvent("BREVO_SEND_OK", "ok", { mode: "real", code: "ALREADY_ACCEPTED", httpStatus: response.status, durationMs: performance.now() - started });
    return { messageId: null, duplicate: true };
  }
  if (response.status === 402 || code.success && code.data.code === "not_enough_credits") throw new ReportEmailError("BREVO_QUOTA", true, 86400);
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const seconds = retry ? /^\d+(\.\d+)?$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000 : NaN;
    throw new ReportEmailError("BREVO_RATE_LIMIT", true, Number.isFinite(seconds) ? Math.max(1, Math.min(86400, Math.ceil(seconds))) : 60);
  }
  if (response.status >= 500) throw new ReportEmailError("BREVO_UNAVAILABLE", true, 30, true);
  if (response.status === 401 || response.status === 403) throw new ReportEmailError("BREVO_AUTHORIZATION");
  throw new ReportEmailError("BREVO_REJECTED");
  } catch (error) {
    logOtpEvent("BREVO_SEND_FAILED", error instanceof ReportEmailError && error.uncertain ? "uncertain" : "failed",
      { mode: "real", code: safeOtpCode(error), durationMs: performance.now() - started });
    throw error;
  }
}
