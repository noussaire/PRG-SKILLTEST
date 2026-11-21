import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type { PrismaClient, Prisma } from "@prisma/client";
import { chromium } from "playwright";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { LocalNotifications } from "./helpers/local-notification-simulator.js";
import { JobPublications } from "../src/services/job-publication.service.js";
import { EmailBudget } from "../src/services/email-budget.service.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:120000};
const pepper="job-failure-synthetic-pepper-0123456789abcdef";
let db:PrismaClient,other:PrismaClient;
let entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let processJob:typeof import("../src/services/job-processing.service.js").processJob;
let renderer:typeof import("../src/services/report-pdf.service.js").reportPdfRenderer;
let calls:any[],accepted:Set<string>,mode:"accept"|"lost"|"rate"|"quota";
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:"output/job-failures-step3c-20261031/nonexistent-synthetic.env"});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  ({processJob}=await import("../src/services/job-processing.service.js"));({reportPdfRenderer:renderer}=await import("../src/services/report-pdf.service.js"));
});
beforeEach(async t=>{
  if(options.skip)return;calls=[];accepted=new Set();mode="accept";
  Object.assign(process.env,{GROQ_API_KEY:"synthetic-no-network",BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300",OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"1000",OTP_GLOBAL_DAILY_SENDS:"1000",
    OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    if(String(input)==="https://api.groq.com/openai/v1/chat/completions")return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({fr:"Synthèse de test.",ar:"خلاصة تجريبية."})}}]});
    assert.equal(String(input),"https://api.brevo.com/v3/smtp/email","External network forbidden");
    const body=JSON.parse(String(init?.body));assert.match(body.to[0].email,/@example\.test$/);calls.push(body);
    if(mode==="rate")return new Response(null,{status:429,headers:{"Retry-After":"60"}});
    if(mode==="quota")return Response.json({code:"not_enough_credits"},{status:402});
    accepted.add(body.headers.IdempotencyKey);
    if(mode==="lost")throw Error("SIMULATED_ACCEPTANCE_RESPONSE_LOST");
    return Response.json({messageId:"synthetic"},{status:201});
  });
  await db.$executeRawUnsafe(`TRUNCATE "JobPublicationIntent","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{await db?.$disconnect();await other?.$disconnect();});

async function initial(){const p={fullName:"Synthetic failure test",email:randomUUID()+"@example.test",language:"fr" as const,emailReport:false};
  const r=await entry(p);assert.equal(r.status,409);const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:r.body.challengeId as string}});
  return {p,job,request:{kind:"OTP_INITIAL",jobId:job.id,phase:"DELIVER"}};}
async function report(language:"fr"|"ar"="fr"){
  let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
  const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic report",email:randomUUID()+"@example.test",reportEmailRequested:true,
    tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
  const job=await db.adaptiveReportJob.create({data:{interviewId:row.id,status:"COMPLETE",summary:JSON.stringify({fr:"Synthèse de test.",ar:"خلاصة تجريبية."}),emailStatus:"PENDING"}});
  return {row,job,request:{kind:"REPORT",jobId:job.id,phase:"EMAIL"}};
}
async function due(){await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);}
async function expireLeases(jobId:string){await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid AND status='UNCERTAIN' AND "attemptToken" IS NOT NULL`,jobId);
  await db.$executeRawUnsafe(`UPDATE "EmailBudgetReservation" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE "logicalKey"=$1 AND status='UNCERTAIN'`,jobId);}
function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {wait,open};}

test("Deletion after OTP claim but before budget reservation prevents any provider contact",options,async t=>{
  const f=await initial(),original=EmailBudget.prototype.claim;
  t.mock.method(EmailBudget.prototype,"claim",async function(this:EmailBudget,...args:Parameters<EmailBudget["claim"]>){
    await other.emailOtpChallenge.delete({where:{id:f.job.challengeId}});return original.apply(this,args);
  });
  await processJob(f.request);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Deletion after report PDF preparation but before budget reservation prevents provider contact",options,async t=>{
  const f=await report(),original=EmailBudget.prototype.claim;t.mock.method(renderer,"render",async()=>Buffer.from("%PDF-1.7\nSynthetic"));
  t.mock.method(EmailBudget.prototype,"claim",async function(this:EmailBudget,...args:Parameters<EmailBudget["claim"]>){
    await other.adaptiveInterview.delete({where:{id:f.row.id}});return original.apply(this,args);
  });
  await processJob(f.request);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("An obsolete OTP attempt token cannot reserve or send after it was superseded",options,async t=>{
  const f=await initial(),original=EmailBudget.prototype.claim;
  t.mock.method(EmailBudget.prototype,"claim",async function(this:EmailBudget,...args:Parameters<EmailBudget["claim"]>){
    await other.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "attemptToken"=$2::uuid WHERE id=$1::uuid`,f.job.id,randomUUID());return original.apply(this,args);
  });
  await processJob(f.request);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Expired OTP at budget boundary cannot spend a unit or send",options,async t=>{
  const f=await initial(),original=EmailBudget.prototype.claim;
  t.mock.method(EmailBudget.prototype,"claim",async function(this:EmailBudget,...args:Parameters<EmailBudget["claim"]>){
    await other.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,f.job.challengeId);return original.apply(this,args);
  });
  await processJob(f.request);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Simulator distinguishes publication, receipt, job completion, simulated acceptance and lost acknowledgement",options,async()=>{
  const f=await initial(),sim=new LocalNotifications();sim.copies=5;sim.delay=2000;
  await new JobPublications(db).publishBatch(sim);assert.equal(sim.published.length,1);assert.equal(sim.received.length,0);assert.equal(calls.length,0);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}})).status,"PENDING");
  await sim.drain(processJob,3);assert.equal(sim.received.length,0);sim.advance(2000);await sim.drain(processJob,3,true);
  assert.equal(sim.received.length,5);assert.equal(sim.acknowledged.length,0);assert.equal(calls.length,1);assert.equal(accepted.size,1);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}})).status,"ACCEPTED");
  sim.advance(1000);await sim.drain(processJob,4);assert.equal(sim.received.length,10);assert.equal(sim.acknowledged.length,5);assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Lost delivery and reversed order recover without selecting another job or double sending",options,async()=>{
  const a=await initial(),b=await initial(),sim=new LocalNotifications();await new JobPublications(db).publishBatch(sim);
  sim.reverse();sim.loseNextDelivery();await sim.drain(processJob,2);assert.equal(calls.length,1);sim.advance(1000);await sim.drain(processJob,2);
  assert.equal(sim.lostDeliveries,1);assert.equal(accepted.size,2);assert.deepEqual(new Set(calls.map(c=>c.headers.IdempotencyKey)),new Set([a.job.id,b.job.id]));
});

test("Publication response loss with no transport deduplication still sends an OTP once",options,async()=>{
  await initial();const sim=new LocalNotifications();sim.mode="accept-response-lost";await new JobPublications(db).publishBatch(sim);await due();sim.mode="accept";await new JobPublications(other).publishBatch(sim);
  assert.equal(sim.published.length,2);assert.equal(sim.published[0].notificationId,sim.published[1].notificationId);
  await sim.drain(processJob,2);assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("UNCERTAIN OTP remains blocked despite many delayed and repeated notifications",options,async()=>{
  const f=await initial(),sim=new LocalNotifications();sim.copies=20;await new JobPublications(db).publishBatch(sim);mode="lost";await sim.drain(processJob,4,true);
  const before=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}});assert.equal(before.status,"UNCERTAIN");assert.ok(before.encryptedPayload);
  mode="accept";sim.advance(300000);await sim.drain(processJob,8);await new JobPublications(db).reconcile();
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '121 seconds' WHERE state='PUBLISHED'`);
  assert.equal((await new JobPublications(db).reconcile()).rearmed,0);
  assert.equal(calls.length,1);assert.equal(accepted.size,1);assert.equal(await db.emailBudgetReservation.count(),1);
  assert.deepEqual(await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}}),before);
});

for(const boundary of ["after-job-claim","after-budget-reserved","after-provider-accepted","after-budget-accepted","after-job-accepted"] as const)
test(`Actual owned Node process termination at ${boundary} preserves PostgreSQL recovery semantics`,options,async()=>{
  const f=await initial(),events:any[]=[];
  const child=spawn(process.execPath,["--loader",pathToFileURL(resolve("output/lot3-rollback-6f44523a33/test-loader.mjs")).href,resolve("output/job-failures-step3c-20261031/crash-worker.mjs"),"OTP_INITIAL",f.job.id,boundary],{
    cwd:resolve("."),windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:resolve("output/job-failures-step3c-20261031"),TMP:resolve("output/job-failures-step3c-20261031"),
      NODE_ENV:"test",LOT4_NATIVE_CONTEXT:process.env.LOT4_NATIVE_CONTEXT,JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:resolve("output/job-failures-step3c-20261031/nonexistent-synthetic.env"),
      BREVO_API_KEY:"synthetic-child-only",BREVO_SENDER_EMAIL:"sender@example.test",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300"},stdio:["ignore","pipe","pipe","ipc"]});
  let logs="";child.stdout?.on("data",v=>logs+=v);child.stderr?.on("data",v=>logs+=v);const exited=once(child,"exit");
  const ready=new Promise<void>(r=>child.on("message",event=>{events.push(event);if((event as any).boundary===boundary)r();}));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([ready,exited.then(()=>{throw Error("Child exited early: "+logs);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Child boundary timeout: "+logs)),15000);})]);
    child.kill();await exited;
  }finally{if(timer)clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}
  await expireLeases(f.job.id);await processJob(f.request);await processJob(f.request);
  const row=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}});
  const childAttempts=events.filter(e=>e.providerAttempt).length,childAccepted=events.filter(e=>e.providerAccepted).length;
  if(boundary==="after-job-claim"){assert.equal(calls.length,1);assert.equal(row.status,"ACCEPTED");}
  else if(boundary==="after-budget-reserved"||boundary==="after-provider-accepted"){assert.equal(calls.length,0);assert.equal(row.status,"UNCERTAIN");}
  else {assert.equal(calls.length,0);assert.equal(row.status,"ACCEPTED");}
  assert.equal(await db.emailBudgetReservation.count(),1);
  console.log("3C killed process",JSON.stringify({boundary,childPid:child.pid,childAttempts,childAccepted,parentAttempts:calls.length,jobStatus:row.status}));
});

for(const language of ["fr","ar"] as const)test(`Real ${language} PDF interruption closes Chromium and a retry sends once`,options,async t=>{
  const f=await report(language),launch=chromium.launch.bind(chromium);let closed=false;
  const mock=t.mock.method(chromium,"launch",async function(...args:Parameters<typeof launch>){
    const browser=await launch(...args),newPage=browser.newPage.bind(browser),close=browser.close.bind(browser);
    browser.close=async(...args)=>{await close(...args);closed=!browser.isConnected();};
    browser.newPage=async(...args)=>{const page=await newPage(...args);page.pdf=async()=>{throw Error("SIMULATED_PDF_INTERRUPTION");};return page;};return browser;
  });
  await processJob(f.request);mock.mock.restore();assert.equal(closed,true);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
  assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{id:f.job.id}})).emailStatus,"RETRY");
  await db.adaptiveReportJob.update({where:{id:f.job.id},data:{emailNextAttemptAt:new Date(Date.now()-1000)}});
  await processJob(f.request);await processJob(f.request);assert.equal(calls.length,1);assert.equal(accepted.size,1);assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{id:f.job.id}})).emailStatus,"SENT");
  assert.equal(Buffer.from(calls[0].attachment[0].content,"base64").subarray(0,5).toString(),"%PDF-");
});

test("429 and provider circuit block other jobs until persistent cooldown ends",options,async()=>{
  const a=await initial(),b=await initial();mode="rate";await processJob(a.request);assert.equal(calls.length,1);mode="accept";await processJob(b.request);assert.equal(calls.length,1);
  assert.equal(await db.emailBudgetReservation.count(),1);
  await db.$executeRawUnsafe(`UPDATE "EmailProviderState" SET "blockedUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE status='PENDING'`);
  await processJob(a.request);await processJob(b.request);assert.equal(calls.length,3);assert.equal(accepted.size,2);assert.equal(await db.emailBudgetReservation.count(),2);
});

test("Provider credit exhaustion persists a shared circuit without participant creation",options,async()=>{
  const a=await initial(),b=await initial();mode="quota";await processJob(a.request);mode="accept";await processJob(b.request);
  assert.equal(calls.length,1);assert.equal(accepted.size,0);assert.equal(await db.adaptiveInterview.count(),0);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("UTC day rollover keeps accepted and uncertain logical reservations without recharging them",options,async t=>{
  const actual=new Date(),end=new Date(Date.UTC(actual.getUTCFullYear(),actual.getUTCMonth(),actual.getUTCDate(),23,59,59));let now=end;
  t.mock.method(EmailBudget.prototype,"transactionNow",async()=>now);const budget=new EmailBudget(db);
  const input=()=>({key:randomUUID(),requestHash:"b".repeat(64),recipient:"synthetic@example.test",purpose:"REPORT" as const});
  const a=input(),b=input();const ca=await budget.claim(a);await budget.finish(ca,{accepted:true});const cb=await budget.claim(b);await budget.finish(cb,{uncertain:true});
  now=new Date(end.getTime()+2000);assert.equal((await new EmailBudget(other).claim(a)).duplicate,true);await assert.rejects(new EmailBudget(other).claim(b),/BREVO_ACCEPTANCE_UNKNOWN/);
  assert.equal(await db.emailBudgetReservation.count(),2);const units=await db.$queryRawUnsafe<any[]>(`SELECT sum(count)::int AS units FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS'`);assert.equal(units[0].units,2);
});

test("Expired budget lease and stale reservation token cannot overwrite the newer owner",options,async()=>{
  const input={key:randomUUID(),requestHash:"c".repeat(64),recipient:"synthetic@example.test",purpose:"REPORT" as const};const a=new EmailBudget(db),b=new EmailBudget(other);
  const first=await a.claim(input);await db.$executeRawUnsafe(`UPDATE "EmailBudgetReservation" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  const second=await b.claim(input);await assert.rejects(a.finish(first,{accepted:true}),/EMAIL_STALE_ATTEMPT/);await b.finish(second,{accepted:true});
  assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT sum(count)::int AS units FROM "EmailAbuseCounter" WHERE metric='EMAIL_UNITS'`))[0].units,1);
});

test("Reconciliation outage accumulates a measurable synthetic five-minute backlog then recovers in bounded batches",options,async()=>{
  for(let n=0;n<12;n++){const f=await initial();await db.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '5 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '5 minutes' WHERE id=$1::uuid`,f.job.challengeId);
    await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '5 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '5 minutes',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '5 minutes' WHERE id=$1::uuid`,f.job.id);}
  await db.$executeRawUnsafe(`DELETE FROM "JobPublicationIntent"`);
  await db.$executeRawUnsafe(`CREATE FUNCTION failed_catchup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated catchup outage'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER failed_catchup BEFORE INSERT ON "JobPublicationIntent" FOR EACH ROW EXECUTE FUNCTION failed_catchup()`);
  try{await assert.rejects(new JobPublications(db).reconcile(5));assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "JobPublicationIntent"`))[0].n,0);}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER failed_catchup ON "JobPublicationIntent"`);await db.$executeRawUnsafe(`DROP FUNCTION failed_catchup()`);}
  const lag=(await db.$queryRawUnsafe<any[]>(`SELECT extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-min("nextAttemptAt")))::float8 AS seconds FROM "ParticipantEmailDeliveryJob"`))[0].seconds;
  const started=performance.now();const service=new JobPublications(db),sim=new LocalNotifications();for(let n=0;n<3;n++){const r=await service.reconcile(5);assert.ok(r.intents<=5);}
  for(let n=0;n<3;n++)await service.publishBatch(sim,5);assert.equal(sim.published.length,12);await sim.drain(processJob,4);assert.equal(accepted.size,12);
  assert.ok(lag>=300);console.log("3C catchup backlog",JSON.stringify({jobs:12,syntheticLagSeconds:lag,recoveryWallMs:Math.round(performance.now()-started),simulatedAccepted:accepted.size}));
});

test("Large local run resumes bounded publication batches and drains 600 disordered notifications with eight workers",options,async()=>{
  const started=performance.now();for(let n=0;n<150;n++)await initial();const service=new JobPublications(db),sim=new LocalNotifications();sim.copies=4;
  const a=await service.publishBatch(sim,37);assert.equal(a.published,37);const remaining=(await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "JobPublicationIntent" WHERE state='PENDING'`))[0].n;assert.equal(remaining,113);
  while(sim.published.length<150){const r=await new JobPublications(other).publishBatch(sim,37);assert.ok(r.published<=37);assert.ok(r.published>0);}
  sim.reverse();await sim.drain(processJob,8);assert.equal(sim.received.length,600);assert.equal(calls.length,150);assert.equal(accepted.size,150);assert.equal(await db.emailBudgetReservation.count(),150);
  console.log("3C volume",JSON.stringify({jobs:150,notifications:600,workers:8,batchLimit:37,providerCalls:calls.length,reservations:150,wallMs:Math.round(performance.now()-started)}));
});

test("Confirmed notification lost before receipt is rearmed with a NEW notification UUID and same job",options,async()=>{
  const f=await initial(),sim=new LocalNotifications(),service=new JobPublications(db);await service.publishBatch(sim);sim.pending=[];
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '121 seconds' WHERE state='PUBLISHED'`);
  assert.equal((await service.reconcile() as any).rearmed,1);await service.publishBatch(sim);
  assert.equal(sim.published.length,2);assert.notEqual(sim.published[0].notificationId,sim.published[1].notificationId);assert.equal(sim.published[0].jobId,sim.published[1].jobId);
  await sim.drain(processJob,2);await sim.publish(sim.published[0]);await sim.drain(processJob,2);
  assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}})).status,"ACCEPTED");
});

test("Delayed notifications for expired, deleted, consumed and superseded OTPs never send",options,async()=>{
  const a=await initial(),b=await initial(),c=await initial(),d=await initial(),sim=new LocalNotifications();sim.copies=10;
  await new JobPublications(db).publishBatch(sim);
  await db.$executeRawUnsafe(`UPDATE "EmailOtpChallenge" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,a.job.challengeId);
  await db.emailOtpChallenge.delete({where:{id:b.job.challengeId}});await db.emailOtpChallenge.update({where:{id:c.job.challengeId},data:{consumedAt:new Date()}});
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "challengeId"=NULL WHERE "challengeId"=$1::uuid`,d.job.challengeId);
  await sim.drain(processJob,8);assert.equal(sim.received.length,40);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);assert.equal(await db.adaptiveInterview.count(),0);
});

for(const phase of ["SUMMARY","EMAIL"] as const)test(`Idle confirmed REPORT/${phase} publication is safely rearmed without phase confusion`,options,async t=>{
  const f=await report(),sim=new LocalNotifications(),service=new JobPublications(db);
  t.mock.method(renderer,"render",async()=>Buffer.from("%PDF-1.7\nSynthetic"));
  if(phase==="SUMMARY")await db.adaptiveReportJob.update({where:{id:f.job.id},data:{status:"PENDING",summary:null}});
  await service.publishBatch(sim);sim.pending=[];
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '121 seconds' WHERE state='PUBLISHED'`);
  assert.equal((await service.reconcile(1)).rearmed,1);assert.equal((await service.reconcile(1)).rearmed,0);
  await service.publishBatch(sim);assert.notEqual(sim.published[0].notificationId,sim.published[1].notificationId);assert.equal(sim.published[1].phase,phase);
  await sim.drain(processJob,2);const row=await db.adaptiveReportJob.findUniqueOrThrow({where:{id:f.job.id}});
  if(phase==="SUMMARY"){assert.equal(row.status,"COMPLETE");assert.equal(calls.length,0);}else{assert.equal(row.emailStatus,"SENT");assert.equal(calls.length,1);}
});

test("Concurrent reconcilers rearm an idle confirmed activation at most once",options,async()=>{
  await initial();await new JobPublications(db).publishBatch(new LocalNotifications());
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "publishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '121 seconds' WHERE state='PUBLISHED'`);
  const results=await Promise.all([new JobPublications(db).reconcile(1),new JobPublications(other).reconcile(1)]);
  assert.equal(results.reduce((sum,r)=>sum+r.rearmed,0),1);
  assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "JobPublicationIntent"`))[0].n,2);
});
