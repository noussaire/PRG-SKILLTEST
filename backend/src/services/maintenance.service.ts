import type { Prisma, PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { EmailBudget } from "./email-budget.service.js";
import { JobPublications } from "./job-publication.service.js";
import { MaintenanceControl, MaintenanceStopped, type MaintenanceFence } from "./maintenance-control.js";
import {retainTechnicalData,type TechnicalRetentionResult} from "./technical-retention.service.js";

export const maintenanceStages = ["otpInitial", "otpRetake", "reportSummary", "reportEmail", "sessions", "nonces",
  "retention", "missingReports", "missingIntents", "staleIntents", "rearm"] as const;
export type MaintenanceStage = typeof maintenanceStages[number] | "technicalRetention";
const settings = z.object({ batchSize:z.number().int().min(1).max(100).default(25), maxBatches:z.number().int().min(1).max(100).default(22),
  maxRows:z.number().int().min(1).max(10000).default(1000), budgetMs:z.number().int().min(50).max(30000).default(5000),
  sqlTimeoutMs:z.number().int().min(10).max(4000).default(1000), stages:z.array(z.enum([...maintenanceStages,"technicalRetention"])).min(1).max(12).default([...maintenanceStages]) }).strict();
export type MaintenanceOptions = z.input<typeof settings> & { signal?: AbortSignal };
type Stop = "IDLE" | "MAX_BATCHES" | "ROW_LIMIT" | "DEADLINE" | "ABORTED" | "FAILED";
export type MaintenanceResult = { stop:Stop; batches:number; rows:number; elapsedMs:number; stage:MaintenanceStage|null;
  changed:Partial<Record<MaintenanceStage,number>>; oldestUnpublishedDueLagSeconds:number|null; errorCode?:"MAINTENANCE_UNAVAILABLE";technicalRetention?:TechnicalRetentionResult };
type Tx = Prisma.TransactionClient;
const now = `(clock_timestamp() AT TIME ZONE 'UTC')`;

async function lockBudget(tx:Tx) {
  await tx.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider) VALUES ('BREVO') ON CONFLICT DO NOTHING`);
  await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);
}

// Reconcile evidence only. Neither this module nor its dependencies below call a
// publisher, processJob, renderer or provider. Reservation rows are never changed.
async function reconcileOtp(tx:Tx, table:"ParticipantEmailDeliveryJob"|"OtpDeliveryJob", limit:number) {
  await lockBudget(tx);
  return tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT ${now} AS now), candidates AS (
    SELECT j.id,r.status AS receipt,j."expiresAt"<=c.now AS expired FROM "${table}" j
    LEFT JOIN "EmailBudgetReservation" r ON r."logicalKey"=j.id::text CROSS JOIN clock c
    WHERE (j."leaseUntil" IS NULL OR j."leaseUntil"<=c.now) AND (r."leaseUntil" IS NULL OR r."leaseUntil"<=c.now)
      AND NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p."jobId"=j.id AND p.state='PUBLISHING' AND p."leaseUntil">c.now)
      AND ((j."expiresAt"<=c.now AND (j."encryptedPayload" IS NOT NULL OR j."nextAttemptAt" IS NOT NULL OR j."attemptToken" IS NOT NULL))
        OR (j.status='UNCERTAIN' AND r.status IN ('ACCEPTED','UNCERTAIN') AND
          (j.status<>r.status OR j."nextAttemptAt" IS NOT NULL OR j."attemptToken" IS NOT NULL OR j."leaseUntil" IS NOT NULL OR (r.status='ACCEPTED' AND j."encryptedPayload" IS NOT NULL))))
    ORDER BY j."expiresAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE "${table}" j SET status=CASE WHEN c.receipt IN ('ACCEPTED','UNCERTAIN') THEN c.receipt
      WHEN c.expired AND j.status='PENDING' THEN 'REJECTED' ELSE j.status END,
      "encryptedPayload"=CASE WHEN c.expired OR c.receipt='ACCEPTED' THEN NULL ELSE j."encryptedPayload" END,
      "nextAttemptAt"=NULL,"leaseUntil"=NULL,"attemptToken"=NULL,
      "lastErrorCode"=CASE WHEN c.receipt='UNCERTAIN' THEN 'BREVO_ACCEPTANCE_UNKNOWN' WHEN c.receipt='ACCEPTED' THEN NULL
        WHEN c.expired THEN COALESCE(j."lastErrorCode",'OTP_EXPIRED') ELSE j."lastErrorCode" END FROM candidates c WHERE j.id=c.id`,limit);
}

async function reconcileReports(tx:Tx, phase:"SUMMARY"|"EMAIL",limit:number) {
  await lockBudget(tx);
  if(phase==="SUMMARY") return tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT ${now} AS now), candidates AS (
    SELECT j.id FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock c
    WHERE i."expiresAt"<=c.now AND j.status IN ('PENDING','RETRY','PROCESSING')
      AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=c.now) AND (j."emailLeaseUntil" IS NULL OR j."emailLeaseUntil"<=c.now)
      AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r."leaseUntil">c.now)
      AND NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p."jobId"=j.id AND p.state='PUBLISHING' AND p."leaseUntil">c.now)
    ORDER BY i."expiresAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE "AdaptiveReportJob" j SET status='UNAVAILABLE',"leaseUntil"=NULL,"lastErrorCode"='EXPIRED' FROM candidates c WHERE j.id=c.id`,limit);
  return tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT ${now} AS now), candidates AS (
    SELECT j.id,r.status AS receipt FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId"
    LEFT JOIN "EmailBudgetReservation" r ON r."logicalKey"=j.id::text CROSS JOIN clock c
    WHERE (j."emailStatus" IN ('PENDING','RETRY','PROCESSING') OR (j."emailStatus"='UNKNOWN' AND r.status='ACCEPTED')) AND
      (j."emailLeaseUntil" IS NULL OR j."emailLeaseUntil"<=c.now) AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=c.now)
      AND (r."leaseUntil" IS NULL OR r."leaseUntil"<=c.now) AND
      NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" p WHERE p."jobId"=j.id AND p.state='PUBLISHING' AND p."leaseUntil">c.now) AND
      (i."expiresAt"<=c.now OR r.status='ACCEPTED' OR j."emailAttemptWindowAt"<=c.now-interval '10 minutes'
        OR (r.status='UNCERTAIN' AND (r."retrySafeUntil" IS NULL OR r."retrySafeUntil"<=c.now OR r."budgetWindowStart"<>date_trunc('day',c.now))))
    ORDER BY j."emailNextAttemptAt",j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE "AdaptiveReportJob" j SET "emailStatus"=CASE WHEN c.receipt='ACCEPTED' THEN 'SENT'
      WHEN c.receipt='UNCERTAIN' OR j."emailAttemptWindowAt" IS NOT NULL THEN 'UNKNOWN' ELSE 'FAILED' END,
      "emailLeaseUntil"=NULL,"emailLastErrorCode"=CASE WHEN c.receipt='ACCEPTED' THEN NULL
      WHEN c.receipt='UNCERTAIN' OR j."emailAttemptWindowAt" IS NOT NULL THEN 'BREVO_ACCEPTANCE_UNKNOWN' ELSE 'EXPIRED' END
    FROM candidates c WHERE j.id=c.id`,limit);
}

async function sessions(tx:Tx,limit:number) {
  return tx.$executeRawUnsafe(`WITH clock AS MATERIALIZED (SELECT ${now} AS now), candidates AS (
    SELECT s.id,CASE WHEN s."closesAt"<=c.now THEN 'CLOSED' ELSE 'OPEN' END AS target FROM "AssessmentSession" s CROSS JOIN clock c
    WHERE (s.status IN ('OPEN','SCHEDULED') AND s."closesAt"<=c.now) OR
      (s.status='SCHEDULED' AND s."opensAt"<=c.now AND (s."closesAt" IS NULL OR s."closesAt">c.now))
    ORDER BY s.id LIMIT $1 FOR UPDATE OF s SKIP LOCKED)
    UPDATE "AssessmentSession" s SET status=c.target::"SessionStatus","updatedAt"=${now} FROM candidates c WHERE s.id=c.id`,limit);
}

export async function runMaintenance(db:PrismaClient, input:MaintenanceOptions = {}, fence?:MaintenanceFence):Promise<MaintenanceResult> {
  const {signal,...raw}=input, options=settings.parse(raw);
  if(new Set(options.stages).size!==options.stages.length) throw Error("MAINTENANCE_STAGES_INVALID");
  const started=performance.now(),control=new MaintenanceControl(options.budgetMs,options.sqlTimeoutMs,signal,fence);
  const result:MaintenanceResult={stop:"MAX_BATCHES",batches:0,rows:0,elapsedMs:0,stage:null,changed:{},oldestUnpublishedDueLagSeconds:null};
  const publications=new JobPublications(db,control);
  try {
    control.check();
    const [lag]=await control.transaction(db,tx=>tx.$queryRawUnsafe<{lag:number}[]>(`SELECT COALESCE(GREATEST(0,extract(epoch FROM (${now}-min(t.due)))),0)::float8 AS lag FROM (
      (SELECT "nextAttemptAt" AS due FROM "JobPublicationIntent" WHERE state='PENDING' AND "nextAttemptAt"<=${now} ORDER BY "nextAttemptAt" LIMIT 1)
      UNION ALL (SELECT "leaseUntil" FROM "JobPublicationIntent" WHERE state='PUBLISHING' AND "leaseUntil"<=${now} ORDER BY "leaseUntil" LIMIT 1)) t`));
    result.oldestUnpublishedDueLagSeconds=lag.lag;
    let idle=0;
    for(let batch=0;batch<options.maxBatches;batch++) {
      control.check();
      const stage=options.stages[batch%options.stages.length];result.stage=stage;
      const remaining=options.maxRows-result.rows;
      const limit=Math.min(options.batchSize,stage==="retention"?Math.floor(remaining/8):stage==="technicalRetention"?Math.floor(remaining/3):remaining);
      if(limit<1){result.stop="ROW_LIMIT";break;}
      result.batches++;
      let changed:number;
      if(stage==="technicalRetention"){
        const details=await control.transaction(db,tx=>retainTechnicalData(tx,limit));
        const previous=result.technicalRetention;
        result.technicalRetention={observedIntents:(previous?.observedIntents??0)+details.observedIntents,deletedIntents:(previous?.deletedIntents??0)+details.deletedIntents,
          compactedRuns:(previous?.compactedRuns??0)+details.compactedRuns,oldestEligibleLagSeconds:Math.max(previous?.oldestEligibleLagSeconds??0,details.oldestEligibleLagSeconds)};
        changed=details.observedIntents+details.deletedIntents+details.compactedRuns;
      }
      else if(stage==="retention") changed=Object.values(await new EmailBudget(db).purgeExpiredData(limit,control)).reduce((a,b)=>a+b,0);
      else if(["missingReports","missingIntents","staleIntents","rearm"].includes(stage)) {
        const phase=({missingReports:"reports",missingIntents:"intents",staleIntents:"cancelled",rearm:"rearmed"} as const)[stage as "missingReports"];
        changed=Object.values(await publications.reconcile(limit,[phase])).reduce((a,b)=>a+b,0);
      } else changed=await control.transaction(db,tx=>{
        if(stage==="otpInitial"||stage==="otpRetake")return reconcileOtp(tx,stage==="otpInitial"?"ParticipantEmailDeliveryJob":"OtpDeliveryJob",limit);
        if(stage==="reportSummary"||stage==="reportEmail")return reconcileReports(tx,stage==="reportSummary"?"SUMMARY":"EMAIL",limit);
        if(stage==="sessions")return sessions(tx,limit);
        return tx.$executeRawUnsafe(`WITH expired AS (SELECT nonce FROM "ProxyRequestNonce" WHERE "expiresAt"<${now}
          ORDER BY "expiresAt",nonce LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM "ProxyRequestNonce" n USING expired e WHERE n.nonce=e.nonce`,limit);
      });
      result.rows+=changed;result.changed[stage]=(result.changed[stage]??0)+changed;
      idle=changed===0?idle+1:0;
      if(result.rows>=options.maxRows){result.stop="ROW_LIMIT";break;}
      if(idle>=options.stages.length){result.stop="IDLE";break;}
    }
  } catch(error) {
    result.stop=error instanceof MaintenanceStopped?error.code:signal?.aborted?"ABORTED":control.remaining()<10?"DEADLINE":"FAILED";
    if(result.stop==="FAILED")result.errorCode="MAINTENANCE_UNAVAILABLE";
  }
  result.elapsedMs=Math.round(performance.now()-started);
  return result;
}
