import type {Prisma} from "@prisma/client";

export type TechnicalRetentionResult={observedIntents:number;deletedIntents:number;compactedRuns:number;oldestEligibleLagSeconds:number};
export const INTENT_RETENTION_DAYS=30,MAINTENANCE_DETAIL_RETENTION_DAYS=90;
const clock=`(clock_timestamp() AT TIME ZONE 'UTC')`;
// A CANCELLED row is insufficient: attempted/published messages have no proven
// maximum delivery horizon. Existing jobs (including terminal ones) stay intact.
const neverPublished=`p.state='CANCELLED' AND p.attempts=0 AND p."publishedAt" IS NULL AND p."leaseUntil" IS NULL AND p."attemptToken" IS NULL`;
// Keep the reservation check as a correlated unique-logicalKey probe. OFFSET 0
// preserves EXISTS semantics but prevents a pulled-up nested anti join from
// repeatedly scanning every receipt when status statistics underestimate them.
const noDependencies=`NOT EXISTS (SELECT 1 FROM "ParticipantEmailDeliveryJob" j WHERE j.id=p."jobId")
  AND NOT EXISTS (SELECT 1 FROM "OtpDeliveryJob" j WHERE j.id=p."jobId")
  AND NOT EXISTS (SELECT 1 FROM "AdaptiveReportJob" j WHERE j.id=p."jobId")
  AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=p."jobId"::text
    AND (r.status IN ('RESERVED','UNCERTAIN') OR r."leaseUntil" IS NOT NULL OR r."attemptToken" IS NOT NULL) OFFSET 0)
  AND NOT EXISTS (SELECT 1 FROM "JobPublicationIntent" s WHERE s."jobId"=p."jobId" AND s.id<>p.id
    AND (s.state IN ('PENDING','PUBLISHING') OR s."leaseUntil" IS NOT NULL OR s."attemptToken" IS NOT NULL))`;

// Caller owns a bounded transaction (MaintenanceControl, optionally 4B-fenced).
// No transport, job processing, deletion of reservations or anti-replay receipts.
export async function retainTechnicalData(tx:Prisma.TransactionClient,limit:number):Promise<TechnicalRetentionResult>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("TECHNICAL_RETENTION_BATCH_INVALID");
  await tx.$executeRawUnsafe(`INSERT INTO "EmailProviderState" (provider) VALUES ('BREVO') ON CONFLICT DO NOTHING`);
  await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);
  const observedIntents=await tx.$executeRawUnsafe(`WITH candidates AS (
    SELECT p.id FROM "JobPublicationIntent" p WHERE ${neverPublished} AND p."retentionObservedAt" IS NULL AND ${noDependencies}
    ORDER BY p."createdAt",p.id LIMIT $1 FOR UPDATE OF p SKIP LOCKED)
    UPDATE "JobPublicationIntent" p SET "retentionObservedAt"=${clock} FROM candidates c WHERE p.id=c.id`,limit);
  const [{lag}]=await tx.$queryRawUnsafe<{lag:number}[]>(`SELECT COALESCE(GREATEST(0,extract(epoch FROM (${clock}-interval '30 days'-min(t."retentionObservedAt")))),0)::float8 AS lag
    FROM (SELECT p."retentionObservedAt" FROM "JobPublicationIntent" p WHERE ${neverPublished}
      AND p."retentionObservedAt"<=${clock}-interval '30 days' AND p."createdAt"<=p."retentionObservedAt" AND ${noDependencies}
      ORDER BY p."retentionObservedAt",p.id LIMIT 1) t`);
  const deletedIntents=await tx.$executeRawUnsafe(`WITH candidates AS (
    SELECT p.id FROM "JobPublicationIntent" p WHERE ${neverPublished}
      AND p."retentionObservedAt"<=${clock}-interval '30 days' AND p."createdAt"<=p."retentionObservedAt" AND ${noDependencies}
    ORDER BY p."retentionObservedAt",p.id LIMIT $1 FOR UPDATE OF p SKIP LOCKED)
    DELETE FROM "JobPublicationIntent" p USING candidates c WHERE p.id=c.id`,limit);
  const compactedRuns=await tx.$executeRawUnsafe(`WITH candidates AS MATERIALIZED (
    SELECT r.id FROM "MaintenanceRun" r WHERE r.state IN ('COMPLETED','PARTIAL','FAILED','INTERRUPTED')
      AND r."finishedAt"<=${clock}-interval '90 days' AND r."startedAt"<=r."finishedAt"
      AND NOT EXISTS (SELECT 1 FROM "MaintenanceLease" l WHERE l."runId"=r.id)
    ORDER BY r."finishedAt",r.id LIMIT $1 FOR UPDATE OF r SKIP LOCKED), receipts AS (
    INSERT INTO "MaintenanceReplayReceipt" (id) SELECT id FROM candidates ON CONFLICT DO NOTHING RETURNING id)
    DELETE FROM "MaintenanceRun" r USING candidates c WHERE r.id=c.id
      AND (EXISTS (SELECT 1 FROM receipts t WHERE t.id=r.id) OR EXISTS (SELECT 1 FROM "MaintenanceReplayReceipt" t WHERE t.id=r.id))`,limit);
  return {observedIntents,deletedIntents,compactedRuns,oldestEligibleLagSeconds:lag};
}
