import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { PrismaClient, Prisma } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { JobPublications, type JobPublisher, type JobNotification } from "../src/services/job-publication.service.js";
import type { JobRequest } from "../src/services/job-request.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:60000};
const pepper="job-publication-synthetic-pepper-0123456789abcdef";
let db:PrismaClient,other:PrismaClient,server:Server,base:string;
let entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let Queue:typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let processJob:typeof import("../src/services/job-processing.service.js").processJob;
let enqueue:typeof import("../src/services/report-queue.service.js").enqueueReport;
let hashToken:typeof import("../src/security/tokens.js").hashGuestToken;
let messages:any[],transport:"accept"|"lost"|"rate";
const nativeFetch=globalThis.fetch.bind(globalThis);
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:"output/job-publication-step3b-20261031/nonexistent-synthetic.env"});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  ({OtpDeliveryQueue:Queue}=await import("../src/services/otp-delivery.service.js"));({processJob}=await import("../src/services/job-processing.service.js"));
  ({enqueueReport:enqueue}=await import("../src/services/report-queue.service.js"));({hashGuestToken:hashToken}=await import("../src/security/tokens.js"));
  const {app}=await import("../src/app.js");server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
});
beforeEach(async t=>{
  process.env.SKILLQUEST_ALLOW_REAL_BREVO = "1"; process.env.SKILLQUEST_ALLOW_REAL_GROQ = "1"; // mocked HTTP only
  if(options.skip)return;messages=[];transport="accept";delete process.env.SKILLQUEST_PROXY_HMAC_KEY;delete process.env.SKILLQUEST_PROXY_MODE;
  Object.assign(process.env,{NODE_ENV:"test",GROQ_API_KEY:"synthetic-no-network",AI_DAILY_REQUEST_LIMIT:"400",BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"60",EMAIL_APP_DAILY_LIMIT:"240",OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"100",OTP_GLOBAL_DAILY_SENDS:"120",
    OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);if(url.startsWith(base+"/"))return nativeFetch(input,init);
    if(url==="https://api.brevo.com/v3/smtp/email"){
      const body=JSON.parse(String(init?.body));assert.match(body.to[0].email,/@example\.test$/);messages.push(body);
      if(transport==="lost")throw Error("SYNTHETIC_RESPONSE_LOST");
      if(transport==="rate")return new Response(null,{status:429,headers:{"Retry-After":"60"}});
      return Response.json({messageId:"synthetic"},{status:201});
    }
    throw Error("EXTERNAL_NETWORK_FORBIDDEN");
  });
  await db.$executeRawUnsafe(`TRUNCATE "JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{if(options.skip)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await db.$disconnect();await other.$disconnect();});
function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {wait,open};}
const intents=()=>db.$queryRawUnsafe<any[]>(`SELECT * FROM "JobPublicationIntent" ORDER BY "createdAt",id`);
async function initial(){const p={fullName:"Synthetic student",email:randomUUID()+"@example.test",language:"fr" as const,emailReport:false};
  const r=await entry(p);assert.equal(r.status,409);const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:r.body.challengeId as string}});
  return {p,job,request:{kind:"OTP_INITIAL",jobId:job.id,phase:"DELIVER"} as JobRequest};}
async function retakeFixture(){const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic retake",email:randomUUID()+"@example.test",emailIdentity:randomUUID()+"@example.test",
  tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:{},lastTestStartedAt:new Date(Date.now()-31*86400000),expiresAt:new Date(Date.now()+86400000)}});
  const hash=createHmac("sha256",pepper).update(`retake:${row.id}:654321`).digest("hex");return {row,hash,input:{interviewId:row.id,lastTestStartedAt:row.lastTestStartedAt,codeHash:hash,
    payload:{recipient:row.email!,recipientName:row.displayName,subject:"Synthetic",htmlContent:"<p>654321</p>"}}};}
async function reportFixture(answers=31){let state=createPreparedInterview("fr");for(let n=0;n<answers;n++)state=advancePreparedInterview(state,{questionId:state.currentQuestion!.id,choiceId:state.currentQuestion!.choices![0].id});
  const token=randomUUID().replaceAll("-","").padEnd(64,"0");const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic report",email:randomUUID()+"@example.test",reportEmailRequested:true,
    tokenHash:hashToken(token),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});return {row,state,token};}
async function failIntent(){await db.$executeRawUnsafe(`CREATE FUNCTION publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic intent failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER publication_failure BEFORE INSERT ON "JobPublicationIntent" FOR EACH ROW EXECUTE FUNCTION publication_failure()`);}
async function removeFailure(){await db.$executeRawUnsafe(`DROP TRIGGER publication_failure ON "JobPublicationIntent"`);await db.$executeRawUnsafe(`DROP FUNCTION publication_failure()`);}
async function makeDue(){await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);}

test("Initial and retake OTP commits include one private, stable publication intent",options,async()=>{
  const a=await initial(),b=await retakeFixture();await new Queue(db).enqueue(b.input);
  const rows=await intents();assert.equal(rows.length,2);assert.equal(rows[0].jobId,a.job.id);
  assert.deepEqual(rows.map(r=>r.kind).sort(),["OTP_INITIAL","OTP_RETAKE"]);assert.ok(rows.every(r=>r.phase==="DELIVER"&&r.generation===0&&r.state==="PENDING"));
  const columns=(await db.$queryRawUnsafe<{column_name:string}[]>(`SELECT column_name FROM information_schema.columns WHERE table_name='JobPublicationIntent'`)).map(r=>r.column_name);
  for(const name of ["email","recipient","payload","encryptedPayload","code","token","pdf"])assert.ok(!columns.includes(name));
  assert.ok(!JSON.stringify(rows).includes(a.p.email));assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Intent insertion failure rolls back initial OTP, challenge and email gate together",options,async()=>{
  await failIntent();try{await assert.rejects(initial());assert.equal(await db.emailOtpChallenge.count(),0);assert.equal(await db.participantEmailDeliveryJob.count(),0);
    assert.equal(await db.participantEmailGate.count(),0);assert.equal((await intents()).length,0);assert.equal(await db.emailBudgetReservation.count(),0);}
  finally{await removeFailure();}
});

test("Intent failure rolls back retake code activation and outbox insertion",options,async()=>{
  const f=await retakeFixture();await failIntent();try{await assert.rejects(new Queue(db).enqueue(f.input));
    assert.deepEqual(await db.adaptiveInterview.findUniqueOrThrow({where:{id:f.row.id}}),f.row);assert.equal(await db.otpDeliveryJob.count(),0);assert.equal((await intents()).length,0);}
  finally{await removeFailure();}
});

test("Report job and intent are atomic when enqueue is called directly",options,async()=>{
  const f=await reportFixture();await failIntent();try{await assert.rejects(enqueue(f.row.id));assert.equal(await db.adaptiveReportJob.count(),0);assert.equal((await intents()).length,0);}
  finally{await removeFailure();}const job=await enqueue(f.row.id);assert.ok(job);assert.equal((await intents())[0].jobId,job.id);
});

test("Final answer, report job and intent commit together; SQL failure preserves the previous answer",options,async()=>{
  const f=await reportFixture(30),q=f.state.currentQuestion!;
  const answer=()=>fetch(base+"/api/v1/adaptive/answer",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${f.token}`},body:JSON.stringify({questionId:q.id,choiceId:q.choices![0].id})});
  await failIntent();try{assert.equal((await answer()).status,500);const saved=await db.adaptiveInterview.findUniqueOrThrow({where:{id:f.row.id}});
    assert.equal((saved.state as any).answers.length,30);assert.equal(await db.adaptiveReportJob.count(),0);assert.equal((await intents()).length,0);}
  finally{await removeFailure();}assert.equal((await answer()).status,200);assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{interviewId:f.row.id}})).status,"PENDING");
  assert.equal((await intents()).length,1);assert.equal((await intents())[0].phase,"SUMMARY");
});

test("Report EMAIL activation and its intent roll back or commit in the same statement",options,async()=>{
  const f=await reportFixture(),j=(await enqueue(f.row.id))!;
  await failIntent();try{await assert.rejects(db.adaptiveReportJob.update({where:{id:j.id},data:{status:"COMPLETE",summary:JSON.stringify({fr:"Test.",ar:"تجربة."})}}));
    assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{id:j.id}})).status,"PENDING");assert.equal((await intents()).length,1);assert.equal((await intents())[0].state,"PENDING");}
  finally{await removeFailure();}
  await db.adaptiveReportJob.update({where:{id:j.id},data:{status:"COMPLETE",summary:JSON.stringify({fr:"Test.",ar:"تجربة."})}});
  const rows=await intents();assert.equal(rows.find(r=>r.phase==="SUMMARY").state,"CANCELLED");assert.equal(rows.find(r=>r.phase==="EMAIL").state,"PENDING");
});

test("Known OTP retry creates a new notification generation without changing the Brevo job UUID",options,async()=>{
  const f=await initial(),first=(await intents())[0];transport="rate";await processJob(f.request);
  const rows=await intents(),next=rows.find(r=>r.generation===1);assert.ok(next);assert.notEqual(next.id,first.id);assert.equal(next.jobId,f.job.id);
  assert.equal(rows.find(r=>r.id===first.id).state,"CANCELLED");assert.equal(messages[0].headers.IdempotencyKey,f.job.id);
  const published:JobNotification[]=[];await new JobPublications(db).publishBatch({publish:async n=>{published.push(n);}});assert.equal(published.length,0);
});

test("Key-unavailable retry gets a new intention at its new due time even without a transport attempt",options,async()=>{
  const key=Buffer.alloc(32,37).toString("base64");
  process.env.OTP_ENCRYPTION_KEYS=JSON.stringify({test:key});process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID="test";
  try{const f=await initial(),first=(await intents())[0];await new JobPublications(db).publishBatch({publish:async()=>{}});
    process.env.OTP_ENCRYPTION_KEYS="{}";delete process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID;
    await processJob(f.request);const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}});
    assert.equal(job.attempts,0);assert.equal(job.status,"PENDING");assert.equal(messages.length,0);
    const rows=await intents();assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===first.id).state,"PUBLISHED");
    const next=rows.find(r=>r.id!==first.id);assert.equal(next.generation,0);assert.equal(next.state,"PENDING");assert.notEqual(next.dueAt.getTime(),first.dueAt.getTime());
    assert.equal(await db.emailBudgetReservation.count(),0);
  }finally{delete process.env.OTP_ENCRYPTION_KEYS;delete process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID;}
});

test("Committed job survives simulated publication failure with stable notification and no email",options,async()=>{
  const f=await initial(),before=(await intents())[0];const result=await new JobPublications(db).publishBatch({publish:async()=>{throw Error("SYNTHETIC_PUBLISH_FAILURE");}});
  assert.equal(result.deferred,1);const row=(await intents())[0];assert.equal(row.id,before.id);assert.equal(row.state,"PENDING");assert.equal(row.attempts,1);
  assert.equal(row.attemptToken,null);assert.equal(row.lastErrorCode,"PUBLICATION_RESULT_UNKNOWN");assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}})).status,"PENDING");assert.equal(messages.length,0);
});

test("Accepted publication with lost response retries the SAME UUID and duplicate notifications send once",options,async()=>{
  const f=await initial(),accepted=new Map<string,JobNotification>(),calls:JobNotification[]=[];
  const publisher:JobPublisher={publish:async n=>{calls.push(n);accepted.set(n.notificationId,n);if(calls.length===1)throw Error("SYNTHETIC_RESPONSE_LOST");}};
  await new JobPublications(db).publishBatch(publisher);await makeDue();await new JobPublications(other).publishBatch(publisher);
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(accepted.size,1);assert.equal((await intents())[0].state,"PUBLISHED");
  assert.deepEqual(Object.keys(calls[0]).sort(),["dueAt","generation","jobId","kind","notificationId","phase","version"]);
  await Promise.all(Array.from({length:6},()=>processJob(f.request)));assert.equal(messages.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Independent PostgreSQL publishers cannot claim the same active intent twice",options,async()=>{
  await initial();const entered=gate(),release=gate(),calls:JobNotification[]=[];
  const pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  const first=new JobPublications(db).publishBatch({publish:async n=>{calls.push(n);entered.open();await release.wait;}},1);
  try{await entered.wait;const second=await new JobPublications(other).publishBatch({publish:async n=>{calls.push(n);}},1);assert.equal(second.published,0);assert.equal(calls.length,1);}
  finally{release.open();await first;}
  assert.equal((await intents())[0].attempts,1);console.log("3B publisher concurrency",JSON.stringify({pids:pids.map(r=>r[0].pid),notifications:calls.length}));
});

test("Expired publication lease recovers with same notification and fences stale acknowledgement",options,async()=>{
  await initial();const entered=gate(),release=gate(),calls:string[]=[];
  const first=new JobPublications(db).publishBatch({publish:async n=>{calls.push(n.notificationId);entered.open();await release.wait;throw Error("OLD_RESULT_LOST");}},1);
  let oldResult;try{await entered.wait;await other.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PUBLISHING'`);
    const result=await new JobPublications(other).publishBatch({publish:async n=>{calls.push(n.notificationId);}},1);assert.equal(result.published,1);}
  finally{release.open();oldResult=await first;}
  const row=(await intents())[0];assert.equal(row.state,"PUBLISHED");assert.equal(row.attempts,2);assert.equal(oldResult.stale,1);assert.equal(new Set(calls).size,1);
});

test("Crash after persistent claim is recoverable without changing notification UUID",options,async()=>{
  await initial();const row=(await intents())[0];
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET state='PUBLISHING',attempts=1,"attemptToken"=$2::uuid,"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`,row.id,randomUUID());
  const calls:string[]=[];await new JobPublications(other).publishBatch({publish:async n=>{calls.push(n.notificationId);}});
  assert.deepEqual(calls,[row.id]);assert.equal((await intents())[0].attempts,2);assert.equal(messages.length,0);
});

test("Database failure after accepted publication leaves a recoverable lease and stable UUID",options,async()=>{
  await initial();const accepted=new Set<string>();
  const publisher:JobPublisher={publish:async n=>{accepted.add(n.notificationId);}};
  await db.$executeRawUnsafe(`CREATE FUNCTION publication_ack_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='PUBLISHED' THEN RAISE EXCEPTION 'synthetic acknowledgement failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER publication_ack_failure BEFORE UPDATE ON "JobPublicationIntent" FOR EACH ROW EXECUTE FUNCTION publication_ack_failure()`);
  try{await assert.rejects(new JobPublications(db).publishBatch(publisher));assert.equal((await intents())[0].state,"PUBLISHING");}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER publication_ack_failure ON "JobPublicationIntent"`);await db.$executeRawUnsafe(`DROP FUNCTION publication_ack_failure()`);}
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PUBLISHING'`);
  await new JobPublications(other).publishBatch(publisher);assert.equal(accepted.size,1);assert.equal((await intents())[0].state,"PUBLISHED");assert.equal((await intents())[0].attempts,2);
});

test("Bounded reconciliation repairs pre-existing missing intents idempotently",options,async()=>{
  await initial();await initial();await initial();await db.$executeRawUnsafe(`DELETE FROM "JobPublicationIntent"`);
  const service=new JobPublications(db);assert.equal((await service.reconcile(1)).intents,1);assert.equal((await intents()).length,1);
  await Promise.all([service.reconcile(2),new JobPublications(other).reconcile(2)]);await service.reconcile(3);
  const rows=await intents();assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.jobId)).size,3);
});

test("Completed report without job is repaired once across independent connections",options,async()=>{
  const f=await reportFixture();await Promise.all([new JobPublications(db).reconcile(1),new JobPublications(other).reconcile(1)]);
  await new JobPublications(db).reconcile(1);assert.equal(await db.adaptiveReportJob.count(),1);assert.equal((await intents()).length,1);
  assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{interviewId:f.row.id}})).id,(await intents())[0].jobId);
});

test("Consumed or expired OTP intents are cancelled without transport or reactivation",options,async()=>{
  const a=await initial(),b=await initial();await db.emailOtpChallenge.update({where:{id:a.job.challengeId},data:{consumedAt:new Date()}});
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,b.job.id);
  let calls=0;const service=new JobPublications(db);await service.reconcile();await service.publishBatch({publish:async()=>{calls++;}});
  assert.ok((await intents()).every(r=>r.state==="CANCELLED"));assert.equal(calls,0);assert.equal(messages.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("UNCERTAIN OTP never gains a new executable notification or second Brevo reservation",options,async()=>{
  const f=await initial();transport="lost";await processJob(f.request);const before=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}});
  assert.equal(before.status,"UNCERTAIN");assert.ok(before.encryptedPayload);let calls=0;
  await new JobPublications(db).reconcile();await new JobPublications(db).publishBatch({publish:async()=>{calls++;}});transport="accept";await processJob(f.request);
  assert.equal(calls,0);assert.equal(messages.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
  assert.deepEqual(await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}}),before);
});

test("ACCEPTED and REJECTED jobs stay terminal through reconciliation",options,async()=>{
  const a=await initial(),b=await initial();await processJob(a.request);await db.participantEmailDeliveryJob.update({where:{id:b.job.id},data:{status:"REJECTED",nextAttemptAt:null,encryptedPayload:null}});
  await new JobPublications(db).reconcile();let calls=0;await new JobPublications(db).publishBatch({publish:async()=>{calls++;}});
  assert.equal(calls,0);assert.equal(messages.length,1);assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:a.job.id}})).status,"ACCEPTED");
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:b.job.id}})).status,"REJECTED");
});

test("Deletion during publication cancels intent and stale acknowledgement cannot revive a job",options,async()=>{
  const f=await initial();const result=await new JobPublications(db).publishBatch({publish:async()=>{await other.emailOtpChallenge.delete({where:{id:f.job.challengeId}});}});
  assert.equal(result.stale,1);assert.equal((await intents())[0].state,"CANCELLED");await processJob(f.request);
  assert.equal(await db.participantEmailDeliveryJob.count(),0);assert.equal(messages.length,0);
});

test("Reconciliation and publishing reject unbounded or invalid batch sizes",options,async()=>{
  const service=new JobPublications(db);for(const limit of [0,-1,101,1.5,NaN]){
    await assert.rejects(service.reconcile(limit),/JOB_BATCH_INVALID/);await assert.rejects(service.publishBatch({publish:async()=>{}},limit),/JOB_BATCH_INVALID/);
  }
  assert.equal((await intents()).length,0);
});
