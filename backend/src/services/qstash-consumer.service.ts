import type { PrismaClient } from "@prisma/client";
import type { JobNotification } from "./job-publication.service.js";
import { processJob } from "./job-processing.service.js";
import { logOtpEvent } from "./otp-diagnostic.service.js";

export type QstashDisposition = "COMPLETE" | "REJECTED" | "UNCERTAIN" | "MISSING" | "EXPIRED" | "OBSOLETE" | "BUSY" | "DEFERRED";
export class QstashIntentError extends Error { constructor() { super("QSTASH_INTENT_MISMATCH"); } }

// Called only AFTER signature/envelope authentication by the dedicated route.
export async function consumeQstash(db: PrismaClient, n: JobNotification): Promise<QstashDisposition> {
  const [intent] = await db.$queryRawUnsafe<{ state:string; current:boolean }[]>(`SELECT p.state,EXISTS(
    SELECT 1 FROM "JobPublicationReady" c WHERE c.kind=p.kind AND c."jobId"=p."jobId" AND c.phase=p.phase AND c.generation=p.generation AND c."dueAt"=p."dueAt") AS current
    FROM "JobPublicationIntent" p WHERE p.id=$1::uuid AND p.kind=$2 AND p."jobId"=$3::uuid AND p.phase=$4 AND p.generation=$5 AND p."dueAt"=($6::timestamptz AT TIME ZONE 'UTC')`,
    n.notificationId,n.kind,n.jobId,n.phase,n.generation,n.dueAt);
  if (!intent) throw new QstashIntentError();
  if (intent.state === "CANCELLED") {
    logOtpEvent("WORKER_FINISHED", "skipped", { traceId: n.jobId, code: "INTENT_OBSOLETE" });
    return "OBSOLETE";
  }
  if (!intent.current) logOtpEvent("WORKER_FINISHED", "skipped", { traceId: n.jobId, code: "NO_CURRENT_JOB" });
  if (intent.current) await processJob({ kind:n.kind,jobId:n.jobId,phase:n.phase });
  type Row = { status:string; expired:boolean; busy:boolean; reservation:string|null };
  let rows:Row[];
  if (n.kind === "REPORT") {
    const summary = n.phase === "SUMMARY", status = summary ? "status" : "emailStatus", lease = summary ? "leaseUntil" : "emailLeaseUntil";
    rows = await db.$queryRawUnsafe<Row[]>(`SELECT j."${status}" AS status,i."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AS expired,
      COALESCE(j."${lease}">(clock_timestamp() AT TIME ZONE 'UTC'),false) AS busy,NULL::text AS reservation
      FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" WHERE j.id=$1::uuid`,n.jobId);
  } else {
    const table = n.kind === "OTP_INITIAL" ? "ParticipantEmailDeliveryJob" : "OtpDeliveryJob";
    rows = await db.$queryRawUnsafe<Row[]>(`SELECT j.status,j."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AS expired,
      COALESCE(j."leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC'),false) AS busy,
      (SELECT r.status FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text) AS reservation FROM "${table}" j WHERE j.id=$1::uuid`,n.jobId);
  }
  const row = rows[0]; if (!row) return "MISSING";
  if (row.expired) return "EXPIRED";
  if (["ACCEPTED","SENT","COMPLETE"].includes(row.status)) return "COMPLETE";
  if (["REJECTED","FAILED","NOT_REQUESTED","UNAVAILABLE"].includes(row.status)) return "REJECTED";
  if (row.busy || row.status === "PROCESSING") return "BUSY";
  if (row.status === "UNKNOWN" || row.status === "UNCERTAIN" && row.reservation === "UNCERTAIN") return "UNCERTAIN";
  return intent.current ? "DEFERRED" : "OBSOLETE";
}
