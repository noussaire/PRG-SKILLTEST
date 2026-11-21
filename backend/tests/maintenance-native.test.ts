import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient, Prisma } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { runMaintenance } from "../src/services/maintenance.service.js";
import { MaintenanceControl } from "../src/services/maintenance-control.js";
import { JobPublications } from "../src/services/job-publication.service.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned temporary PostgreSQL required",timeout:60000};
let db:PrismaClient,other:PrismaClient,entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
const h="b".repeat(64),past=()=>new Date(Date.now()-86400000),future=()=>new Date(Date.now()+86400000);
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:"maintenance-synthetic-pepper-0123456789abcdef",DOTENV_CONFIG_PATH:resolve("output/maintenance-step4a-20261031/nonexistent.env")});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
});
beforeEach(async t=>{
  if(options.skip)return;
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async()=>{throw Error("ALL_PROVIDER_NETWORK_FORBIDDEN")});
  Object.assign(process.env,{GROQ_API_KEY:"synthetic",BREVO_API_KEY:"synthetic",BREVO_SENDER_EMAIL:"sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300"});
  await db.$executeRawUnsafe(`TRUNCATE "JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{await db?.$disconnect();await other?.$disconnect()});
async function initial(){const r=await entry({fullName:"Synthetic maintenance",email:randomUUID()+"@example.test",language:"fr",emailReport:false});
  assert.equal(r.status,409);return db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:r.body.challengeId as string}});}
async function otp(kind:"initial"|"retake"){
  if(kind==="initial")return {table:"ParticipantEmailDeliveryJob",job:await initial()};
  const {OtpDeliveryQueue}=await import("../src/services/otp-delivery.service.js");
  const i=await db.adaptiveInterview.create({data:{displayName:"Synthetic",email:randomUUID()+"@example.test",tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:{},expiresAt:future()}});
  await new OtpDeliveryQueue(db).enqueue({interviewId:i.id,lastTestStartedAt:i.lastTestStartedAt,codeHash:h,payload:{recipient:i.email!,recipientName:"Synthetic",subject:"OTP",htmlContent:"<p>123456</p>"}});
  return {table:"OtpDeliveryJob",job:await db.otpDeliveryJob.findFirstOrThrow({where:{interviewId:i.id}})};
}
async function receipt(id:string,status:string,active=false,purpose="OTP"){
  await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","leaseUntil","attemptToken","expiresAt")
    VALUES ($1::uuid,$2,$3,date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC'),$2::uuid,$4,$5,(clock_timestamp() AT TIME ZONE 'UTC')-interval '2 minutes',
    (clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute',$6,$7::uuid,$8)`,randomUUID(),id,purpose,h,status,active?future():null,active?randomUUID():null,future());
}
async function row(table:string,id:string){return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}" WHERE id=$1::uuid`,id))[0]}
async function report(language:"fr"|"ar"="fr",ready=true){
  let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
  const i=await db.adaptiveInterview.create({data:{displayName:"Synthetic report",email:randomUUID()+"@example.test",reportEmailRequested:true,
    tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:state as unknown as Prisma.InputJsonValue,expiresAt:future()}});
  const job=await db.adaptiveReportJob.create({data:{interviewId:i.id,status:ready?"COMPLETE":"PENDING",summary:ready?JSON.stringify({fr:"Synthèse synthétique.",ar:"خلاصة تجريبية."}):null,emailStatus:"PENDING"}});
  return {i,job};
}
async function nonces(n:number){await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") SELECT gen_random_uuid(),(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' FROM generate_series(1,$1::int)`,n)}
// SQL-managed tables are intentionally used without regenerating the existing
// local Prisma client (same convention as the prior native suites).
async function nonceCount(){return (await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "ProxyRequestNonce"`))[0].n as number}
async function insertNonce(nonce:string,expiresAt:Date){await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") VALUES ($1::uuid,$2)`,nonce,expiresAt);return {nonce,expiresAt}}
async function findNonce(id:string){return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "ProxyRequestNonce" WHERE nonce=$1::uuid`,id))[0]}
async function intentRows(){return db.$queryRawUnsafe<any[]>(`SELECT * FROM "JobPublicationIntent" ORDER BY id`)}
async function firstIntent(){const rows=await intentRows();assert.ok(rows[0]);return rows[0]}
async function intentCount(state:string|null=null,jobId:string|null=null){return (await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "JobPublicationIntent" WHERE ($1::text IS NULL OR state=$1) AND ($2::uuid IS NULL OR "jobId"=$2::uuid)`,state,jobId))[0].n as number}
async function setIntent(state:string,lease:Date,jobId:string){return db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET state=$1,"leaseUntil"=$2,"attemptToken"=$3::uuid WHERE "jobId"=$4::uuid`,state,lease,randomUUID(),jobId)}

test("Maintenance rejects invalid bounds and duplicate stages before accessing PostgreSQL",options,async()=>{
  for(const input of [{batchSize:0},{maxBatches:101},{maxRows:0},{budgetMs:0},{sqlTimeoutMs:4001},{stages:["nonces","nonces"]},{publisher:"forbidden"}])
    await assert.rejects(runMaintenance({} as PrismaClient,input as any));
});
test("Empty maintenance returns structured idle data without personal identifiers",options,async()=>{
  const r=await runMaintenance(db);assert.equal(r.stop,"IDLE");assert.equal(r.rows,0);assert.equal(r.batches,11);assert.equal(r.oldestUnpublishedDueLagSeconds,0);
  assert.deepEqual(Object.keys(r).sort(),["stop","batches","rows","elapsedMs","stage","changed","oldestUnpublishedDueLagSeconds"].sort());
});
test("Nonce batches stop at maxBatches and resume from remaining PostgreSQL rows",options,async()=>{
  await nonces(11);const a=await runMaintenance(db,{stages:["nonces"],batchSize:3,maxBatches:2});assert.equal(a.rows,6);assert.equal(a.stop,"MAX_BATCHES");
  assert.equal(await nonceCount(),5);assert.equal((await runMaintenance(other,{stages:["nonces"],batchSize:3})).rows,5);
});
test("Global direct-row ceiling is enforced even across multiple batches",options,async()=>{
  await nonces(10);const r=await runMaintenance(db,{stages:["nonces"],batchSize:3,maxRows:4});assert.equal(r.rows,4);assert.equal(r.stop,"ROW_LIMIT");assert.equal(await nonceCount(),6);
});
test("Future nonces and active quota windows survive maintenance",options,async()=>{
  const nonce=await insertNonce(randomUUID(),future());
  await db.$executeRawUnsafe(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count) VALUES ('IDENTITY',$1,'OTP_FAILURE',clock_timestamp(),$2,15)`,h,future());
  await runMaintenance(db,{stages:["retention","nonces"]});assert.ok(await findNonce(nonce.nonce));assert.equal(await db.emailAbuseCounter.count(),1);
});
for(const kind of ["initial","retake"] as const){
  test(`${kind} UNCERTAIN reconciliation preserves receipt and blocks every automatic resend`,options,async()=>{
    const f=await otp(kind);await receipt(f.job.id,"UNCERTAIN");await db.$executeRawUnsafe(`UPDATE "${f.table}" SET status='UNCERTAIN',"attemptToken"=$2::uuid,"leaseUntil"=$3 WHERE id=$1::uuid`,f.job.id,randomUUID(),past());
    const saved=await db.emailBudgetReservation.findFirstOrThrow();const r=await runMaintenance(db,{stages:[kind==="initial"?"otpInitial":"otpRetake","missingIntents"]});assert.equal(r.rows,1);
    const j=await row(f.table,f.job.id);assert.equal(j.status,"UNCERTAIN");assert.equal(j.nextAttemptAt,null);assert.ok(j.encryptedPayload);
    assert.deepEqual(await db.emailBudgetReservation.findFirstOrThrow(),saved);assert.equal(await intentCount("PENDING"),0);
  });
  test(`${kind} expired OTP loses ciphertext without deleting uncertain evidence`,options,async()=>{
    const f=await otp(kind);await receipt(f.job.id,"UNCERTAIN");await db.$executeRawUnsafe(`UPDATE "${f.table}" SET "expiresAt"=$2 WHERE id=$1::uuid`,f.job.id,past());
    await runMaintenance(db,{stages:[kind==="initial"?"otpInitial":"otpRetake"]});const j=await row(f.table,f.job.id);
    assert.equal(j.status,"UNCERTAIN");assert.equal(j.encryptedPayload,null);assert.equal(j.nextAttemptAt,null);assert.equal(await db.emailBudgetReservation.count(),1);
  });
}
test("Accepted OTP receipt recovers a crashed job without calling the provider",options,async()=>{
  const j=await initial();await receipt(j.id,"ACCEPTED");await db.participantEmailDeliveryJob.update({where:{id:j.id},data:{status:"UNCERTAIN",leaseUntil:past(),attemptToken:randomUUID()}});
  await runMaintenance(db,{stages:["otpInitial"]});const after=await row("ParticipantEmailDeliveryJob",j.id);assert.equal(after.status,"ACCEPTED");assert.equal(after.encryptedPayload,null);assert.equal(await db.emailBudgetReservation.count(),1);
});
for(const lease of ["job","reservation","publication"] as const)test(`Active ${lease} lease survives reconciliation and retention`,options,async()=>{
  const j=await initial();
  if(lease==="reservation")await receipt(j.id,"UNCERTAIN",true);
  if(lease==="publication")await setIntent("PUBLISHING",future(),j.id);
  // Expiry without touching the job avoids invoking its trigger while establishing an active publisher.
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "expiresAt"=$2,"leaseUntil"=$3,"attemptToken"=$4::uuid WHERE id=$1::uuid`,j.id,past(),lease==="job"?future():null,lease==="job"?randomUUID():null);
  if(lease==="publication")await setIntent("PUBLISHING",future(),j.id);
  const saved=await row("ParticipantEmailDeliveryJob",j.id),intents=await intentRows();
  await runMaintenance(db,{stages:["otpInitial","retention","staleIntents"]});assert.deepEqual(await row("ParticipantEmailDeliveryJob",j.id),saved);
  if(lease==="publication")assert.deepEqual(await intentRows(),intents);
});
test("Expired interrupted summary becomes unavailable while its report metadata survives",options,async()=>{
  const f=await report("fr",false);await db.adaptiveInterview.update({where:{id:f.i.id},data:{expiresAt:past()}});
  await db.adaptiveReportJob.update({where:{id:f.job.id},data:{status:"PROCESSING",leaseUntil:past()}});
  const r=await runMaintenance(db,{stages:["reportSummary","reportEmail"]});assert.equal(r.stop,"IDLE");const j=await db.adaptiveReportJob.findUniqueOrThrow({where:{id:f.job.id}});
  assert.equal(j.status,"UNAVAILABLE");assert.equal(j.emailStatus,"FAILED");assert.equal(await db.adaptiveInterview.count(),1);
});
test("Interrupted report beyond its provider window becomes UNKNOWN, never a new send",options,async()=>{
  const f=await report();await receipt(f.job.id,"UNCERTAIN",false,"REPORT");const saved=await db.emailBudgetReservation.findFirstOrThrow();
  await db.adaptiveReportJob.update({where:{id:f.job.id},data:{emailStatus:"PROCESSING",emailLeaseUntil:past(),emailAttemptWindowAt:past()}});
  await runMaintenance(db,{stages:["reportEmail","missingIntents","rearm"]});assert.equal((await row("AdaptiveReportJob",f.job.id)).emailStatus,"UNKNOWN");
  assert.deepEqual(await db.emailBudgetReservation.findFirstOrThrow(),saved);assert.equal(await intentCount("PENDING",f.job.id),0);
});
test("Accepted report receipt repairs UNKNOWN status without rendering or reserving again",options,async()=>{
  const f=await report();await receipt(f.job.id,"ACCEPTED",false,"REPORT");await db.adaptiveReportJob.update({where:{id:f.job.id},data:{emailStatus:"UNKNOWN"}});await runMaintenance(db,{stages:["reportEmail"]});
  assert.equal((await row("AdaptiveReportJob",f.job.id)).emailStatus,"SENT");assert.equal(await db.emailBudgetReservation.count(),1);
});
test("Active summary and PDF leases survive report maintenance",options,async()=>{
  const f=await report();await db.adaptiveInterview.update({where:{id:f.i.id},data:{expiresAt:past()}});
  await db.adaptiveReportJob.update({where:{id:f.job.id},data:{emailStatus:"PROCESSING",emailLeaseUntil:future()}});
  const saved=await row("AdaptiveReportJob",f.job.id);assert.equal((await runMaintenance(db,{stages:["reportEmail","reportSummary"]})).rows,0);assert.deepEqual(await row("AdaptiveReportJob",f.job.id),saved);
});
for(const language of ["fr","ar"] as const)test(`${language} interrupted real PDF remains resumable after maintenance and sends only on explicit processing`,options,async t=>{
  const f=await report(language),{reportPdfRenderer}=await import("../src/services/report-pdf.service.js"),{processJob}=await import("../src/services/job-processing.service.js");
  const {chromium}=await import("playwright");const launch=chromium.launch.bind(chromium);let closed=false,calls=0;
  const mock=t.mock.method(chromium,"launch",async(...args:Parameters<typeof launch>)=>{const b=await launch(...args),newPage=b.newPage.bind(b),close=b.close.bind(b);
    b.close=async(...a)=>{await close(...a);closed=!b.isConnected()};b.newPage=async(...a)=>{const p=await newPage(...a);p.pdf=async()=>{throw Error("SIMULATED_INTERRUPTION")};return p};return b});
  await processJob({kind:"REPORT",jobId:f.job.id,phase:"EMAIL"});mock.mock.restore();assert.equal(closed,true);assert.equal(await db.emailBudgetReservation.count(),0);
  const before=await row("AdaptiveReportJob",f.job.id);await runMaintenance(db,{stages:["reportEmail","missingIntents"]});assert.deepEqual(await row("AdaptiveReportJob",f.job.id),before);
  await db.adaptiveReportJob.update({where:{id:f.job.id},data:{emailNextAttemptAt:past()}});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{assert.equal(String(input),"https://api.brevo.com/v3/smtp/email");const message=JSON.parse(String(init?.body));
    assert.equal(Buffer.from(message.attachment[0].content,"base64").subarray(0,5).toString(),"%PDF-");assert.match(message.htmlContent,new RegExp(`lang="${language}"`));calls++;return Response.json({messageId:"synthetic"},{status:201})});
  await processJob({kind:"REPORT",jobId:f.job.id,phase:"EMAIL"});await processJob({kind:"REPORT",jobId:f.job.id,phase:"EMAIL"});assert.equal(calls,1);assert.equal(await db.emailBudgetReservation.count(),1);assert.ok(reportPdfRenderer);
});
test("Completed interview missing its report is repaired with job and intent atomically",options,async()=>{
  const f=await report("fr",false);await db.adaptiveReportJob.delete({where:{id:f.job.id}});
  const r=await runMaintenance(db,{stages:["missingReports"]});assert.equal(r.changed.missingReports,1);assert.equal(await db.adaptiveReportJob.count(),1);assert.equal(await intentCount("PENDING"),1);
});
test("Committed OTP with missing publication intent is repaired without publication",options,async()=>{
  const j=await initial();await db.$executeRawUnsafe(`DELETE FROM "JobPublicationIntent"`);const r=await runMaintenance(db,{stages:["missingIntents"]});assert.equal(r.rows,1);
  assert.equal((await firstIntent()).jobId,j.id);assert.equal(await db.emailBudgetReservation.count(),0);
});
test("Expired publisher lease remains recoverable with same UUID by an explicit simulated publisher",options,async()=>{
  await initial();const p=await firstIntent();await setIntent("PUBLISHING",past(),p.jobId);
  await runMaintenance(db,{stages:["missingIntents","staleIntents"]});assert.equal((await firstIntent()).state,"PUBLISHING");
  const sent:string[]=[];await new JobPublications(db).publishBatch({publish:async n=>{sent.push(n.notificationId)}});assert.deepEqual(sent,[p.id]);assert.equal(await db.emailBudgetReservation.count(),0);
});
test("Lost confirmed notification rearms once without changing job UUID or OTP expiry",options,async()=>{
  const j=await initial();await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET state='PUBLISHED',"publishedAt"=$1`,past());
  const r=await runMaintenance(db,{stages:["rearm"]});assert.equal(r.rows,1);assert.equal((await row("ParticipantEmailDeliveryJob",j.id)).expiresAt.getTime(),j.expiresAt.getTime());
  assert.equal(await intentCount(),2);assert.equal(await db.emailBudgetReservation.count(),0);
});
test("Concurrent maintenance clients claim disjoint nonce batches without double deletion",options,async()=>{
  await nonces(20);const pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  const results=await Promise.all([runMaintenance(db,{stages:["nonces"],batchSize:3}),runMaintenance(other,{stages:["nonces"],batchSize:3})]);
  assert.equal(results.reduce((a,r)=>a+r.rows,0),20);assert.equal(await nonceCount(),0);console.log("4A maintenance concurrency",JSON.stringify({pids:pids.map(r=>r[0].pid),rows:20}));
});
test("Job creation concurrent with maintenance preserves current challenge and atomic intent",options,async()=>{
  const [j,r]=await Promise.all([initial(),runMaintenance(other,{batchSize:1,maxBatches:22})]);assert.notEqual(r.stop,"FAILED");assert.ok((await row("ParticipantEmailDeliveryJob",j.id)).encryptedPayload);
  assert.equal(await intentCount("PENDING",j.id),1);assert.equal(await db.emailBudgetReservation.count(),0);
});
test("Already aborted maintenance performs no query or mutation",options,async()=>{
  const c=new AbortController();c.abort();const r=await runMaintenance({} as PrismaClient,{signal:c.signal});assert.equal(r.stop,"ABORTED");assert.equal(r.batches,0);
});
test("Cancellation inside a native transaction rolls back the preceding mutation",options,async()=>{
  const c=new AbortController(),control=new MaintenanceControl(1000,500,c.signal),id=randomUUID();
  await assert.rejects(control.transaction(db,async tx=>{await tx.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") VALUES ($1::uuid,$2)`,id,past());c.abort();await tx.$queryRawUnsafe("SELECT pg_sleep(0.02)::text")}),/ABORTED/);
  assert.equal(await nonceCount(),0);
});
test("SQL timeout bounds a blocked budget lock and subsequent invocation resumes",options,async()=>{
  await initial();await db.emailProviderState.upsert({where:{provider:"BREVO"},create:{provider:"BREVO"},update:{}});let open!:()=>void,ready!:()=>void;const hold=new Promise<void>(r=>open=r),entered=new Promise<void>(r=>ready=r);
  const locker=other.$transaction(async tx=>{await tx.$queryRawUnsafe(`SELECT provider FROM "EmailProviderState" WHERE provider='BREVO' FOR UPDATE`);ready();await hold},{timeout:5000});
  let r;try{await entered;r=await runMaintenance(db,{stages:["otpInitial"],sqlTimeoutMs:30,budgetMs:1000});assert.equal(r.stop,"FAILED");assert.equal(r.rows,0);assert.ok(r.elapsedMs<1500)}finally{open();await locker}
  assert.equal((await runMaintenance(db,{stages:["otpInitial"]})).stop,"IDLE");
});
test("Short global deadline cannot leave work detached or spend an unbounded SQL wait",options,async()=>{
  const c=new MaintenanceControl(80,4000);const started=performance.now();await assert.rejects(c.transaction(db,tx=>tx.$queryRawUnsafe("SELECT pg_sleep(1)::text")));assert.ok(performance.now()-started<1000);
  assert.equal((await db.$queryRawUnsafe<any[]>("SELECT 1 AS ok"))[0].ok,1);
});
test("Completed batches survive cancellation and the next invocation resumes remaining work",options,async()=>{
  await nonces(5);const first=await runMaintenance(db,{stages:["nonces"],batchSize:2,maxBatches:1});assert.equal(first.rows,2);
  const c=new AbortController();c.abort();assert.equal((await runMaintenance(db,{signal:c.signal})).stop,"ABORTED");
  assert.equal((await runMaintenance(db,{stages:["nonces"]})).rows,3);
});
test("Scheduled sessions open and close in bounded batches while drafts, future sessions and admin sessions survive",options,async()=>{
  const user=await db.user.create({data:{email:randomUUID()+"@example.test",role:"ADMIN"}}),assessment=await db.assessment.create({data:{title:"Synthetic",slug:randomUUID()}});
  const admin=await db.adminSession.create({data:{userId:user.id,tokenHash:h,expiresAt:future()}});
  for(const data of [{status:"SCHEDULED",opensAt:past(),closesAt:future()},{status:"OPEN",closesAt:past()},{status:"SCHEDULED",opensAt:past(),closesAt:past()},
    {status:"DRAFT",opensAt:past(),closesAt:past()},{status:"SCHEDULED",opensAt:future()}])await db.assessmentSession.create({data:{...data,assessmentId:assessment.id,createdById:user.id,label:"Synthetic",codeHash:randomUUID().replaceAll("-","").padEnd(64,"0")} as any});
  const r=await runMaintenance(db,{stages:["sessions"],batchSize:1});assert.equal(r.rows,3);assert.equal(await db.assessmentSession.count({where:{status:"CLOSED"}}),2);
  assert.equal(await db.assessmentSession.count({where:{status:"OPEN"}}),1);assert.deepEqual(await db.adminSession.findUniqueOrThrow({where:{id:admin.id}}),admin);
});
test("Lag measurement reports technical seconds without exposing job or recipient identifiers",options,async()=>{
  const j=await initial();await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=$1`,past());const r=await runMaintenance(db,{stages:["nonces"]});assert.ok(r.oldestUnpublishedDueLagSeconds!>=86390);
  const text=JSON.stringify(r);assert.ok(!text.includes(j.id));assert.ok(!text.includes("example.test"));assert.ok(!text.includes("encryptedPayload"));
});

for(const boundary of ["in-transaction","after-commit"] as const)test(`Owned maintenance process killed ${boundary} rolls back or preserves its batch and resumes`,options,async()=>{
  await nonces(1);
  let unlock!:()=>void,locked!:()=>void;
  const hold=new Promise<void>(r=>unlock=r),readyLock=new Promise<void>(r=>locked=r);
  const blocker=boundary==="in-transaction"?other.$transaction(async tx=>{await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(44100401::bigint)::text");locked();await hold},{timeout:15000}):Promise.resolve();
  if(boundary==="in-transaction")await readyLock;
  const child=spawn(process.execPath,["--loader",pathToFileURL(resolve("output/lot3-rollback-6f44523a33/test-loader.mjs")).href,resolve("backend/tests/helpers/maintenance-crash.ts"),boundary],{
    windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:"test",LOT4_NATIVE_CONTEXT:process.env.LOT4_NATIVE_CONTEXT,
      DOTENV_CONFIG_PATH:resolve("output/maintenance-step4a-20261031/nonexistent.env"),MAINTENANCE_CRASH_BOUNDARY:boundary},stdio:["ignore","pipe","pipe","ipc"]});
  const exited=once(child,"exit");let logs="";child.stderr!.on("data",v=>logs+=v);const ready=new Promise<void>(r=>child.on("message",m=>{if((m as any).boundary===boundary)r()}));let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([ready,exited.then(()=>{throw Error(logs)}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Crash fixture timeout: "+logs)),10000)})]);child.kill();await exited;}
  finally{if(timer)clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill();await exited}if(boundary==="in-transaction")unlock();await blocker}
  assert.equal(await nonceCount(),boundary==="in-transaction"?1:0);
  assert.equal((await runMaintenance(db,{stages:["nonces"]})).rows,boundary==="in-transaction"?1:0);
  console.log("4A killed maintenance",JSON.stringify({boundary,childPid:child.pid}));
});
