import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { PrismaClient, Prisma } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { JobPublications, type JobNotification } from "../src/services/job-publication.service.js";
import { QstashPublisher, type SimulatedQstashTransport } from "../src/services/qstash-publisher.service.js";
import { createPreparedInterview, advancePreparedInterview } from "../src/services/prepared-interview.service.js";
import { qstashCurrent, qstashNext, qstashUrl, signQstash } from "./helpers/qstash-signature.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:60000};
let db:PrismaClient,other:PrismaClient,server:Server,base:string;
let entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let calls:any[],messages:JobNotification[],publishMode:"accept"|"reject"|"lost",brevoMode:"accept"|"lost"|"rate";
let onBrevo:(()=>Promise<void>)|undefined;
const nativeFetch=globalThis.fetch.bind(globalThis),pepper="qstash-synthetic-pepper-0123456789abcdef";
const transport:SimulatedQstashTransport={mode:"simulated",request:async(url,init)=>{
  assert.equal(new URL(url).hostname,"qstash.upstash.io");assert.equal(new Headers(init.headers).get("authorization"),"Bearer synthetic-publish-token");
  if(publishMode==="reject")throw Error("SIMULATED_QSTASH_UNAVAILABLE");
  messages.push(JSON.parse(String(init.body)));if(publishMode==="lost")throw Error("SIMULATED_QSTASH_RESPONSE_LOST");
  return Response.json({messageId:"synthetic-message"},{status:202});
}};
const publisher=()=>new QstashPublisher({token:"synthetic-publish-token",publishOrigin:"https://qstash.upstash.io",callbackUrl:qstashUrl},transport);
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:"output/qstash-step3d-20261031/nonexistent-synthetic.env"});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  const {app}=await import("../src/app.js");server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
});
beforeEach(async t=>{
  if(options.skip)return;calls=[];messages=[];publishMode="accept";brevoMode="accept";onBrevo=undefined;
  Object.assign(process.env,{NODE_ENV:"test",SKILLQUEST_QSTASH_MODE:"simulated",QSTASH_CURRENT_SIGNING_KEY:qstashCurrent,QSTASH_NEXT_SIGNING_KEY:qstashNext,QSTASH_CALLBACK_URL:qstashUrl,
    GROQ_API_KEY:"synthetic-no-network",BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300",
    OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"1000",OTP_GLOBAL_DAILY_SENDS:"1000",OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);if(url.startsWith(base+"/"))return nativeFetch(input,init);
    if(url==="https://api.brevo.com/v3/smtp/email"){
      const body=JSON.parse(String(init?.body));assert.match(body.to[0].email,/@example\.test$/);calls.push(body);if(onBrevo)await onBrevo();
      if(brevoMode==="lost")throw Error("SIMULATED_BREVO_RESPONSE_LOST");
      if(brevoMode==="rate")return new Response(null,{status:429,headers:{"Retry-After":"60"}});
      return Response.json({messageId:"synthetic-accepted"},{status:201});
    }
    throw Error("EXTERNAL_NETWORK_FORBIDDEN");
  });
  await db.$executeRawUnsafe(`TRUNCATE "JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{if(options.skip)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await db.$disconnect();await other.$disconnect();});
async function initial(){const p={fullName:"Synthetic callback",email:randomUUID()+"@example.test",language:"fr" as const,emailReport:false};const result=await entry(p);assert.equal(result.status,409);
  const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:result.body.challengeId as string}});return {p,job};}
async function emit(){await new JobPublications(db).publishBatch(publisher());return messages[messages.length-1];}
async function callback(n:JobNotification,signature?:string,headers:Record<string,string>={}){
  const body=JSON.stringify(n);const r=await fetch(base+"/api/internal/jobs/qstash",{method:"POST",headers:{"content-type":"application/json","upstash-signature":signature??signQstash(body),...headers},body});
  return {status:r.status,body:await r.json() as any};
}
function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {wait,open};}
async function report(language:"fr"|"ar"){
  let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
  const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic report",email:randomUUID()+"@example.test",reportEmailRequested:true,
    tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
  return db.adaptiveReportJob.create({data:{interviewId:row.id,status:"COMPLETE",summary:JSON.stringify({fr:"Synthèse synthétique.",ar:"خلاصة تجريبية."}),emailStatus:"PENDING"}});
}

test("Native simulated QStash publication and authenticated raw callback complete only the registered job",options,async()=>{
  const f=await initial();const n=await emit();assert.equal(n.jobId,f.job.id);assert.equal(calls.length,0);
  assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT state FROM "JobPublicationIntent" WHERE id=$1::uuid`,n.notificationId))[0].state,"PUBLISHED");
  const r=await callback(n);assert.equal(r.status,200);assert.equal(r.body.disposition,"COMPLETE");assert.equal(calls.length,1);assert.equal(calls[0].headers.IdempotencyKey,f.job.id);
  assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "ProxyRequestNonce"`))[0].n,0);
});

test("Invalid signatures are rejected even when the publication table is unavailable; valid SQL failures return 500",options,async()=>{
  await initial();const n=await emit();await db.$executeRawUnsafe(`ALTER TABLE "JobPublicationIntent" RENAME TO "QstashIntentHidden"`);
  try{
    assert.equal((await callback(n,"forged")).status,401);
    assert.equal((await callback(n,signQstash(JSON.stringify(n),qstashCurrent,{sub:"https://other.example.test/api/internal/jobs/qstash"}))).status,401);
    assert.equal((await callback(n)).status,500);assert.equal(calls.length,0);
  }finally{await db.$executeRawUnsafe(`ALTER TABLE "QstashIntentHidden" RENAME TO "JobPublicationIntent"`);}
});

test("Valid signatures cannot change registered notification UUID, job UUID, phase, generation or due time",options,async()=>{
  await initial();const n=await emit(),otherJob=await initial();
  for(const changed of [{...n,notificationId:randomUUID()},{...n,jobId:otherJob.job.id},{...n,generation:n.generation+1},{...n,dueAt:new Date(new Date(n.dueAt).getTime()+1000).toISOString()},
    {...n,kind:"REPORT",phase:"EMAIL"}])assert.equal((await callback(changed as JobNotification)).status,409);
  assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("Native concurrent HTTP replays preserve one provider call and one budget reservation",options,async()=>{
  await initial();const n=await emit(),entered=gate(),release=gate();onBrevo=async()=>{entered.open();await release.wait;};
  const raw=JSON.stringify(n),signature=signQstash(raw),pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  const first=callback(n,signature);try{await entered.wait;const duplicates=await Promise.all(Array.from({length:5},()=>callback(n,signature,{"upstash-message-id":randomUUID()})));
    assert.ok(duplicates.every(r=>r.status===503||r.status===200));assert.equal(calls.length,1);
  }finally{release.open();assert.equal((await first).status,200);}
  for(let i=0;i<3;i++)assert.equal((await callback(n,signature)).status,200);
  assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
  console.log("3D callback concurrency",JSON.stringify({pids:pids.map(r=>r[0].pid),providerCalls:calls.length,reservations:await db.emailBudgetReservation.count()}));
});

test("QStash unavailable before acceptance preserves persistent pending intent and can resume",options,async()=>{
  await initial();publishMode="reject";const r=await new JobPublications(db).publishBatch(publisher());assert.equal(r.deferred,1);assert.equal(messages.length,0);
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);
  publishMode="accept";const n=await emit();assert.equal((await callback(n)).status,200);assert.equal(calls.length,1);
});

test("QStash accepted publication with response loss preserves UUID across duplicate authenticated deliveries",options,async()=>{
  await initial();publishMode="lost";await new JobPublications(db).publishBatch(publisher());
  await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);
  publishMode="accept";await emit();assert.equal(messages.length,2);assert.equal(messages[0].notificationId,messages[1].notificationId);
  await Promise.all(messages.map(n=>callback(n)));assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Unknown Brevo response is acknowledged as UNCERTAIN, never as delivery or permission to resend",options,async()=>{
  const f=await initial(),n=await emit();brevoMode="lost";const r=await callback(n);assert.equal(r.status,200);assert.equal(r.body.disposition,"UNCERTAIN");
  brevoMode="accept";await Promise.all(Array.from({length:8},()=>callback(n)));assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
  assert.equal((await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:f.job.id}})).status,"UNCERTAIN");
});

test("Freshly signed late callback cannot deliver an expired OTP",options,async()=>{
  const f=await initial(),n=await emit();
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '20 minutes',"expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes' WHERE id=$1::uuid`,f.job.id);
  const r=await callback(n);assert.equal(r.status,200);assert.equal(r.body.disposition,"EXPIRED");assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
});

test("An old activation cannot recover an expired lease instead of its newly registered activation",options,async()=>{
  const f=await initial(),n=await emit();await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET status='UNCERTAIN',attempts=1,"attemptToken"=$2::uuid,"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 minutes',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 minutes' WHERE id=$1::uuid`,f.job.id,randomUUID());
  assert.equal((await callback(n)).body.disposition,"BUSY");assert.equal(calls.length,0);
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second',"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1::uuid`,f.job.id);
  await new JobPublications(db).reconcile();assert.equal((await callback(n)).body.disposition,"OBSOLETE");
  const next=await emit();assert.notEqual(next.notificationId,n.notificationId);assert.equal((await callback(next)).body.disposition,"COMPLETE");assert.equal(calls.length,1);
});

test("Deleted and consumed jobs receive safe no-op acknowledgements without participant recreation",options,async()=>{
  const a=await initial(),b=await initial();await emit();const [na,nb]=[messages.find(n=>n.jobId===a.job.id)!,messages.find(n=>n.jobId===b.job.id)!];
  await db.emailOtpChallenge.delete({where:{id:a.job.challengeId}});await db.emailOtpChallenge.update({where:{id:b.job.challengeId},data:{consumedAt:new Date()}});
  assert.equal((await callback(na)).body.disposition,"MISSING");assert.equal((await callback(nb)).body.disposition,"OBSOLETE");assert.equal(calls.length,0);assert.equal(await db.adaptiveInterview.count(),0);
});

for(const language of ["fr","ar"] as const)test(`Authenticated REPORT/EMAIL callback generates the real ${language} PDF and sends once`,options,async()=>{
  const job=await report(language),n=await emit();assert.equal(n.kind,"REPORT");assert.equal(n.phase,"EMAIL");assert.equal(n.jobId,job.id);
  assert.equal((await callback(n)).body.disposition,"COMPLETE");assert.equal((await callback(n)).status,200);assert.equal(calls.length,1);
  assert.equal(Buffer.from(calls[0].attachment[0].content,"base64").subarray(0,5).toString(),"%PDF-");assert.match(calls[0].htmlContent,new RegExp(`lang="${language}"`));
});

test("Signed independent callbacks competing for last global Brevo credit cannot overspend",options,async()=>{
  Object.assign(process.env,{EMAIL_ACCOUNT_DAILY_LIMIT:"1",EMAIL_APP_DAILY_LIMIT:"1"});await initial();await initial();await emit();
  const results=await Promise.all(messages.map(n=>callback(n)));assert.ok(results.every(r=>r.status===200));assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Persistent 429 circuit defers callbacks without being bypassed by signed redelivery",options,async()=>{
  await initial();await initial();await emit();brevoMode="rate";assert.equal((await callback(messages[0])).body.disposition,"DEFERRED");
  brevoMode="accept";assert.equal((await callback(messages[1])).body.disposition,"DEFERRED");assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});

test("Callback does not accept a Next.js proof or production activation in the simulated release",options,async()=>{
  await initial();const n=await emit(),raw=JSON.stringify(n);
  const r=await nativeFetch(base+"/api/internal/jobs/qstash",{method:"POST",headers:{"content-type":"application/json","x-skillquest-proxy-proof":"v1.browser-forged"},body:raw});assert.equal(r.status,401);
  Object.assign(process.env,{NODE_ENV:"production"});try{assert.equal((await callback(n)).status,503);}finally{Object.assign(process.env,{NODE_ENV:"test"});}
  assert.equal(calls.length,0);
});
