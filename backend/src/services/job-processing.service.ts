import { jobRequestSchema } from "./job-request.js";
import { logOtpEvent, safeOtpCode, withOtpContext } from "./otp-diagnostic.service.js";

// Internal application interface only: no transport, endpoint or publication.
// Resolving this promise means the bounded attempt returned, not that an email
// was delivered. A future adapter must inspect the persisted job disposition.
export async function processJob(input: unknown): Promise<void> {
  const job = jobRequestSchema.parse(input);
  return withOtpContext({ traceId: job.jobId }, async () => {
  const started = performance.now();
  logOtpEvent("WORKER_RECEIVED", "started");
  try {
  if (job.kind === "REPORT") {
    if (job.phase === "SUMMARY") {
      const { processReportQueue } = await import("./report-queue.service.js");
      await processReportQueue(job.jobId);
    } else {
      const { processReportEmails } = await import("./report-email-queue.service.js");
      await processReportEmails(job.jobId);
    }
  } else {
    const { prisma } = await import("../db/prisma.js");
    const { OtpDeliveryQueue } = await import("./otp-delivery.service.js");
    await new OtpDeliveryQueue(prisma).processJob(job.kind, job.jobId);
  }
  logOtpEvent("WORKER_FINISHED", "ok", { code: "ATTEMPT_RETURNED", durationMs: performance.now() - started });
  } catch (error) {
    logOtpEvent("WORKER_FAILED", "failed", { code: safeOtpCode(error), durationMs: performance.now() - started });
    throw error;
  }
  });
}
