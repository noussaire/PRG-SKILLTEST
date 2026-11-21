import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { MaintenanceStopped } from "./maintenance-control.js";

type Context = { requestId?: string; traceId?: string; dispatchId?: string };
type Status = "started" | "ok" | "failed" | "waiting" | "skipped" | "disabled" | "uncertain";
export type DispatchPhase = "PREPARE" | "ADMISSION" | "INIT" | "RETIRE" | "RECONCILE" | "SELECT" | "CLEANUP";
const phases = new Set<DispatchPhase>(["PREPARE", "ADMISSION", "INIT", "RETIRE", "RECONCILE", "SELECT", "CLEANUP"]);
type Fields = Context & { code?: string | null; durationMs?: number; remainingMs?: number; phase?: DispatchPhase; attempt?: number; httpStatus?: number;
  deliveryState?: string; mode?: "real" | "synthetic"; notificationId?: string };
const contexts = new AsyncLocalStorage<Context>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const events = new Set(["START_RECEIVED", "START_RESULT", "START_FINISHED", "TRACE_LINKED", "OTP_JOB_CREATED", "OTP_JOB_REUSED",
  "OTP_JOB_FAILED", "DISPATCH_STARTED", "DISPATCH_FINISHED", "DISPATCH_FAILED", "DB_LEASE_ACQUIRED", "DB_LEASE_FAILED",
  "DISPATCH_PHASE_FINISHED", "BUDGET_EXHAUSTED_BEFORE_SELECTION",
  "JOB_SELECTED", "NO_JOB_READY", "QSTASH_PUBLISH_STARTED", "QSTASH_PUBLISH_OK", "QSTASH_PUBLISH_FAILED",
  "QSTASH_PUBLISH_SKIPPED", "WORKER_RECEIVED", "WORKER_FINISHED", "WORKER_FAILED", "BREVO_SEND_STARTED",
  "BREVO_SEND_OK", "BREVO_SEND_FAILED", "BREVO_SEND_SKIPPED", "OTP_DELIVERY_STATUS", "OTP_STATUS_PERSIST_FAILED"]);
const states = new Set(["PENDING", "ACCEPTED", "REJECTED", "UNCERTAIN", "SENT", "UNAVAILABLE", "INVALID",
  "EXPIRED", "VERIFIED", "LIMIT_REACHED", "MISSING", "OBSOLETE", "BUSY", "DEFERRED", "COMPLETE"]);
const statuses = new Set<Status>(["started", "ok", "failed", "waiting", "skipped", "disabled", "uncertain"]);
const codes = new Set([
  "UNKNOWN_ERROR", "DISPATCH_DISABLED", "DISPATCH_BUSY", "DISPATCH_DAILY_LIMIT_REQUIRED", "DISPATCH_DAILY_LIMIT",
  "DISPATCH_LEASE_LOST", "DISPATCH_MIGRATION_REQUIRED", "DISPATCH_LIMIT_INVALID", "JOB_BATCH_INVALID",
  "PUBLICATION_TIMEOUT", "QSTASH_DISABLED_OR_INVALID", "QSTASH_PUBLICATION_UNCONFIRMED", "QSTASH_REAL_TRANSPORT_DISABLED",
  "BREVO_REAL_TRANSPORT_DISABLED", "GROQ_REAL_TRANSPORT_DISABLED", "SYNTHETIC_STAGING_UNAVAILABLE",
  "MAINTENANCE_ABORTED", "MAINTENANCE_DEADLINE", "CONFIG_SYNTAX_ERROR", "UNEXPECTED_DISPATCH_ERROR",
  "NO_ELIGIBLE_JOB", "NOT_ATTEMPTED", "COMPLETE", "PARTIAL", "SYNTHETIC_TRANSPORT", "PROVIDER_ACCEPTED",
  "BUDGET_EXHAUSTED_BEFORE_SELECTION",
  "ALREADY_ACCEPTED", "NO_NEW_JOB", "PREPARATION_FAILED", "STATE_OBSERVED", "STATE_PERSISTED", "LEASE_LOST",
  "QSTASH_DISABLED", "QSTASH_SIGNATURE_INVALID", "QSTASH_NOTIFICATION_INVALID", "QSTASH_INTENT_MISMATCH",
  "QSTASH_METHOD_OR_URL_INVALID", "QSTASH_JSON_REQUIRED",
  "QSTASH_PROCESSING_UNAVAILABLE", "BREVO_NOT_CONFIGURED", "EMAIL_INVALID_RECIPIENT", "EMAIL_INVALID_ATTACHMENT",
  "SYNTHETIC_IDENTITY_REQUIRED", "BREVO_RATE_LIMIT", "BREVO_REJECTED", "BREVO_RESPONSE_UNKNOWN", "BREVO_QUOTA",
  "BREVO_UNAVAILABLE", "BREVO_AUTHORIZATION", "OTP_OBSOLETE", "OTP_PAYLOAD_INVALID", "OTP_RESPONSE_UNKNOWN",
  "OTP_EXPIRED", "OTP_EXPIRED_OR_EXHAUSTED", "OTP_KEY_UNAVAILABLE", "OTP_KEYS_INVALID", "OTP_PAYLOAD_UNAVAILABLE",
  "OTP_PAYLOAD_KEY_UNAVAILABLE", "OTP_PAYLOAD_VERSION_UNSUPPORTED", "OTP_PAYLOAD_CONFIG_INVALID",
  "EMAIL_LIMIT_CONFIG_INVALID", "EMAIL_REQUEST_CHANGED", "EMAIL_SEND_BUSY", "EMAIL_STALE_ATTEMPT", "BREVO_ACCEPTANCE_UNKNOWN",
  "SYNTHETIC_PUBLICATION_FAILED", "SYNTHETIC_PUBLICATION_UNKNOWN",
  "EMAIL_UNAVAILABLE", "EMAIL_VERIFICATION_REQUIRED", "EMAIL_LIMIT_REACHED", "EMAIL_CODE_INVALID", "EMAIL_CODE_EXPIRED",
  "EMAIL_LOCAL_LIMIT", "EMAIL_OTP_COOLDOWN", "EMAIL_IDENTITY_LIMIT", "EMAIL_NETWORK_LIMIT", "EMAIL_GLOBAL_LIMIT",
  "EMAIL_BUDGET_BUSY", "EMAIL_PROVIDER_UNCERTAIN", "EMAIL_REQUEST_CONFLICT", "EMAIL_ATTEMPT_LIMIT",
  "INVALID_INPUT", "EMAIL_NETWORK_UNAVAILABLE", "INTERVIEW_BUSY", "RETAKE_COOLDOWN", "RETAKE_VERIFICATION_REQUIRED",
  "RETAKE_EMAIL_UNAVAILABLE", "RETAKE_CODE_INVALID", "RETAKE_WORKER_BUSY", "ABORTED", "CALLBACK_ACCEPTED",
  "DELIVERY_NOT_OBSERVABLE", "INTENT_OBSOLETE", "COMMIT_FAILED", "RECONCILED_ACCEPTANCE", "NO_CURRENT_JOB", "ATTEMPT_RETURNED",
]);

export function diagnosticId(value?: unknown): string { return typeof value === "string" && uuid.test(value) ? value : randomUUID(); }
export function withOtpContext<T>(context: Context, work: () => T): T {
  return contexts.run({ ...contexts.getStore(), ...context }, work);
}
export function withDispatchContext<T>(work: () => T): T {
  if (contexts.getStore()?.dispatchId) return work();
  return withOtpContext({ dispatchId: randomUUID() }, () => {
    logOtpEvent("DISPATCH_STARTED", "started");
    return work();
  });
}
export function linkOtpTrace(jobId: unknown): void {
  const context = contexts.getStore();
  if (!context || typeof jobId !== "string" || !uuid.test(jobId)) return;
  context.traceId = jobId;
  logOtpEvent("TRACE_LINKED", "ok");
}
export function safeOtpCode(value: unknown): string {
  try {
    if (value instanceof MaintenanceStopped) return `MAINTENANCE_${value.code}`;
    if (typeof value === "string") {
      if (codes.has(value) || states.has(value) || /^DB_(?:P\d{4}|[0-9]{2}[0-9A-Z]{3})$/.test(value)) return value;
      return "UNKNOWN_ERROR";
    }
    if (!value || typeof value !== "object") return "UNKNOWN_ERROR";
    const e = value as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
    const dbCode = e.code === "P2010" ? e.meta?.code : e.code;
    if (typeof dbCode === "string" && /^(?:P\d{4}|[0-9]{2}[0-9A-Z]{3})$/.test(dbCode)) return `DB_${dbCode}`;
    return safeOtpCode(typeof e.code === "string" && codes.has(e.code) ? e.code : e.message);
  } catch { return "UNKNOWN_ERROR"; }
}

// A strict projection, never a spread of caller data or errors. No body, payload,
// recipient, provider message ID, URL, headers or lease token can be serialized.
export function logOtpEvent(event: string, status: Status, fields: Fields = {}): void {
  try {
    if (!events.has(event) || !statuses.has(status)) return;
    const context = contexts.getStore();
    const line: Record<string, string | number> = { event, status };
    if (event === "OTP_DELIVERY_STATUS") line.receipt = "not_observed";
    for (const key of ["requestId", "traceId", "dispatchId", "notificationId"] as const) {
      const id = fields[key] ?? (key === "notificationId" ? undefined : context?.[key]);
      if (typeof id === "string" && uuid.test(id)) line[key] = id;
    }
    if (fields.code != null) line.code = safeOtpCode(fields.code);
    for (const key of ["durationMs", "remainingMs", "attempt", "httpStatus"] as const) {
      const n = fields[key];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) line[key] = Math.round(n);
    }
    if (fields.phase && phases.has(fields.phase)) line.phase = fields.phase;
    if (fields.deliveryState && states.has(fields.deliveryState)) line.deliveryState = fields.deliveryState;
    if (fields.mode === "real" || fields.mode === "synthetic") line.mode = fields.mode;
    console.info(JSON.stringify(line));
  } catch { /* Diagnostics must never change the application's outcome. */ }
}
