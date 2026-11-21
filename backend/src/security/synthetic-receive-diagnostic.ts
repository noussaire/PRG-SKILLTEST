import { SyntheticStagingError } from "./synthetic-staging.js";

export const AUTHORIZED_RECEIVE_STEPS = new Set([
  "ADMISSION_DB_ASSERTION",
  "ADMISSION_ADMIN_SESSION",
  "ADMISSION_ANTI_REPLAY",
  "RECEIVE_TARGET_VALIDATION",
  "RECEIVE_DB_ASSERTION",
  "RECEIVE_TRANSACTION_INIT",
  "RECEIVE_PROVIDER_LOCK",
  "RECEIVE_TARGET_FETCH_AND_LOCK",
  "RECEIVE_TARGET_PROOF_VERIFY",
  "RECEIVE_ENVELOPE_PARSE",
  "RECEIVE_PAYLOAD_DECRYPT",
  "RECEIVE_QUEUE_PROCESS",
  "RECEIVE_VERIFY_OUTCOME",
  "RECEIVE_UPDATE_NOTIFICATION",
  "UNKNOWN_STEP",
] as const);

export type ReceiveStep = (typeof AUTHORIZED_RECEIVE_STEPS) extends Set<infer T> ? T : never;

export const AUTHORIZED_ERROR_CATEGORIES = new Set([
  "DATABASE_CONNECTION",
  "DATABASE_TIMEOUT",
  "DATABASE_LOCK_CONFLICT",
  "DATABASE_TRANSACTION_EXPIRED",
  "DATABASE_ERROR",
  "SYNTHETIC_DATABASE_ASSERTION",
  "TARGET_NOT_FOUND_OR_INELIGIBLE",
  "TARGET_PROOF_INVALID",
  "TARGET_PAYLOAD_INVALID",
  "QUEUE_PROCESSING_ERROR",
  "NOTIFICATION_UPDATE_FAILED",
  "UNEXPECTED_ERROR",
] as const);

export type ReceiveErrorCategory = (typeof AUTHORIZED_ERROR_CATEGORIES) extends Set<infer T> ? T : never;

export class ReceiveStepError extends SyntheticStagingError {
  constructor(public readonly step: ReceiveStep, code = "SYNTHETIC_OTP_TARGET_UNAVAILABLE") {
    super(code);
    this.name = "ReceiveStepError";
  }
}

export function extractDbCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const anyErr = error as any;
  const candidates = [
    anyErr.meta?.code,
    anyErr.code,
    anyErr.cause?.code,
    anyErr.cause?.meta?.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && (/^P\d{4}$/.test(c) || /^[0-9A-Z]{5}$/.test(c))) {
      return c;
    }
  }
  return null;
}

export function sanitizeCorrelationId(id: unknown): string {
  if (typeof id === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(id)) {
    return id;
  }
  return "UNKNOWN_CORRELATION_ID";
}

export function extractCorrelationId(
  req: { headers: Record<string, string | string[] | undefined> },
  stagingId?: string
): string {
  const vercelId = req.headers["x-vercel-id"];
  if (typeof vercelId === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(vercelId)) return vercelId;
  const requestId = req.headers["x-request-id"];
  if (typeof requestId === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(requestId)) return requestId;
  if (typeof stagingId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stagingId)) return stagingId;
  const headerId = req.headers["x-skillquest-staging-id"];
  if (typeof headerId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(headerId)) return headerId;
  return "UNKNOWN_CORRELATION_ID";
}

export function categorizeReceiveError(step: ReceiveStep, error: unknown): { category: ReceiveErrorCategory; dbCode: string | null } {
  const dbCode = extractDbCode(error);

  if (dbCode === "57014" || dbCode === "P2024") {
    return { category: "DATABASE_TIMEOUT", dbCode };
  }
  if (dbCode === "40P01" || dbCode === "40001") {
    return { category: "DATABASE_LOCK_CONFLICT", dbCode };
  }
  if (dbCode === "P1001" || dbCode === "P1002" || dbCode === "P1003" || dbCode === "08006" || dbCode === "08001") {
    return { category: "DATABASE_CONNECTION", dbCode };
  }
  if (dbCode === "P2028") {
    return { category: "DATABASE_TRANSACTION_EXPIRED", dbCode };
  }
  if (dbCode) {
    return { category: "DATABASE_ERROR", dbCode };
  }

  if (step === "RECEIVE_ENVELOPE_PARSE" || step === "RECEIVE_PAYLOAD_DECRYPT") {
    return { category: "TARGET_PAYLOAD_INVALID", dbCode: null };
  }

  if (step === "RECEIVE_TARGET_PROOF_VERIFY") {
    return { category: "TARGET_PROOF_INVALID", dbCode: null };
  }

  if (step === "RECEIVE_TARGET_FETCH_AND_LOCK" || step === "RECEIVE_TARGET_VALIDATION") {
    return { category: "TARGET_NOT_FOUND_OR_INELIGIBLE", dbCode: null };
  }

  if (step === "RECEIVE_UPDATE_NOTIFICATION") {
    return { category: "NOTIFICATION_UPDATE_FAILED", dbCode: null };
  }

  if (step === "ADMISSION_DB_ASSERTION" || step === "RECEIVE_DB_ASSERTION") {
    return { category: "SYNTHETIC_DATABASE_ASSERTION", dbCode: null };
  }

  if (step === "RECEIVE_QUEUE_PROCESS") {
    return { category: "QUEUE_PROCESSING_ERROR", dbCode: null };
  }

  if (error instanceof SyntheticStagingError || (error as any)?.name === "SyntheticStagingError" || (error as any)?.name === "ReceiveStepError") {
    return { category: "TARGET_NOT_FOUND_OR_INELIGIBLE", dbCode: null };
  }

  return { category: "UNEXPECTED_ERROR", dbCode: null };
}

export function formatReceiveDiagnosticLog(
  step: string,
  category: string,
  dbCode: string | null,
  correlationId: string
): string {
  const safeStep = AUTHORIZED_RECEIVE_STEPS.has(step as any) ? step : "UNKNOWN_STEP";
  const safeCategory = AUTHORIZED_ERROR_CATEGORIES.has(category as any) ? category : "UNEXPECTED_ERROR";
  const safeDbCode = dbCode && (/^P\d{4}$/.test(dbCode) || /^[0-9A-Z]{5}$/.test(dbCode)) ? dbCode : "NONE";
  const safeCorrelationId = sanitizeCorrelationId(correlationId);
  return `[RECEIVE_DIAGNOSTIC] step=${safeStep} category=${safeCategory} dbCode=${safeDbCode} correlationId=${safeCorrelationId}`;
}

export function logReceiveDiagnostic(
  step: ReceiveStep,
  error: unknown,
  correlationIdInput?: string
): void {
  const { category, dbCode } = categorizeReceiveError(step, error);
  const line = formatReceiveDiagnosticLog(step, category, dbCode, correlationIdInput ?? "UNKNOWN_CORRELATION_ID");
  console.error(line);
}
