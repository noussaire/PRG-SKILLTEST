import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@prisma/client";
import { MaintenanceControl, MaintenanceStopped } from "./maintenance-control.js";
import { JobPublications, type JobPublisher } from "./job-publication.service.js";
import { realQstashPublisher } from "./qstash-publisher.service.js";
import { SyntheticQstashPublisher } from "./synthetic-providers.service.js";
import { assertSyntheticDatabase, stagingConfiguration, SyntheticStagingError } from "../security/synthetic-staging.js";
import { dispatchSecret } from "../security/dispatch-auth.js";
import { ProviderDisabledError } from "../security/provider-mode.js";
import { callbackUrl, QstashConfigurationError } from "../security/qstash-signature.js";
import { logOtpEvent, safeOtpCode, withDispatchContext, type DispatchPhase } from "./otp-diagnostic.service.js";

export class DispatchBusy extends Error { constructor() { super("DISPATCH_BUSY"); } }
const RETRYABLE_ADMISSION_SQLSTATES = new Set(["40001", "40P01", "55P03"]);

export function admissionSqlState(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const raw = error as { code?: unknown; meta?: { code?: unknown } };
  const code = raw.code === "P2010" ? raw.meta?.code : raw.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && !/^P\d{4}$/.test(code)) return code;
}
export type DispatchResult = { published: number; deferred: number; stale: number; stop: "COMPLETE" | "PARTIAL" };

const SAFE_DISPATCH_CODES = new Set([
  "DISPATCH_DISABLED",
  "DISPATCH_BUSY",
  "DISPATCH_DAILY_LIMIT_REQUIRED",
  "DISPATCH_DAILY_LIMIT",
  "DISPATCH_LEASE_LOST",
  "DISPATCH_MIGRATION_REQUIRED",
  "DISPATCH_LIMIT_INVALID",
  "JOB_BATCH_INVALID",
  "PUBLICATION_TIMEOUT",
  "QSTASH_DISABLED_OR_INVALID",
  "QSTASH_PUBLICATION_UNCONFIRMED",
  "QSTASH_REAL_TRANSPORT_DISABLED",
  "BREVO_REAL_TRANSPORT_DISABLED",
  "GROQ_REAL_TRANSPORT_DISABLED",
  "SYNTHETIC_STAGING_UNAVAILABLE",
]);

export function sanitizeDispatchErrorCode(error: unknown): string {
  if (error instanceof DispatchBusy) return "DISPATCH_BUSY";
  if (error instanceof ProviderDisabledError) return error.message;
  if (error instanceof QstashConfigurationError) return "QSTASH_DISABLED_OR_INVALID";
  if (error instanceof SyntheticStagingError) return "SYNTHETIC_STAGING_UNAVAILABLE";
  if (error instanceof MaintenanceStopped) return `MAINTENANCE_${error.code}`;
  if (error instanceof Error) {
    const sqlState = admissionSqlState(error);
    if (sqlState) return `DB_${sqlState}`;
    if (SAFE_DISPATCH_CODES.has(error.message)) return error.message;
    if (error.name === "SyntaxError") return "CONFIG_SYNTAX_ERROR";
    const dbCode = (error as { code?: unknown }).code;
    if (typeof dbCode === "string" && (/^P\d{4}$/.test(dbCode) || /^[0-9A-Z]{5}$/.test(dbCode))) {
      return `DB_${dbCode}`;
    }
  }
  return "UNEXPECTED_DISPATCH_ERROR";
}

// Runs only inside an awaited request/CLI invocation. No background timer,
// detached promise or in-memory cursor is needed for durable recovery.
export async function acquireDispatchAdmission(db: PrismaClient, token: string, signal?: AbortSignal): Promise<void> {
  // One deadline across both transactions and backoff; other maintenance work
  // retains its existing limits. Await rollback before starting a fresh tx.
  const admission = new MaintenanceControl(5000, 1500, signal, undefined, { maxWaitMs: 1500, lockTimeoutMs: 500 });
  for (let attempt = 0; attempt < 2; attempt++) {
    admission.check();
    const started = performance.now();
    try {
      await admission.transaction(db, async tx => {
        const claimed = await tx.$queryRawUnsafe<unknown[]>(`UPDATE "JobDispatchState" SET "attemptToken"=$1::uuid,
      "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '30 seconds',
      "nextAllowedAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 seconds'
      WHERE singleton=1 AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
      AND "nextAllowedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') RETURNING singleton`, token);
        if (!claimed.length) throw new DispatchBusy();
      });
      logOtpEvent("DB_LEASE_ACQUIRED", "ok", { attempt: attempt + 1, durationMs: performance.now() - started });
      return;
    } catch (error) {
      logOtpEvent("DB_LEASE_FAILED", error instanceof DispatchBusy ? "waiting" : "failed",
        { attempt: attempt + 1, durationMs: performance.now() - started, code: safeOtpCode(error) });
      admission.check();
      if (attempt !== 0 || !RETRYABLE_ADMISSION_SQLSTATES.has(admissionSqlState(error) ?? "")) throw error;
      const backoffMs = 100 + Math.floor(Math.random() * 151);
      if (admission.remaining() < backoffMs + 10) throw new MaintenanceStopped("DEADLINE");
      try { await delay(backoffMs, undefined, { signal }); }
      catch (error) { admission.check(); throw error; }
      admission.check();
    }
  }
}

export async function dispatchJobs(db: PrismaClient, publisher: JobPublisher, signal?: AbortSignal, dailyLimit?: number): Promise<DispatchResult> {
  return withDispatchContext(async () => {
  const token = randomUUID();
  await acquireDispatchAdmission(db, token, signal);
  const control = new MaintenanceControl(8000, 750, signal, async tx => {
    const lease = await tx.$queryRawUnsafe<unknown[]>(`SELECT singleton FROM "JobDispatchState" WHERE singleton=1 AND "attemptToken"=$1::uuid
      AND "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`, token);
    if (!lease.length) throw Error("DISPATCH_LEASE_LOST");
  });
  let result: DispatchResult = { published: 0, deferred: 0, stale: 0, stop: "COMPLETE" };
  let phase: DispatchPhase = "INIT";
  let phaseStarted = performance.now();
  try {
    const publications = new JobPublications(db, control, dailyLimit);
    phase = "RETIRE";
    phaseStarted = performance.now();
    await publications.retire(12);
    logOtpEvent("DISPATCH_PHASE_FINISHED", "ok", { phase, durationMs: performance.now() - phaseStarted, remainingMs: control.remaining() });
    phase = "RECONCILE";
    phaseStarted = performance.now();
    await publications.reconcile(12);
    logOtpEvent("DISPATCH_PHASE_FINISHED", "ok", { phase, durationMs: performance.now() - phaseStarted, remainingMs: control.remaining() });
    phase = "SELECT";
    phaseStarted = performance.now();
    let selectionEntered = false;
    // One at a time so completed publication counts survive a later deadline.
    for (let n = 0; n < 6 && control.remaining() > 1500; n++) {
      selectionEntered = true;
      const batch = await publications.publishBatch(publisher, 1);
      result.published += batch.published; result.deferred += batch.deferred; result.stale += batch.stale;
      if (!batch.published && !batch.deferred && !batch.stale) break;
    }
    if (!selectionEntered) logOtpEvent("BUDGET_EXHAUSTED_BEFORE_SELECTION", "waiting",
      { phase, code: "BUDGET_EXHAUSTED_BEFORE_SELECTION", remainingMs: control.remaining() });
    if (control.remaining() <= 1500) result.stop = "PARTIAL";
  } catch (error) {
    logOtpEvent("DISPATCH_FAILED", "failed", { phase, code: safeOtpCode(error), durationMs: performance.now() - phaseStarted, remainingMs: control.remaining() });
    result.stop = "PARTIAL";
  }
  finally {
    // Independent small deadline: a timeout never clears somebody else's lease.
    const cleanup = new MaintenanceControl(1500, 500);
    await cleanup.transaction(db, tx => tx.$executeRawUnsafe(`UPDATE "JobDispatchState" SET "attemptToken"=NULL,"leaseUntil"=NULL WHERE singleton=1 AND "attemptToken"=$1::uuid`, token)).catch(error => {
      logOtpEvent("DISPATCH_FAILED", "failed", { phase: "CLEANUP", code: safeOtpCode(error) });
    });
  }
  logOtpEvent("DISPATCH_FINISHED", result.stop === "COMPLETE" ? "ok" : "waiting", { code: result.stop });
  return result;
  });
}

export async function configuredDispatch(signal?: AbortSignal) {
  return withDispatchContext(async () => {
  let phase: DispatchPhase = "PREPARE";
  try {
  dispatchSecret();
  const synthetic = !!stagingConfiguration();
  const limit = Number(process.env.QSTASH_APP_DAILY_LIMIT ?? "0");
  if (!synthetic && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) throw Error("DISPATCH_DAILY_LIMIT_REQUIRED");
  const publisher = synthetic ? null : realQstashPublisher(); // validate before DB
  const { prisma } = await import("../db/prisma.js");
  if (synthetic) await assertSyntheticDatabase(prisma);
  phase = "ADMISSION";
  return await dispatchJobs(prisma, publisher ?? new SyntheticQstashPublisher(prisma), signal, synthetic ? undefined : limit);
  } catch (error) {
    logOtpEvent("DISPATCH_FAILED", "failed", { phase, code: safeOtpCode(error) });
    throw error;
  }
  });
}

export async function wakeJobs() {
  return withDispatchContext(async () => {
  if (process.env.SKILLQUEST_DISPATCH_ENABLED !== "1") {
    logOtpEvent("DISPATCH_FINISHED", "disabled", { code: "DISPATCH_DISABLED" });
    logOtpEvent("QSTASH_PUBLISH_SKIPPED", "disabled", { code: "DISPATCH_DISABLED" });
    return;
  }
  // The outbox has already committed. Failure must never undo the user's work;
  // the independent scheduler can retry it after this process has disappeared.
  try {
    await configuredDispatch();
  } catch (error) {
    const code = sanitizeDispatchErrorCode(error);
    console.error(`[DISPATCH_DIAGNOSTIC] code=${code}`);
  }
  });
}

export function checkDispatchPreflight(): string {
  try {
    const synthetic = !!stagingConfiguration();
    // 1. Dispatch secret validation (format & collision) without requiring DISPATCH_ENABLED=1
    const secret = process.env.SKILLQUEST_DISPATCH_SECRET ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, "base64url").length !== 32 || Buffer.from(secret, "base64url").toString("base64url") !== secret) {
      return "DISPATCH_SECRET_INVALID";
    }
    const keys = [
      process.env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS, process.env.SKILLQUEST_MAINTENANCE_SECRET,
      process.env.SKILLQUEST_STAGING_SECRET, process.env.SKILLQUEST_PROXY_HMAC_KEY, process.env.SKILLQUEST_EDGE_HMAC_KEY,
      process.env.BREVO_API_KEY, process.env.GROQ_API_KEY, process.env.QSTASH_TOKEN, process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY,
    ];
    let ring: unknown;
    try { ring = JSON.parse(process.env.OTP_ENCRYPTION_KEYS ?? "{}"); } catch { return "OTP_KEYS_SYNTAX_ERROR"; }
    if (!ring || typeof ring !== "object" || Array.isArray(ring)) return "DISPATCH_SECRET_INVALID";
    const material = Buffer.from(secret, "base64url");
    for (const value of [...keys, ...Object.values(ring)]) {
      if (value === undefined) continue;
      if (typeof value !== "string") return "DISPATCH_SECRET_INVALID";
      if (value === secret || Buffer.from(value).equals(material) || Buffer.from(value, "base64").equals(material) || (/^[a-f0-9]{64}$/i.test(value) && Buffer.from(value, "hex").equals(material))) {
        return "DISPATCH_SECRET_COLLISION";
      }
    }

    if (synthetic) {
      return process.env.SKILLQUEST_DISPATCH_ENABLED === "1" ? "SYNTHETIC_DISPATCH_READY" : "CONFIG_READY_DISPATCH_DISABLED";
    }

    // 2. QStash daily limit validation
    const limit = Number(process.env.QSTASH_APP_DAILY_LIMIT ?? "0");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      return "DISPATCH_DAILY_LIMIT_REQUIRED";
    }

    // 3. QStash configuration validations
    if (process.env.SKILLQUEST_QSTASH_MODE !== "real") {
      return "QSTASH_MODE_NOT_REAL";
    }
    try {
      callbackUrl(process.env.QSTASH_CALLBACK_URL ?? "");
    } catch {
      return "QSTASH_CALLBACK_URL_INVALID";
    }
    const token = process.env.QSTASH_TOKEN ?? "";
    if (!token || /[\r\n]/.test(token)) {
      return "QSTASH_TOKEN_INVALID";
    }

    // 4. Flags validation
    const dispatchEnabled = process.env.SKILLQUEST_DISPATCH_ENABLED === "1";
    const qstashRealAllowed = process.env.SKILLQUEST_ALLOW_REAL_QSTASH === "1";

    if (dispatchEnabled && qstashRealAllowed) {
      return "DISPATCH_PREREQUISITES_VALID";
    }
    if (!dispatchEnabled && !qstashRealAllowed) {
      return "CONFIG_READY_FLAGS_STANDBY";
    }
    if (!dispatchEnabled) {
      return "CONFIG_READY_DISPATCH_DISABLED";
    }
    return "QSTASH_REAL_TRANSPORT_DISABLED";
  } catch {
    return "PREFLIGHT_UNEXPECTED_ERROR";
  }
}

export function logDispatchPreflight(): void {
  try {
    const code = checkDispatchPreflight();
    console.info(`[DISPATCH_PREFLIGHT] code=${code}`);
  } catch {
    console.info("[DISPATCH_PREFLIGHT] code=PREFLIGHT_ERROR");
  }
}
