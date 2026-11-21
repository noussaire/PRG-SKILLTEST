import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import type {PrismaClient} from "@prisma/client";
import type {Server} from "node:http";
import {connectLot4NativeDatabase} from "./helpers/native-postgres.js";
import {runMaintenance} from "../src/services/maintenance.service.js";
import {retainTechnicalData} from "../src/services/technical-retention.service.js";
import {MaintenanceControl} from "../src/services/maintenance-control.js";
import {MaintenanceInvocations} from "../src/services/maintenance-invocation.service.js";
import {JobPublications,type JobNotification} from "../src/services/job-publication.service.js";
import {signQstash,qstashCurrent,qstashNext,qstashUrl} from "./helpers/qstash-signature.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned synthetic PostgreSQL required",timeout:120000};
const day=86400000,ago=(days:number)=>new Date(Date.now()-days*day),future=()=>ago(-1),secret=Buffer.alloc(32,97).toString("base64url"),h="d".repeat(64);
let db:PrismaClient,other:PrismaClient,server:Server,base:string,entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant,calls:number;
const localFetch=globalThis.fetch.bind(globalThis);
before(async()=>{if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:"retention4c-synthetic-pepper-0123456789abcdef",DOTENV_CONFIG_PATH:resolve("output/maintenance-step4c-20261031/nonexistent.env")});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  const {app}=await import("../src/app.js");server=app.listen(0,"127.0.0.1");await once(server,"listening");const a=server.address();assert.ok(a&&typeof a!=="string");base=`http://127.0.0.1:${a.port}`;
});
beforeEach(async t=>{if(options.skip)return;calls=0;
  Object.assign(process.env,{SKILLQUEST_MAINTENANCE_ENABLED:"1",SKILLQUEST_MAINTENANCE_SECRET:secret,SKILLQUEST_QSTASH_MODE:"simulated",QSTASH_CURRENT_SIGNING_KEY:qstashCurrent,QSTASH_NEXT_SIGNING_KEY:qstashNext,QSTASH_CALLBACK_URL:qstashUrl,
    BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",GROQ_API_KEY:"synthetic-no-network",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300"});
  delete process.env.OTP_ENCRYPTION_KEYS;
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{const url=String(input);if(url.startsWith(base+"/"))return localFetch(input,init);
    if(url==="https://api.brevo.com/v3/smtp/email"){calls++;return Response.json({messageId:"synthetic"},{status:201})}throw Error("ALL_EXTERNAL_NETWORK_FORBIDDEN")});
  await db.$executeRawUnsafe(`TRUNCATE "MaintenanceReplayReceipt","MaintenanceLease","MaintenanceRun","MaintenanceTask","JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async()=>{if(options.skip)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await db.$disconnect();await other.$disconnect()});
async function count(table:string){return (await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${table}"`))[0].n as number}
async function getIntent(id:string){return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "JobPublicationIntent" WHERE id=$1::uuid`,id))[0]}
async function intent(input:{state?:string;attempts?:number;published?:boolean;observed?:Date|null;jobId?:string;kind?:string}={}){
  const id=randomUUID(),jobId=input.jobId??randomUUID(),state=input.state??"CANCELLED",due=ago(180);
  await db.$executeRawUnsafe(`INSERT INTO "JobPublicationIntent" (id,kind,"jobId",phase,generation,"dueAt",state,attempts,"nextAttemptAt","leaseUntil","attemptToken","publishedAt","createdAt","retentionObservedAt")
    VALUES ($1::uuid,$2,$3::uuid,$11,0,$4,$5,$6,$4,$7,$8::uuid,$9,$4,$10)`,id,input.kind??"OTP_INITIAL",jobId,due,state,input.attempts??0,
    state==="PUBLISHING"?future():null,state==="PUBLISHING"?randomUUID():null,input.published?ago(179):null,input.observed===undefined?ago(31):input.observed,input.kind==="REPORT"?"EMAIL":"DELIVER");
  return {id,jobId,due};
}
async function terminalRun(state="COMPLETED",finishedAt=ago(100)){
  const id=randomUUID(),token=randomUUID();await db.$executeRawUnsafe(`INSERT INTO "MaintenanceRun" (id,task,"attemptToken",state,"startedAt","finishedAt","stopCode") VALUES ($1::uuid,'cleanup',$2::uuid,$3,$4,$5,'IDLE')`,id,token,state,ago(180),state==="RUNNING"?null:finishedAt);return {id,token};
}
async function reservation(key:string,status:string,leased=false){
  await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","leaseUntil","attemptToken","createdAt","expiresAt")
    VALUES ($1::uuid,$2,'OTP',$3,$2::uuid,$4,$5,$6,$7,$8,$9::uuid,$10,$11)`,randomUUID(),key,ago(180),h,status,status==="RELEASED"?null:ago(180),status==="RELEASED"?null:ago(179),leased?future():null,leased?randomUUID():null,ago(180),ago(100));
}
const retention=(client=db,extra:Parameters<typeof runMaintenance>[1]={})=>runMaintenance(client,{stages:["technicalRetention"],batchSize:10,maxBatches:2,budgetMs:5000,...extra});
async function initial(){const r=await entry({fullName:"Synthetic retention",email:randomUUID()+"@example.test",language:"fr",emailReport:false});assert.equal(r.status,409);return db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:r.body.challengeId as string}})}
async function notification(p:Awaited<ReturnType<typeof intent>>){const body=JSON.stringify({version:1,notificationId:p.id,kind:"OTP_INITIAL",jobId:p.jobId,phase:"DELIVER",generation:0,dueAt:p.due.toISOString()});return fetch(base+"/api/internal/jobs/qstash",{method:"POST",headers:{"Content-Type":"application/json","Upstash-Signature":signQstash(body)},body})}
function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {open,wait}}

test("PUBLISHED is retained even with no job, regardless of age or zero attempts",options,async()=>{
  for(const attempts of [0,1,10])await intent({state:"PUBLISHED",attempts,published:true});assert.equal((await retention()).rows,0);assert.equal(await count("JobPublicationIntent"),3);
});
test("PUBLISHED with an executable OTP remains available to its real simulated publisher",options,async()=>{
  const j=await initial();const sent:JobNotification[]=[];await new JobPublications(db).publishBatch({publish:async n=>{sent.push(n)}});assert.equal(sent.length,1);
  const before=await getIntent(sent[0].notificationId);await retention();assert.deepEqual(await getIntent(before.id),before);assert.equal(calls,0);
});
test("A cancelled but attempted or previously published notification is never age-purged",options,async()=>{
  await intent({attempts:1});await intent({published:true});assert.equal((await retention()).rows,0);assert.equal(await count("JobPublicationIntent"),2);
});
test("Old creation date alone never qualifies: observation starts now and waits 30 days",options,async()=>{
  const p=await intent({observed:null});const r=await retention();assert.equal(r.technicalRetention!.observedIntents,1);assert.equal(r.technicalRetention!.deletedIntents,0);
  assert.ok(Date.now()-(await getIntent(p.id)).retentionObservedAt.getTime()<2000);assert.ok(await getIntent(p.id));
});
test("Truly terminal unattempted orphan is purged after independent 30-day observation",options,async()=>{
  const j=await initial();await db.participantEmailDeliveryJob.delete({where:{id:j.id}});
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "createdAt"=$1 WHERE "jobId"=$2::uuid`,ago(180),j.id);
  await retention();await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "retentionObservedAt"=$1 WHERE "jobId"=$2::uuid`,ago(31),j.id);
  const r=await retention();assert.equal(r.technicalRetention!.deletedIntents,1);assert.equal(await count("JobPublicationIntent"),0);assert.equal(calls,0);
});
test("A recent or incoherently dated observation is retained",options,async()=>{
  await intent({observed:ago(29)});const p=await intent();await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "createdAt"=$1 WHERE id=$2::uuid`,ago(1),p.id);
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "retentionObservedAt"=$1 WHERE id=$2::uuid`,ago(31),p.id);
  await retention();assert.equal(await count("JobPublicationIntent"),2);
});
test("Changes to publication metadata invalidate an old observation",options,async()=>{
  const p=await intent();await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "lastErrorCode"='CHANGED' WHERE id=$1::uuid`,p.id);assert.equal((await getIntent(p.id)).retentionObservedAt,null);
  const r=await retention();assert.equal(r.technicalRetention!.deletedIntents,0);assert.ok((await getIntent(p.id)).retentionObservedAt>ago(1));
});
test("Any existing job is retained, including a terminal job with ciphertext cleared",options,async()=>{
  const j=await initial();await db.participantEmailDeliveryJob.update({where:{id:j.id},data:{status:"REJECTED",encryptedPayload:null,nextAttemptAt:null}});
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "createdAt"=$1 WHERE "jobId"=$2::uuid`,ago(180),j.id);
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "retentionObservedAt"=$1 WHERE "jobId"=$2::uuid`,ago(31),j.id);assert.equal((await retention()).rows,0);assert.equal(await count("JobPublicationIntent"),1);
});
for(const status of ["UNCERTAIN","RESERVED"] as const)test(`Expired ${status} reservation preserves all notification evidence`,options,async()=>{
  const p=await intent();await reservation(p.jobId,status);const before=await db.emailBudgetReservation.findFirstOrThrow();assert.equal((await retention()).rows,0);
  assert.ok(await getIntent(p.id));assert.deepEqual(await db.emailBudgetReservation.findFirstOrThrow(),before);
});
for(const status of ["ACCEPTED","REJECTED","RELEASED"] as const)test(`Terminal ${status} idempotency receipt survives orphan intent deletion`,options,async()=>{
  const p=await intent();await reservation(p.jobId,status);const saved=await db.emailBudgetReservation.findFirstOrThrow();assert.equal((await retention()).technicalRetention!.deletedIntents,1);
  assert.deepEqual(await db.emailBudgetReservation.findFirstOrThrow(),saved);
});
test("Active receipt lease prevents deletion even with a terminal reservation status",options,async()=>{
  const p=await intent();await reservation(p.jobId,"ACCEPTED",true);assert.equal((await retention()).rows,0);assert.ok(await getIntent(p.id));
});
test("Active or expired recoverable publication lease and sibling prevent deletion",options,async()=>{
  const p=await intent(),s=await intent({state:"PUBLISHING",attempts:1,jobId:p.jobId});assert.equal((await retention()).rows,0);
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "leaseUntil"=$1 WHERE id=$2::uuid`,ago(1),s.id);assert.equal((await retention()).rows,0);assert.equal(await count("JobPublicationIntent"),2);
});
test("UNKNOWN report and its UNCERTAIN budget evidence are conserved",options,async()=>{
  const i=await db.adaptiveInterview.create({data:{displayName:"Synthetic",tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:{},expiresAt:ago(100)}});
  const j=await db.adaptiveReportJob.create({data:{interviewId:i.id,status:"COMPLETE",emailStatus:"UNKNOWN",summary:"synthetic"}});
  const p=await intent({kind:"REPORT",jobId:j.id});
  await reservation(j.id,"UNCERTAIN");const saved=await db.adaptiveReportJob.findUniqueOrThrow({where:{id:j.id}});await retention();assert.deepEqual(await db.adaptiveReportJob.findUniqueOrThrow({where:{id:j.id}}),saved);assert.ok(await getIntent(p.id));assert.equal(await count("EmailBudgetReservation"),1);
});
test("Signed old notification becomes a strict 409 after purge without job recreation",options,async()=>{
  const p=await intent();assert.equal((await notification(p)).status,200);await retention();assert.equal((await notification(p)).status,409);
  assert.equal(await count("AdaptiveInterview"),0);assert.equal(await count("EmailBudgetReservation"),0);assert.equal(calls,0);
});
test("Concurrent late callback and purge never resurrect or execute an orphan",options,async()=>{
  const p=await intent();const [a,b]=await Promise.all([retention(other),notification(p)]);assert.equal(a.technicalRetention!.deletedIntents,1);assert.ok([200,409].includes(b.status));assert.equal(calls,0);assert.equal(await count("AdaptiveInterview"),0);
});
test("A publisher and retention concurrently preserve a valid activation and stable UUID",options,async()=>{
  await initial();const sent:string[]=[];const [a,b]=await Promise.all([new JobPublications(db).publishBatch({publish:async n=>{sent.push(n.notificationId)}}),retention(other)]);
  assert.equal(a.published,1);assert.equal(sent.length,1);assert.equal(b.technicalRetention!.deletedIntents,0);assert.equal((await getIntent(sent[0])).state,"PUBLISHED");assert.equal(calls,0);
});
for(const state of ["COMPLETED","PARTIAL","FAILED","INTERRUPTED"])test(`Old ${state} maintenance details compact atomically while UUID remains rejected`,options,async()=>{
  const r=await terminalRun(state);const summary=await retention();assert.equal(summary.technicalRetention!.compactedRuns,1);assert.equal(await count("MaintenanceRun"),0);assert.equal(await count("MaintenanceReplayReceipt"),1);
  for(const task of ["cleanup","sessions"] as const)await assert.rejects(new MaintenanceInvocations(db).run(task,r.id),/REPLAY/);
});
test("Recent, RUNNING and malformed-date maintenance records are not compacted",options,async()=>{
  await terminalRun("COMPLETED",ago(89));await terminalRun("RUNNING");await terminalRun("COMPLETED",ago(181));assert.equal((await retention()).technicalRetention!.compactedRuns,0);assert.equal(await count("MaintenanceRun"),3);
});
for(const active of [true,false])test(`${active?"Active":"Expired"} lease reference conserves detailed maintenance proof`,options,async()=>{
  const r=await terminalRun();await db.$executeRawUnsafe(`INSERT INTO "MaintenanceLease" (name,"runId","attemptToken","leaseUntil") VALUES ('maintenance',$1::uuid,$2::uuid,$3)`,r.id,r.token,active?future():ago(1));
  assert.equal((await retention()).technicalRetention!.compactedRuns,0);assert.equal(await count("MaintenanceRun"),1);
});
test("Minimal replay evidence cannot be updated or deleted by normal SQL",options,async()=>{
  const r=await terminalRun();await retention();await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "MaintenanceReplayReceipt" WHERE id=$1::uuid`,r.id));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "MaintenanceReplayReceipt" SET "retiredAt"=$2 WHERE id=$1::uuid`,r.id,future()));assert.equal(await count("MaintenanceReplayReceipt"),1);
});
test("An older 4B consumer cannot bypass replay protection after detailed metadata compaction",options,async()=>{
  const r=await terminalRun();await retention();let executed=0;
  // Keep the old admission SQL from the verified backup. Bind only its imports
  // to the installed workspace dependencies (not copied into the backup).
  const require=createRequire(resolve("backend/package.json"));
  const original=await readFile(resolve("output/maintenance-step4c-20261031/backup/backend/src/services/maintenance-invocation.service.ts"),"utf8");
  const source=original.replace('"zod"',JSON.stringify(pathToFileURL(require.resolve("zod")).href))
    .replace('"./maintenance.service.js"',JSON.stringify(pathToFileURL(resolve("backend/src/services/maintenance.service.ts")).href));
  const file=resolve("output/maintenance-step4c-20261031/legacy-4b-consumer.ts");await writeFile(file,source);
  const old=await import(pathToFileURL(file).href);
  const consumer=new old.MaintenanceInvocations(db,async()=>{executed++;return {stop:"IDLE",batches:0,rows:0,elapsedMs:0,stage:null,changed:{},oldestUnpublishedDueLagSeconds:0}});
  await assert.rejects(consumer.run("cleanup",r.id),(error:any)=>error.meta?.code==="23505"||error.code==="P2002");assert.equal(executed,0);assert.equal(await count("MaintenanceRun"),0);assert.equal(await count("MaintenanceReplayReceipt"),1);
});
test("Retention never resets cooldown, global lease or participant replay nonces",options,async()=>{
  await new MaintenanceInvocations(db).run("sessions",randomUUID());const tasks=await db.$queryRawUnsafe<any[]>(`SELECT * FROM "MaintenanceTask"`),leases=await db.$queryRawUnsafe<any[]>(`SELECT * FROM "MaintenanceLease"`);
  const nonce=randomUUID();await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") VALUES ($1::uuid,$2)`,nonce,future());await retention();
  assert.deepEqual(await db.$queryRawUnsafe(`SELECT * FROM "MaintenanceTask"`),tasks);assert.deepEqual(await db.$queryRawUnsafe(`SELECT * FROM "MaintenanceLease"`),leases);assert.equal(await count("ProxyRequestNonce"),1);
});
test("Lock held on an eligible intent is skipped and next invocation resumes",options,async()=>{
  const p=await intent(),entered=gate(),release=gate();const locker=other.$transaction(async tx=>{await tx.$queryRawUnsafe(`SELECT id FROM "JobPublicationIntent" WHERE id=$1::uuid FOR UPDATE`,p.id);entered.open();await release.wait},{timeout:5000});
  try{await entered.wait;const r=await retention();assert.equal(r.technicalRetention!.deletedIntents,0);assert.ok(await getIntent(p.id))}finally{release.open();await locker}
  assert.equal((await retention()).technicalRetention!.deletedIntents,1);
});
test("Two native connections compact and delete disjoint batches without losing anti-replay IDs",options,async()=>{
  for(let n=0;n<8;n++){await intent();await terminalRun()}
  const pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  const result=await Promise.all([retention(db,{batchSize:3,maxBatches:5}),retention(other,{batchSize:3,maxBatches:5})]);assert.equal(result.reduce((a,r)=>a+r.technicalRetention!.deletedIntents,0),8);assert.equal(result.reduce((a,r)=>a+r.technicalRetention!.compactedRuns,0),8);
  assert.equal(await count("MaintenanceReplayReceipt"),8);console.log("4C retention concurrency",JSON.stringify({pids:pids.map(p=>p[0].pid),deletedIntents:8,permanentReceipts:8}));
});
test("Failure inserting replay evidence rolls back earlier deletion and detailed-run compaction",options,async()=>{
  const p=await intent();await terminalRun();await db.$executeRawUnsafe(`CREATE FUNCTION fail_4c_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SYNTHETIC_RECEIPT_FAILURE'; END$$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_4c_receipt BEFORE INSERT ON "MaintenanceReplayReceipt" FOR EACH ROW EXECUTE FUNCTION fail_4c_receipt()`);
  try{const r=await retention();assert.equal(r.stop,"FAILED");assert.ok(await getIntent(p.id));assert.equal(await count("MaintenanceRun"),1);assert.equal(await count("MaintenanceReplayReceipt"),0)}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER fail_4c_receipt ON "MaintenanceReplayReceipt"`);await db.$executeRawUnsafe(`DROP FUNCTION fail_4c_receipt()`)}
  assert.equal((await retention()).technicalRetention!.deletedIntents,1);
});
test("Cancellation after technical mutations rolls back the whole batch including minimal receipt",options,async()=>{
  const p=await intent();await terminalRun();const c=new AbortController();await assert.rejects(new MaintenanceControl(1000,500,c.signal).transaction(db,async tx=>{await retainTechnicalData(tx,10);c.abort()}),/ABORTED/);
  assert.ok(await getIntent(p.id));assert.equal(await count("MaintenanceRun"),1);assert.equal(await count("MaintenanceReplayReceipt"),0);
});
test("Explicit row and batch ceilings remain enforced for technical retention",options,async()=>{
  for(let n=0;n<10;n++){await intent({observed:null});await intent();await terminalRun()}
  const r=await retention(db,{batchSize:5,maxBatches:1,maxRows:9});assert.equal(r.rows,9);assert.deepEqual([r.technicalRetention!.observedIntents,r.technicalRetention!.deletedIntents,r.technicalRetention!.compactedRuns],[3,3,3]);assert.equal(r.stop,"ROW_LIMIT");
});
test("HTTP cleanup runs retention under 4B fencing without changing disabled-by-default behavior",options,async()=>{
  const p=await intent(),r=await terminalRun();delete process.env.SKILLQUEST_MAINTENANCE_ENABLED;
  const headers={Authorization:`Bearer ${secret}`,"X-Skillquest-Maintenance-Id":randomUUID()};assert.equal((await fetch(base+"/api/internal/maintenance/cleanup",{headers})).status,503);assert.ok(await getIntent(p.id));
  process.env.SKILLQUEST_MAINTENANCE_ENABLED="1";const response=await fetch(base+"/api/internal/maintenance/cleanup",{headers});assert.equal(response.status,200);assert.equal(await getIntent(p.id),undefined);
  await assert.rejects(new MaintenanceInvocations(db).run("sessions",r.id),/REPLAY/);assert.equal(calls,0);
});

for(const boundary of ["before-commit","after-commit"] as const)test(`Killed retention process ${boundary} preserves all evidence and resumes`,options,async()=>{
  const p=await intent(),r=await terminalRun(),entered=gate(),release=gate();
  const blocker=boundary==="before-commit"?other.$transaction(async tx=>{await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(44100403::bigint)::text");entered.open();await release.wait},{timeout:15000}):Promise.resolve();if(boundary==="before-commit")await entered.wait;
  const child=spawn(process.execPath,["--loader",pathToFileURL(resolve("output/lot3-rollback-6f44523a33/test-loader.mjs")).href,resolve("backend/tests/helpers/technical-retention-crash.ts")],{
    windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:"test",LOT4_NATIVE_CONTEXT:process.env.LOT4_NATIVE_CONTEXT,RETENTION_CRASH_BOUNDARY:boundary},stdio:["ignore","pipe","pipe","ipc"]});
  const exited=once(child,"exit"),ready=new Promise<void>(resolve=>child.on("message",m=>{if((m as any).boundary===boundary)resolve()}));let logs="",timer:ReturnType<typeof setTimeout>|undefined;child.stderr!.on("data",v=>logs+=v);
  try{await Promise.race([ready,exited.then(()=>{throw Error(logs)}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Owned crash timeout: "+logs)),10000)})]);child.kill();await exited}
  finally{if(timer)clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill();await exited}if(boundary==="before-commit")release.open();await blocker}
  assert.equal(await count("MaintenanceRun"),boundary==="before-commit"?1:0);assert.equal(await count("MaintenanceReplayReceipt"),boundary==="before-commit"?0:1);assert.equal(!!await getIntent(p.id),boundary==="before-commit");
  await retention();await assert.rejects(new MaintenanceInvocations(db).run("sessions",r.id),/REPLAY/);console.log("4C killed process",JSON.stringify({boundary,childPid:child.pid,replayPreserved:true}));
});

test("Six-month synthetic growth: 110000 intents and 13000 runs drain bounded eligible batches with indexed plans",{...options,timeout:240000},async t=>{
  const sizes=async()=>{const [s]=await db.$queryRawUnsafe<any[]>(`SELECT
    pg_total_relation_size('"MaintenanceRun"')::float8 AS "allocatedRunBytes",pg_total_relation_size('"MaintenanceReplayReceipt"')::float8 AS "allocatedReceiptBytes",
    (SELECT COALESCE(sum(pg_column_size(r)),0)::float8 FROM "MaintenanceRun" r) AS "logicalRunBytes",
    (SELECT COALESCE(sum(pg_column_size(r)),0)::float8 FROM "MaintenanceReplayReceipt" r) AS "logicalReceiptBytes"`);return s};
  await db.$executeRawUnsafe(`INSERT INTO "JobPublicationIntent" (id,kind,"jobId",phase,generation,"dueAt",state,attempts,"nextAttemptAt","publishedAt","createdAt","retentionObservedAt")
    SELECT gen_random_uuid(),'OTP_INITIAL',gen_random_uuid(),'DELIVER',0,c.now-interval '180 days',CASE WHEN n<=40000 THEN 'PUBLISHED' ELSE 'CANCELLED' END,
      CASE WHEN n<=40000 THEN 1 ELSE 0 END,c.now-interval '180 days',CASE WHEN n<=40000 THEN c.now-interval '179 days' ELSE NULL END,
      c.now-interval '180 days',CASE WHEN n<=90000 THEN c.now-interval '31 days' ELSE NULL END
    FROM generate_series(1,100000) n CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
  // 10000 uncertain receipts and 10000 live jobs retain their notifications.
  // The live reports also create 10000 real derived intents through triggers.
  // Remaining 30000 old orphans may be removed, 10000 observed now must wait.
  await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","expiresAt")
    SELECT gen_random_uuid(),p."jobId"::text,'OTP',date_trunc('day',c.now),p."jobId",$1,'UNCERTAIN',c.now-interval '2 minutes',c.now-interval '1 minute',c.now+interval '30 days'
    FROM (SELECT "jobId" FROM "JobPublicationIntent" WHERE state='CANCELLED' AND "retentionObservedAt" IS NOT NULL ORDER BY id LIMIT 10000) p CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`,h);
  await db.$executeRawUnsafe(`INSERT INTO "AdaptiveInterview" (id,"displayName","tokenHash",state,"expiresAt","createdAt","updatedAt")
    SELECT p."jobId",'Synthetic bulk',replace(p."jobId"::text,'-','')||replace(p."jobId"::text,'-',''),'{}'::jsonb,c.now+interval '1 day',c.now,c.now
    FROM (SELECT p."jobId" FROM "JobPublicationIntent" p WHERE p.state='CANCELLED' AND p."retentionObservedAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=p."jobId"::text) ORDER BY p.id LIMIT 10000) p CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
  await db.$executeRawUnsafe(`INSERT INTO "AdaptiveReportJob" (id,"interviewId",status,"emailStatus","createdAt","updatedAt") SELECT id,id,'PENDING','NOT_REQUESTED',clock_timestamp(),clock_timestamp() FROM "AdaptiveInterview"`);
  await db.$executeRawUnsafe(`INSERT INTO "MaintenanceRun" (id,task,"attemptToken",state,"startedAt","finishedAt","stopCode")
    SELECT gen_random_uuid(),'cleanup',gen_random_uuid(),CASE WHEN n<=12000 THEN 'COMPLETED' ELSE 'RUNNING' END,c.now-interval '180 days',CASE WHEN n<=12000 THEN c.now-interval '100 days' ELSE NULL END,'IDLE'
    FROM generate_series(1,13000) n CROSS JOIN (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) c`);
  await db.$executeRawUnsafe(`ANALYZE "JobPublicationIntent"`);await db.$executeRawUnsafe(`ANALYZE "MaintenanceRun"`);
  const beforeSizes=await sizes();
  const [explain]=await db.$queryRawUnsafe<any[]>(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM "JobPublicationIntent" WHERE state='CANCELLED' AND attempts=0 AND "publishedAt" IS NULL AND "leaseUntil" IS NULL AND "attemptToken" IS NULL AND "retentionObservedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 days' ORDER BY "retentionObservedAt",id LIMIT 100`);
  assert.match(JSON.stringify(explain),/JobPublicationIntent_retention_due_idx/);
  const transactionMs:number[]=[],originalTransaction=MaintenanceControl.prototype.transaction;
  t.mock.method(MaintenanceControl.prototype,"transaction",async function(this:MaintenanceControl,...args:any[]){const at=performance.now();try{return await originalTransaction.apply(this,args as any)}finally{transactionMs.push(performance.now()-at)}});
  const times:number[]=[],started=performance.now();let deleted=0,compacted=0,observed=0,lag=0;
  for(let n=0;n<12;n++){const r=await retention(db,{batchSize:100,maxBatches:100,maxRows:10000,budgetMs:30000,sqlTimeoutMs:4000});assert.notEqual(r.stop,"FAILED");
    times.push(r.elapsedMs);deleted+=r.technicalRetention?.deletedIntents??0;compacted+=r.technicalRetention?.compactedRuns??0;observed+=r.technicalRetention?.observedIntents??0;lag=Math.max(lag,r.technicalRetention?.oldestEligibleLagSeconds??0);if(deleted===30000&&compacted===12000&&observed===10000)break;}
  assert.equal(deleted,30000);assert.equal(compacted,12000);assert.equal(observed,10000);assert.equal(await count("MaintenanceReplayReceipt"),12000);assert.equal(await count("EmailBudgetReservation"),10000);assert.equal(await count("JobPublicationIntent"),80000);
  const afterSizes=await sizes();assert.ok(afterSizes.logicalRunBytes+afterSizes.logicalReceiptBytes<beforeSizes.logicalRunBytes);
  const sorted=transactionMs.sort((a,b)=>a-b),transactions={count:sorted.length,maxMs:Math.round(sorted.at(-1)??0),p95Ms:Math.round(sorted[Math.floor(sorted.length*0.95)]??0)};
  const metrics={initialIntents:110000,initialRuns:13000,deleted,compacted,observed,retainedIntents:80000,permanentReplayReceipts:12000,preservedUncertainReceipts:10000,lagSeconds:lag,invocationMs:times,totalWallMs:Math.round(performance.now()-started),transactions,beforeSizes,afterSizes,indexPlan:explain};
  await writeFile(resolve("output/maintenance-step4c-20261031/volume-results.json"),JSON.stringify(metrics,null,2));console.log("4C six-month volume",JSON.stringify({...metrics,indexPlan:undefined}));
});
