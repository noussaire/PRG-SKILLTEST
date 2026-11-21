import { z } from "zod";
import { jobRequestSchema } from "./job-request.js";
import type { JobNotification, JobPublisher } from "./job-publication.service.js";
import { callbackUrl, QstashConfigurationError } from "../security/qstash-signature.js";
import { assertRealProviderAllowed, providerFetch } from "../security/provider-mode.js";
import { logOtpEvent, safeOtpCode } from "./otp-diagnostic.service.js";

const envelope = z.object({ version: z.literal(1), notificationId: z.string().uuid(), kind: z.enum(["OTP_INITIAL","OTP_RETAKE","REPORT"]),
  jobId: z.string().uuid(), phase: z.enum(["DELIVER","SUMMARY","EMAIL"]), generation: z.number().int().min(0).max(2147483647), dueAt: z.string().datetime() }).strict();
export function parseNotification(value: unknown): JobNotification {
  const n = envelope.parse(value); jobRequestSchema.parse({ kind:n.kind,jobId:n.jobId,phase:n.phase });
  if (new Date(n.dueAt).toISOString() !== n.dueAt) throw Error("NOTIFICATION_INVALID");
  return n as JobNotification;
}
export interface SimulatedQstashTransport {
  readonly mode: "simulated";
  request(url: string, init: RequestInit): Promise<Response>;
}

// Deliberately no fetch fallback or Client instance. Every request is injected
// into a test/local transport, even though it follows the documented HTTP API.
export class QstashPublisher implements JobPublisher {
  private destination: string;
  private origin: string;
  constructor(private config: { token: string; publishOrigin: string; callbackUrl: string }, private transport: SimulatedQstashTransport) {
    this.destination = callbackUrl(config.callbackUrl);
    const origin = new URL(config.publishOrigin);
    if (transport.mode !== "simulated" || !config.token || /[\r\n]/.test(config.token) || origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || !/^qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(origin.hostname)) throw new QstashConfigurationError();
    this.origin = origin.origin;
  }
  async publish(notification: JobNotification, signal: AbortSignal) {
    const n = parseNotification(notification);
    const response = await this.transport.request(`${this.origin}/v2/publish/${encodeURIComponent(this.destination)}`, {
      method:"POST",redirect:"error",signal,headers:{Authorization:`Bearer ${this.config.token}`,"Content-Type":"application/json",
        "Upstash-Method":"POST","Upstash-Deduplication-Id":n.notificationId,"Upstash-Retries":"3","Upstash-Timeout":"90s"},body:JSON.stringify(n),
    });
    if (![200,201,202].includes(response.status)) throw Error("QSTASH_PUBLICATION_UNCONFIRMED");
    const body = await response.json().catch(()=>null);
    if (!z.object({ messageId:z.string().min(1).max(512) }).safeParse(body).success) throw Error("QSTASH_PUBLICATION_UNCONFIRMED");
  }
}

// Separate factory: tests keep their injected simulated transport. No default
// publisher is constructed on import and no credential alone can select this.
export function realQstashPublisher(): JobPublisher {
  try {
  assertRealProviderAllowed("QSTASH");
  if (process.env.SKILLQUEST_QSTASH_MODE !== "real") throw new QstashConfigurationError();
  const destination = callbackUrl(process.env.QSTASH_CALLBACK_URL ?? "");
  const token = process.env.QSTASH_TOKEN ?? "";
  if (!token || /[\r\n]/.test(token)) throw new QstashConfigurationError();
  return { async publish(notification, signal) {
    const started = performance.now();
    try {
    assertRealProviderAllowed("QSTASH");
    if (process.env.SKILLQUEST_QSTASH_MODE !== "real" || process.env.QSTASH_TOKEN !== token || process.env.QSTASH_CALLBACK_URL !== destination) throw new QstashConfigurationError();
    const n = parseNotification(notification);
    logOtpEvent("QSTASH_PUBLISH_STARTED", "started", { traceId: n.jobId, notificationId: n.notificationId, mode: "real" });
    const response = await providerFetch("QSTASH", `https://qstash.upstash.io/v2/publish/${encodeURIComponent(destination)}`, {
      method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        "Upstash-Method": "POST", "Upstash-Deduplication-Id": n.notificationId, "Upstash-Retries": "3", "Upstash-Timeout": "90s" }, body: JSON.stringify(n),
    });
    if (![200, 201, 202].includes(response.status) || !z.object({ messageId: z.string().min(1).max(512) }).safeParse(await response.json().catch(() => null)).success) throw Error("QSTASH_PUBLICATION_UNCONFIRMED");
    logOtpEvent("QSTASH_PUBLISH_OK", "ok", { traceId: n.jobId, notificationId: n.notificationId, mode: "real", code: "PROVIDER_ACCEPTED", durationMs: performance.now() - started });
    } catch (error) {
      logOtpEvent("QSTASH_PUBLISH_FAILED", "failed", { traceId: notification.jobId, code: safeOtpCode(error), mode: "real", durationMs: performance.now() - started });
      throw error;
    }
  } };
  } catch (error) {
    logOtpEvent("QSTASH_PUBLISH_SKIPPED", "disabled", { code: safeOtpCode(error), mode: "real" });
    throw error;
  }
}
