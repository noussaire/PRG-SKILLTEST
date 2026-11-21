import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { decryptOtpPayload } from "../src/security/otp-payload.js";
import type { JobRequest } from "../src/services/job-request.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:60000};
const pepper="job-id-synthetic-pepper-0123456789abcdef";
const summary=JSON.stringify({fr:"Synthèse pédagogique synthétique.",ar:"خلاصة تربوية تجريبية."});
let db:PrismaClient,other:PrismaClient;
let processJob:typeof import("../src/services/job-processing.service.js").processJob;
let Queue:typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let retake:typeof import("../src/services/participant-retake.service.js").startParticipantTest;
let reportQueue:typeof import("../src/services/report-queue.service.js");
let reportEmail:typeof import("../src/services/report-email-queue.service.js");
let renderer:typeof import("../src/services/report-pdf.service.js").reportPdfRenderer;
let messages:any[],aiCalls:number,mode:"accept"|"lost"|"rate",aiRate:boolean;
let transportHook:(()=>Promise<void>)|undefined;
let aiHook:(()=>Promise<string>)|undefined;
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:"output/job-id-step3a-20261031/nonexistent-synthetic.env"});
  ({prisma:db}=await import("../src/db/prisma.js"));
  ({processJob}=await import("../src/services/job-processing.service.js"));
  ({OtpDeliveryQueue:Queue}=await import("../src/services/otp-delivery.service.js"));
  ({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  ({startParticipantTest:retake}=await import("../src/services/participant-retake.service.js"));
  reportQueue=await import("../src/services/report-queue.service.js");reportEmail=await import("../src/services/report-email-queue.service.js");
  ({reportPdfRenderer:renderer}=await import("../src/services/report-pdf.service.js"));
});
beforeEach(async t=>{
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1"; process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1"; // mocked HTTP only
  if(options.skip)return;messages=[];aiCalls=0;mode="accept";aiRate=false;transportHook=undefined;aiHook=undefined;
  delete process.env.OTP_ENCRYPTION_KEYS;delete process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID;delete process.env.OTP_PAYLOAD_WRITE_VERSION;
  Object.assign(process.env,{JOIN_CODE_PEPPER:pepper,GROQ_API_KEY:"synthetic-no-network",AI_DAILY_REQUEST_LIMIT:"400",
    BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"60",EMAIL_APP_DAILY_LIMIT:"240",
    OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"100",OTP_GLOBAL_DAILY_SENDS:"120",OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);
    if(url==="https://api.brevo.com/v3/smtp/email"){
      const message=JSON.parse(String(init?.body));assert.match(message.to[0].email,/@example\.test$/);messages.push(message);
      if(transportHook)await transportHook();
      if(mode==="lost")throw Error("SYNTHETIC_LOST_RESPONSE");
      if(mode==="rate")return new Response(null,{status:429,headers:{"Retry-After":"60"}});
      return Response.json({messageId:"synthetic"},{status:201});
    }
    if(url==="https://api.groq.com/openai/v1/chat/completions"){
      aiCalls++;if(aiRate)return new Response(null,{status:429,headers:{"Retry-After":"120"}});
      const content=aiHook?await aiHook():summary;
      return Response.json({choices:[{finish_reason:"stop",message:{content}}]});
    }
    throw Error("EXTERNAL_NETWORK_FORBIDDEN");
  });
  await db.$executeRawUnsafe(`TRUNCATE "User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{await db?.$disconnect();await other?.$disconnect();});

function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {wait,open};}
async function otp(kind:"OTP_INITIAL"|"OTP_RETAKE",email=randomUUID()+"@example.test"){
  const p={fullName:"Synthetic student",email,language:"fr" as const,emailReport:false};
  const table=kind==="OTP_INITIAL"?"ParticipantEmailDeliveryJob":"OtpDeliveryJob";
  let ownerId:string;
  if(kind==="OTP_INITIAL"){const r=await entry(p);assert.equal(r.status,409);ownerId=r.body.challengeId as string;}
  else{
    const row=await db.adaptiveInterview.create({data:{displayName:p.fullName,email,emailIdentity:email,tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:{},
      lastTestStartedAt:new Date(Date.now()-31*86400000),expiresAt:new Date(Date.now()+86400000)}});ownerId=row.id;
    const hash=createHmac("sha256",pepper).update(`retake:${ownerId}:654321`).digest("hex");
    await new Queue(db).enqueue({interviewId:ownerId,lastTestStartedAt:row.lastTestStartedAt,codeHash:hash,payload:{recipient:email,recipientName:p.fullName,subject:"Synthetic",htmlContent:"<p>654321</p>"}});
  }
  const job=(await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}" WHERE "${kind==="OTP_INITIAL"?"challengeId":"interviewId"}"=$1::uuid`,ownerId))[0];
  const payload=decryptOtpPayload(job.encryptedPayload,job.id) as {htmlContent:string};
  return {kind,table,p,ownerId,job,code:payload.htmlContent.match(/>(\d{6})<\//)![1],request:{kind,jobId:job.id,phase:"DELIVER"} as JobRequest};
}
async function otpRow(f:Awaited<ReturnType<typeof otp>>){return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${f.table}" WHERE id=$1::uuid`,f.job.id))[0];}
async function report(language:"fr"|"ar"="fr",ready=true){
  let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
  const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic report",email:randomUUID()+"@example.test",reportEmailRequested:true,
    tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
  const job=await db.adaptiveReportJob.create({data:{interviewId:row.id,status:ready?"COMPLETE":"PENDING",summary:ready?summary:null,emailStatus:"PENDING"}});
  return {row,job,request:{kind:"REPORT",jobId:job.id,phase:ready?"EMAIL":"SUMMARY"} as JobRequest};
}
const reportRow=(id:string)=>db.adaptiveReportJob.findUniqueOrThrow({where:{id}});

test("Explicit jobs reject invalid UUID, kind, phase and extra transport fields before database work",options,async()=>{
  let databaseCalls=0;
  const blocked={ $transaction:()=>{databaseCalls++;throw Error("DATABASE_MUST_NOT_BE_CALLED");} } as unknown as PrismaClient;
  const validationError=(error:any)=>error.name==="ZodError";
  const valid={kind:"OTP_INITIAL",jobId:randomUUID(),phase:"DELIVER"};
  for(const input of [null,{}, {...valid,jobId:""},{...valid,jobId:"not-a-uuid"},{...valid,jobId:"' OR TRUE --"},{...valid,phase:"EMAIL"},{...valid,kind:"arbitrary-table"},
    {...valid,payload:{}},{...valid,recipient:"attacker@example.test"},{kind:"REPORT",jobId:randomUUID(),phase:"DELIVER"}])await assert.rejects(processJob(input),validationError);
  await assert.rejects(reportQueue.processReportQueue(""),validationError);await assert.rejects(reportEmail.processReportEmails("invalid"),validationError);
  await assert.rejects(new Queue(blocked).processJob("OTP_INITIAL","invalid"),validationError);
  await assert.rejects(new Queue(blocked).processJob("OTHER" as any,randomUUID()),/JOB_KIND_INVALID/);
  assert.equal(databaseCalls,0);assert.equal(messages.length,0);assert.equal(aiCalls,0);
});

for(const kind of ["OTP_INITIAL","OTP_RETAKE"] as const)test(`Explicit ${kind} sends only the requested UUID and preserves valid OTP verification`,options,async()=>{
  const otherJob=await otp(kind),target=await otp(kind);const before=await otpRow(otherJob);
  await processJob(target.request);await processJob(target.request);
  assert.equal(messages.length,1);assert.equal(messages[0].headers.IdempotencyKey,target.job.id);assert.deepEqual(await otpRow(otherJob),before);
  assert.equal((await otpRow(target)).status,"ACCEPTED");assert.equal(await db.emailBudgetReservation.count(),1);
  const result=kind==="OTP_INITIAL"?await entry({...target.p,challengeId:target.ownerId,verificationCode:target.code}):await retake({...target.p,verificationCode:target.code});
  assert.equal(result.status,201);
});

test("Explicit kind and phase never fall back to another table, phase or ready job",options,async()=>{
  const initial=await otp("OTP_INITIAL"),retakeJob=await otp("OTP_RETAKE"),pending=await report("fr",false),ready=await report();
  await processJob({...initial.request,jobId:retakeJob.job.id});await processJob({...retakeJob.request,jobId:initial.job.id});
  await processJob({kind:"REPORT",jobId:initial.job.id,phase:"SUMMARY"});await processJob({...pending.request,phase:"EMAIL"});await processJob({...ready.request,phase:"SUMMARY"});
  assert.deepEqual(await otpRow(initial),initial.job);assert.deepEqual(await otpRow(retakeJob),retakeJob.job);
  assert.deepEqual(await reportRow(pending.job.id),pending.job);assert.deepEqual(await reportRow(ready.job.id),ready.job);assert.equal(messages.length,0);assert.equal(aiCalls,0);
});

test("Targeted OTP never performs expired cleanup or receipt reconciliation on other UUIDs",options,async()=>{
  const expired=await otp("OTP_INITIAL"),receipt=await otp("OTP_INITIAL"),target=await otp("OTP_INITIAL");
  await processJob(receipt.request);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,expired.job.id);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET status='UNCERTAIN',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`,receipt.job.id);
  const before=await Promise.all([otpRow(expired),otpRow(receipt)]);
  await processJob(target.request);assert.deepEqual(await Promise.all([otpRow(expired),otpRow(receipt)]),before);assert.equal(messages.length,2);
});

test("Missing and deleted explicit jobs have no fallback or participant recreation",options,async()=>{
  const initial=await otp("OTP_INITIAL"),r=await report();
  await db.emailOtpChallenge.delete({where:{id:initial.ownerId}});await db.adaptiveInterview.delete({where:{id:r.row.id}});
  const ready=await otp("OTP_INITIAL"),before=await otpRow(ready);
  for(const request of [initial.request,r.request,{kind:"OTP_RETAKE",jobId:randomUUID(),phase:"DELIVER"}])await processJob(request);
  assert.deepEqual(await otpRow(ready),before);assert.equal(await db.adaptiveInterview.count(),0);assert.equal(messages.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Expired explicit jobs do not send or clean any other job",options,async()=>{
  const a=await otp("OTP_INITIAL"),b=await otp("OTP_RETAKE"),r=await report(),s=await report("fr",false);
  for(const f of [a,b])await db.$executeRawUnsafe(`UPDATE "${f.table}" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,f.job.id);
  await db.adaptiveInterview.update({where:{id:r.row.id},data:{expiresAt:new Date(Date.now()-1000)}});
  await db.adaptiveInterview.update({where:{id:s.row.id},data:{expiresAt:new Date(Date.now()-1000)}});
  const before=await Promise.all([otpRow(a),otpRow(b),reportRow(r.job.id),reportRow(s.job.id)]);
  await processJob(a.request);await processJob(b.request);await processJob(r.request);await processJob(s.request);
  assert.deepEqual(await Promise.all([otpRow(a),otpRow(b),reportRow(r.job.id),reportRow(s.job.id)]),before);assert.equal(messages.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Active leases and future schedules cannot be forced by explicit messages",options,async()=>{
  const a=await otp("OTP_INITIAL"),r=await report(),s=await report("fr",false);
  const token=randomUUID();await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "attemptToken"=$2::uuid,"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 minutes' WHERE id=$1::uuid`,a.job.id,token);
  await db.adaptiveReportJob.update({where:{id:r.job.id},data:{emailStatus:"PROCESSING",emailLeaseUntil:new Date(Date.now()+120000)}});
  await db.adaptiveReportJob.update({where:{id:s.job.id},data:{nextAttemptAt:new Date(Date.now()+120000)}});
  const before=await Promise.all([otpRow(a),reportRow(r.job.id),reportRow(s.job.id)]);
  await Promise.all([processJob(a.request),processJob(r.request),processJob(s.request)]);
  assert.deepEqual(await Promise.all([otpRow(a),reportRow(r.job.id),reportRow(s.job.id)]),before);assert.equal(messages.length,0);assert.equal(aiCalls,0);
});

test("Obsolete consumed OTP cannot send or activate a different challenge",options,async()=>{
  const a=await otp("OTP_INITIAL"),b=await otp("OTP_INITIAL");await db.emailOtpChallenge.update({where:{id:a.ownerId},data:{consumedAt:new Date()}});
  await processJob(a.request);assert.equal((await otpRow(a)).status,"REJECTED");assert.deepEqual(await otpRow(b),b.job);assert.equal(messages.length,0);
});

for(const kind of ["OTP_INITIAL","OTP_RETAKE"] as const)test(`Explicit ${kind} concurrency across independent PostgreSQL connections sends once`,options,async()=>{
  const f=await otp(kind),entered=gate(),release=gate();transportHook=async()=>{entered.open();await release.wait;};
  const pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);
  assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  const first=processJob(f.request);try{await entered.wait;
    const busy=await otpRow(f);assert.equal(busy.status,"UNCERTAIN");assert.ok(busy.attemptToken);assert.ok(busy.leaseUntil);
    await Promise.all(Array.from({length:5},()=>new Queue(other).processJob(kind,f.job.id)));assert.equal(messages.length,1);
  }finally{release.open();await first;}
  await processJob(f.request);assert.equal(messages.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
  console.log("3A explicit OTP concurrency",JSON.stringify({kind,pids:pids.map(r=>r[0].pid),providerCalls:messages.length,reservations:await db.emailBudgetReservation.count()}));
});

test("Uncertain OTP receipts remain uncertain with ciphertext and are never automatically resent",options,async()=>{
  for(const kind of ["OTP_INITIAL","OTP_RETAKE"] as const){const f=await otp(kind);mode="lost";await processJob(f.request);
    const uncertain=await otpRow(f),calls=messages.length;assert.equal(uncertain.status,"UNCERTAIN");assert.ok(uncertain.encryptedPayload);assert.equal(uncertain.nextAttemptAt,null);
    await db.$executeRawUnsafe(`UPDATE "${f.table}" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`,f.job.id);
    mode="accept";await processJob(f.request);assert.equal(messages.length,calls);assert.equal((await otpRow(f)).status,"UNCERTAIN");
    assert.equal((await otpRow(f)).encryptedPayload,uncertain.encryptedPayload);
  }
});

test("OTP accepted receipt reconciles only its UUID and stale attempt token cannot finish a newer lease",options,async()=>{
  const f=await otp("OTP_INITIAL"),otherJob=await otp("OTP_INITIAL"),newToken=randomUUID();
  transportHook=async()=>{await other.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "attemptToken"=$2::uuid WHERE id=$1::uuid`,f.job.id,newToken);};
  await processJob(f.request);const stale=await otpRow(f);assert.equal(stale.status,"UNCERTAIN");assert.equal(stale.attemptToken,newToken);
  await processJob(f.request);assert.equal(messages.length,1);assert.deepEqual(await otpRow(otherJob),otherJob.job);
  await other.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`,f.job.id);
  await processJob(f.request);assert.equal((await otpRow(f)).status,"ACCEPTED");assert.equal(messages.length,1);assert.deepEqual(await otpRow(otherJob),otherJob.job);
});

test("Explicit summary processes only its report and does not start PDF or email phases",options,async()=>{
  const a=await report("fr",false),b=await report("ar",false);await processJob(b.request);await processJob(b.request);
  assert.deepEqual(await reportRow(a.job.id),a.job);assert.equal((await reportRow(b.job.id)).status,"COMPLETE");assert.equal(aiCalls,1);assert.equal(messages.length,0);
  assert.equal((await reportRow(b.job.id)).emailStatus,"PENDING");
});

test("Summary lease recovery and attempt counter fence stale completion even when lease timestamps repeat",options,async t=>{
  const r=await report("fr",false),entered=gate(),release=gate();let calls=0;
  const now=Date.now();t.mock.method(Date,"now",()=>now);
  aiHook=async()=>{if(++calls===1){entered.open();await release.wait;return JSON.stringify({fr:"Ancienne synthèse.",ar:"خلاصة قديمة."});}return summary;};
  const first=processJob(r.request);try{await entered.wait;
    await other.adaptiveReportJob.update({where:{id:r.job.id},data:{leaseUntil:new Date(now-1000)}});
    await processJob(r.request);assert.equal((await reportRow(r.job.id)).summary,summary);
  }finally{release.open();await first;}
  const final=await reportRow(r.job.id);assert.equal(final.summary,summary);assert.equal(final.attempts,2);assert.equal(final.status,"COMPLETE");
});

for(const language of ["fr","ar"] as const)test(`Explicit ${language} report renders its real PDF and sends only its UUID once`,options,async()=>{
  const otherJob=await report(language),r=await report(language);await processJob(r.request);await processJob(r.request);
  assert.deepEqual(await reportRow(otherJob.job.id),otherJob.job);assert.equal(messages.length,1);const message=messages[0];
  assert.equal(message.headers.IdempotencyKey,r.job.id);assert.match(message.htmlContent,new RegExp(`lang="${language}"`));
  const pdf=Buffer.from(message.attachment[0].content,"base64");assert.equal(pdf.subarray(0,5).toString(),"%PDF-");assert.ok(pdf.toString("latin1").includes("/StructTreeRoot"));
  assert.equal((await reportRow(r.job.id)).emailStatus,"SENT");assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Concurrent report email recovery fences stale PDF preparation before provider contact",options,async t=>{
  const r=await report(),entered=gate(),release=gate();let renders=0;const now=Date.now();t.mock.method(Date,"now",()=>now);
  t.mock.method(renderer,"render",async()=>{if(++renders===1){entered.open();await release.wait;}return Buffer.from("%PDF-1.7\nSynthetic");});
  const first=processJob(r.request);try{await entered.wait;
    await other.adaptiveReportJob.update({where:{id:r.job.id},data:{emailLeaseUntil:new Date(now-1000)}});
    await Promise.all([processJob(r.request),processJob(r.request)]);
  }finally{release.open();await first;}
  const final=await reportRow(r.job.id);assert.equal(final.emailStatus,"SENT");assert.equal(final.emailAttempts,2);assert.equal(messages.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Terminal report phases, consent withdrawal and expired uncertainty never send",options,async()=>{
  for(const status of ["SENT","FAILED","UNKNOWN","NOT_REQUESTED"]){const r=await report();await db.adaptiveReportJob.update({where:{id:r.job.id},data:{emailStatus:status}});
    const before=await reportRow(r.job.id);await processJob(r.request);assert.deepEqual(await reportRow(r.job.id),before);}
  const withdrawn=await report();await db.adaptiveInterview.update({where:{id:withdrawn.row.id},data:{reportEmailRequested:false}});await processJob(withdrawn.request);
  const uncertain=await report();await db.adaptiveReportJob.update({where:{id:uncertain.job.id},data:{emailStatus:"RETRY",emailAttemptWindowAt:new Date(Date.now()-601000)}});
  await processJob(uncertain.request);assert.equal((await reportRow(uncertain.job.id)).emailStatus,"UNKNOWN");assert.equal(messages.length,0);
});

test("Targeted provider quota errors do not reschedule any other report",options,async t=>{
  const a=await report("fr",false),b=await report("ar",false);aiRate=true;await processJob(b.request);
  assert.equal((await reportRow(b.job.id)).status,"RETRY");assert.deepEqual(await reportRow(a.job.id),a.job);
  const x=await report(),y=await report();t.mock.method(renderer,"render",async()=>Buffer.from("%PDF-1.7\nSynthetic"));mode="rate";
  await processJob(y.request);assert.equal((await reportRow(y.job.id)).emailStatus,"RETRY");assert.deepEqual(await reportRow(x.job.id),x.job);
});

test("Explicit OTP SQL failure rolls back its claim and cannot consume budget or send",options,async()=>{
  const f=await otp("OTP_INITIAL");
  await db.$executeRawUnsafe(`CREATE FUNCTION job_3a_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic claim failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER job_3a_failure BEFORE UPDATE ON "ParticipantEmailDeliveryJob" FOR EACH ROW EXECUTE FUNCTION job_3a_failure()`);
  try{await assert.rejects(processJob(f.request));assert.deepEqual(await otpRow(f),f.job);assert.equal(messages.length,0);assert.equal(await db.emailBudgetReservation.count(),0);}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER job_3a_failure ON "ParticipantEmailDeliveryJob"`);await db.$executeRawUnsafe(`DROP FUNCTION job_3a_failure()`);}
});

test("Local report selectors without identifiers retain summary and email processing",options,async t=>{
  const r=await report("fr",false);t.mock.method(renderer,"render",async()=>Buffer.from("%PDF-1.7\nSynthetic"));
  await reportQueue.processReportQueue();assert.equal((await reportRow(r.job.id)).status,"COMPLETE");
  await reportEmail.processReportEmails();assert.equal((await reportRow(r.job.id)).emailStatus,"SENT");assert.equal(messages.length,1);
});
