import {test} from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {connectLot4NativeDatabase} from "./helpers/native-postgres.js";
import {runMaintenance} from "../src/services/maintenance.service.js";
import {MaintenanceControl} from "../src/services/maintenance-control.js";

test("Retention survives stale dependency statistics at the unchanged six-month volume",{
  skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned temporary synthetic PostgreSQL required",timeout:120000,
},async t=>{
  const {client:db}=await connectLot4NativeDatabase();
  try{
    await db.$executeRawUnsafe(`TRUNCATE "MaintenanceReplayReceipt","MaintenanceLease","MaintenanceRun","MaintenanceTask","JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
    // Reproduce the observed statistics window deterministically: the receipt
    // distribution was analyzed before replacement by a bulk of UNCERTAIN rows.
    // The settings affect only this owned synthetic cluster and are reset below.
    for(const table of ["EmailBudgetReservation","AdaptiveReportJob"]){
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" SET (autovacuum_enabled=false)`);
      await db.$executeRawUnsafe(`ANALYZE "${table}"`);
    }
    await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"expiresAt")
      SELECT gen_random_uuid(),gen_random_uuid()::text,'OTP',date_trunc('day',clock_timestamp()),gen_random_uuid(),$1,
        CASE WHEN n=1 THEN 'UNCERTAIN' ELSE 'ACCEPTED' END,clock_timestamp()+interval '1 day' FROM generate_series(1,10000) n`,"d".repeat(64));
    await db.$executeRawUnsafe(`ANALYZE "EmailBudgetReservation"`);
    await db.$executeRawUnsafe(`TRUNCATE "EmailBudgetReservation"`);
    await db.$executeRawUnsafe(`INSERT INTO "JobPublicationIntent" (id,kind,"jobId",phase,generation,"dueAt",state,attempts,"nextAttemptAt","publishedAt","createdAt","retentionObservedAt")
      SELECT gen_random_uuid(),'OTP_INITIAL',gen_random_uuid(),'DELIVER',0,c.now-interval '180 days',CASE WHEN n<=40000 THEN 'PUBLISHED' ELSE 'CANCELLED' END,
        CASE WHEN n<=40000 THEN 1 ELSE 0 END,c.now-interval '180 days',CASE WHEN n<=40000 THEN c.now-interval '179 days' ELSE NULL END,
        c.now-interval '180 days',CASE WHEN n<=90000 THEN c.now-interval '31 days' ELSE NULL END
      FROM generate_series(1,100000) n CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
    await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","expiresAt")
      SELECT gen_random_uuid(),p."jobId"::text,'OTP',date_trunc('day',c.now),p."jobId",$1,'UNCERTAIN',c.now-interval '2 minutes',c.now-interval '1 minute',c.now+interval '30 days'
      FROM (SELECT "jobId" FROM "JobPublicationIntent" WHERE state='CANCELLED' AND "retentionObservedAt" IS NOT NULL ORDER BY id LIMIT 10000) p CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`,"d".repeat(64));
    await db.$executeRawUnsafe(`INSERT INTO "AdaptiveInterview" (id,"displayName","tokenHash",state,"expiresAt","createdAt","updatedAt")
      SELECT p."jobId",'Synthetic statistics',replace(p."jobId"::text,'-','')||replace(p."jobId"::text,'-',''),'{}'::jsonb,c.now+interval '1 day',c.now,c.now
      FROM (SELECT p."jobId" FROM "JobPublicationIntent" p WHERE p.state='CANCELLED' AND p."retentionObservedAt" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=p."jobId"::text) ORDER BY p.id LIMIT 10000) p CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
    await db.$executeRawUnsafe(`INSERT INTO "AdaptiveReportJob" (id,"interviewId",status,"emailStatus","createdAt","updatedAt") SELECT id,id,'PENDING','NOT_REQUESTED',clock_timestamp(),clock_timestamp() FROM "AdaptiveInterview"`);
    await db.$executeRawUnsafe(`INSERT INTO "MaintenanceRun" (id,task,"attemptToken",state,"startedAt","finishedAt","stopCode")
      SELECT gen_random_uuid(),'cleanup',gen_random_uuid(),CASE WHEN n<=12000 THEN 'COMPLETED' ELSE 'RUNNING' END,c.now-interval '180 days',CASE WHEN n<=12000 THEN c.now-interval '100 days' ELSE NULL END,'IDLE'
      FROM generate_series(1,13000) n CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
    await db.$executeRawUnsafe(`ANALYZE "JobPublicationIntent"`);
    await db.$executeRawUnsafe(`ANALYZE "MaintenanceRun"`);
    const count=async(table:string)=>(await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
    assert.equal(await count("JobPublicationIntent"),110000);
    assert.equal(await count("MaintenanceRun"),13000);
    const stats=await db.$queryRawUnsafe(`SELECT relname,reltuples::float8 FROM pg_class WHERE relname IN ('EmailBudgetReservation','AdaptiveReportJob')`);
    const timings:unknown[]=[],transaction=MaintenanceControl.prototype.transaction;
    t.mock.method(MaintenanceControl.prototype,"transaction",async function(this:MaintenanceControl,client:any,work:any){
      return transaction.call(this,client,async tx=>{
        const [settings]=await tx.$queryRawUnsafe<any[]>(`SELECT current_setting('statement_timeout') AS timeout`);
        return work(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key);if(key!=="$queryRawUnsafe")return typeof value==="function"?value.bind(target):value;
          return async(...args:any[])=>{const at=performance.now();try{return await value.apply(target,args)}catch(error:any){timings.push({errorCode:error.code,sqlState:error.meta?.code});throw error}finally{if(String(args[0]).includes(" AS lag"))timings.push({query:"oldestEligibleLag",timeout:settings.timeout,durationMs:performance.now()-at})}};
        }}));
      });
    });
    const started=performance.now();
    const result=await runMaintenance(db,{stages:["technicalRetention"],batchSize:100,maxBatches:1,maxRows:10000,budgetMs:30000,sqlTimeoutMs:4000});
    console.log("5C-R1 stale statistics",JSON.stringify({stats,timings,elapsedMs:Math.round(performance.now()-started),result}));
    assert.notEqual(result.stop,"FAILED");
    assert.deepEqual([result.technicalRetention?.observedIntents,result.technicalRetention?.deletedIntents,result.technicalRetention?.compactedRuns],[100,100,100]);
    assert.equal(await count("JobPublicationIntent"),109900);
    assert.equal(await count("EmailBudgetReservation"),10000);
    assert.equal(await count("AdaptiveReportJob"),10000);
    assert.equal(await count("MaintenanceReplayReceipt"),100);
  }finally{
    for(const table of ["EmailBudgetReservation","AdaptiveReportJob"]){await db.$executeRawUnsafe(`ALTER TABLE "${table}" RESET (autovacuum_enabled)`)}
    await db.$disconnect();
  }
});
