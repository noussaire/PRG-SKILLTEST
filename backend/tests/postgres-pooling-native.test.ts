import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {openSync,closeSync} from "node:fs";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {join} from "node:path";
import {PrismaClient,type Prisma} from "@prisma/client";
import {connectOwnedPooledDatabase} from "./helpers/pooled-postgres.js";
import {createPreparedInterview,advancePreparedInterview} from "../src/services/prepared-interview.service.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned PostgreSQL and REAL PgBouncer required",timeout:60000};
const pepper="pool5b-synthetic-pepper-0123456789abcdef",summary=JSON.stringify({fr:"Synthèse synthétique.",ar:"خلاصة تجريبية."});
const metrics:any={comparisons:[],failures:[],concurrency:[]};
let connection:Awaited<ReturnType<typeof connectOwnedPooledDatabase>>,db:PrismaClient,direct:PrismaClient;
let entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
let Queue:typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let processJob:typeof import("../src/services/job-processing.service.js").processJob;
let send:typeof import("../src/services/brevo.service.js").sendReportEmail;
let calls:any[],aiCalls:number,lost:boolean;
const extra:PrismaClient[]=[];
const gate=()=>{let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {wait,open}};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const client=(size=2,limit=2,wait=2,socket?:number,alias?:string)=>{const c=new PrismaClient({datasourceUrl:connection.makeUrl(size,limit,wait,socket,alias)});extra.push(c);return c};
const rows=()=>db.$queryRawUnsafe<{id:number}[]>(`SELECT id FROM "PoolProbe" ORDER BY id`);
before(async()=>{
 if(options.skip)return;
 connection=await connectOwnedPooledDatabase();direct=connection.direct;
 Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,DOTENV_CONFIG_PATH:join(connection.context.root,"nonexistent.env")});
 ({prisma:db}=await import("../src/db/prisma.js"));
 ({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
 ({OtpDeliveryQueue:Queue}=await import("../src/services/otp-delivery.service.js"));
 ({processJob}=await import("../src/services/job-processing.service.js"));
 ({sendReportEmail:send}=await import("../src/services/brevo.service.js"));
 await direct.$executeRawUnsafe(`CREATE TABLE "PoolProbe" (id integer PRIMARY KEY)`);
});
beforeEach(async t=>{
 if(options.skip)return;calls=[];aiCalls=0;lost=false;
 // On Linux x64 Node 24, enable serverless Chromium for the two PDF-report tests.
 // resolvePdfBrowser() already refuses serverless on non-Linux/non-Node-24, so this
 // conditional has no effect on Windows and does not change any business logic.
 Object.assign(process.env,{JOIN_CODE_PEPPER:pepper,BREVO_API_KEY:"synthetic-only",BREVO_SENDER_EMAIL:"sender@example.test",GROQ_API_KEY:"synthetic-only",
 EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300",OTP_GLOBAL_DAILY_SENDS:"120",OTP_NETWORK_DAILY_SENDS:"100",OTP_IDENTITY_DAILY_SENDS:"5",
 ...(process.platform==="linux"&&process.arch==="x64"&&process.versions.node.split(".")[0]==="24"?{REPORT_PDF_BROWSER_MODE:"serverless"}:{})});
 delete process.env.OTP_ENCRYPTION_KEYS;delete process.env.OTP_ENCRYPTION_ACTIVE_KEY_ID;delete process.env.OTP_PAYLOAD_WRITE_VERSION;
 (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  if(String(input)==="https://api.brevo.com/v3/smtp/email"){const m=JSON.parse(String(init?.body));assert.match(m.to[0].email,/@example\.test$/);calls.push(m);if(lost)throw Error("SIMULATED_RESPONSE_LOST");return Response.json({messageId:"synthetic"},{status:201})}
  if(String(input)==="https://api.groq.com/openai/v1/chat/completions"){aiCalls++;return Response.json({choices:[{finish_reason:"stop",message:{content:summary}}]})}
  throw Error("ALL_EXTERNAL_NETWORK_FORBIDDEN");
 });
 await direct.$executeRawUnsafe(`TRUNCATE "PoolProbe","MaintenanceLease","MaintenanceRun","MaintenanceTask","JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState","AdaptiveDailyUsage" CASCADE`);
});
after(async()=>{if(options.skip)return;await Promise.allSettled(extra.map(c=>c.$disconnect()));await db.$disconnect();await connection.client.$disconnect();await direct.$disconnect();await writeFile(join(connection.context.root,"measurements.json"),JSON.stringify(metrics,null,2))});

test("Real transaction pool preserves owned database identity and separate application/direct destinations",options,async()=>{
 assert.notEqual(new URL(process.env.DATABASE_URL!).port,new URL(process.env.DIRECT_URL!).port);
 assert.equal(connection.pooling.poolMode,"transaction");assert.equal(connection.pooling.version,"1.26.1");
 const [r]=await db.$queryRawUnsafe<{port:number}[]>(`SELECT inet_server_port() AS port`);assert.equal(r.port,connection.context.port);
 const saved=process.env.DIRECT_URL;process.env.DIRECT_URL="postgresql://synthetic@127.0.0.1:9/never_connect";
 const runtime=new PrismaClient();
 try{const [physical]=await runtime.$queryRawUnsafe<{port:number}[]>(`SELECT inet_server_port() AS port`);assert.equal(physical.port,connection.context.port)}
 finally{await runtime.$disconnect();process.env.DIRECT_URL=saved}
});
test("Interactive transaction holds its physical backend through SAVEPOINT and ROLLBACK TO after SQL failure",options,async()=>{
 await db.$transaction(async tx=>{
  const [first]=await tx.$queryRawUnsafe<{pid:number}[]>(`SELECT pg_backend_pid() AS pid`);
  await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (1)`);await tx.$executeRawUnsafe("SAVEPOINT qualification");
  await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (2)`);await assert.rejects(tx.$queryRawUnsafe("SELECT 1/0"));
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qualification");await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (3)`);
  const [last]=await tx.$queryRawUnsafe<{pid:number}[]>(`SELECT pg_backend_pid() AS pid`);assert.equal(first.pid,last.pid);
 });assert.deepEqual((await rows()).map(r=>r.id),[1,3]);
});
test("SET LOCAL resets after commit and rollback when different Prisma clients reuse one physical backend",options,async()=>{
 const a=client(1,1),b=client(1,1);let pid=0;
 await a.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL lock_timeout='123ms'");const [r]=await tx.$queryRawUnsafe<{pid:number;v:string}[]>(`SELECT pg_backend_pid() AS pid,current_setting('lock_timeout') AS v`);pid=r.pid;assert.equal(r.v,"123ms")});
 const [next]=await b.$queryRawUnsafe<{pid:number;v:string}[]>(`SELECT pg_backend_pid() AS pid,current_setting('lock_timeout') AS v`);assert.equal(next.pid,pid);assert.equal(next.v,"0");
 await assert.rejects(a.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL lock_timeout='456ms'");throw Error("ROLLBACK")}),/ROLLBACK/);
 const [last]=await b.$queryRawUnsafe<{v:string}[]>(`SELECT current_setting('lock_timeout') AS v`);assert.equal(last.v,"0");
});
test("Independent transactions prove concurrent backends and FOR UPDATE SKIP LOCKED disjoint claims",options,async()=>{
 await db.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (1),(2)`);const a=client(4,1),b=client(4,1),entered=gate(),release=gate();let pid=0;
 const holding=a.$transaction(async tx=>{pid=(await tx.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid"))[0].pid;
  assert.equal((await tx.$queryRawUnsafe<{id:number}[]>(`SELECT id FROM "PoolProbe" ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`))[0].id,1);entered.open();await release.wait},{timeout:10000});
 await entered.wait;try{await b.$transaction(async tx=>{const other=(await tx.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid"))[0].pid;assert.notEqual(pid,other);
  assert.equal((await tx.$queryRawUnsafe<{id:number}[]>(`SELECT id FROM "PoolProbe" ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`))[0].id,2);metrics.concurrency.push({case:"skip-locked",pids:[pid,other]})})}finally{release.open();await holding}
});
test("SQL statement and row-lock timeouts roll back writes and leave pooled connections reusable",options,async()=>{
 await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (7)`);await tx.$executeRawUnsafe("SET LOCAL statement_timeout='100ms'");await tx.$queryRawUnsafe("SELECT 1 FROM pg_sleep(0.4)")}));
 assert.deepEqual(await rows(),[]);await db.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (1)`);
 const a=client(4,1),b=client(4,1),entered=gate(),release=gate();
 const hold=a.$transaction(async tx=>{await tx.$queryRawUnsafe(`SELECT * FROM "PoolProbe" FOR UPDATE`);entered.open();await release.wait},{timeout:10000});await entered.wait;
 try{await assert.rejects(b.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");await tx.$executeRawUnsafe(`DELETE FROM "PoolProbe"`)}))}finally{release.open();await hold}
 assert.deepEqual((await rows()).map(r=>r.id),[1]);
});
test("Prisma client saturation yields P2024 and interactive maxWait fails without entering callback",options,async()=>{
 const a=client(4,1,1),entered=gate(),release=gate();const hold=a.$transaction(async()=>{entered.open();await release.wait},{timeout:10000});await entered.wait;
 try{const start=performance.now();await assert.rejects(a.$queryRawUnsafe("SELECT 1"),(e:any)=>e.code==="P2024");const ms=performance.now()-start;assert.ok(ms>=800&&ms<4000);metrics.failures.push({case:"client-pool-timeout",ms,code:"P2024"});
  let enteredCallback=false;await assert.rejects(a.$transaction(async()=>{enteredCallback=true},{maxWait:100,timeout:1000}));assert.equal(enteredCallback,false);
 }finally{release.open();await hold}
 assert.equal((await a.$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);
});
test("Interactive transaction deadline rolls back instead of committing after its callback resumes",options,async()=>{
 await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (9)`);await sleep(250)},{timeout:100}));assert.deepEqual(await rows(),[]);
});
test("PgBouncer server saturation reaches real query_wait_timeout and then recovers",options,async()=>{
 const a=client(1,1),b=client(1,1),entered=gate(),release=gate();const hold=a.$transaction(async()=>{entered.open();await release.wait},{timeout:10000});await entered.wait;
 try{const start=performance.now();await assert.rejects(b.$queryRawUnsafe("SELECT 1"));const ms=performance.now()-start;assert.ok(ms>=2500&&ms<7000);metrics.failures.push({case:"pooler-query-wait",ms})}
 finally{release.open();await hold}assert.equal((await client(1,1).$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);
});
test("A warm client bounds a 120-second pooler queue with its socket deadline",options,async()=>{
 const a=client(1,1,2,undefined,"wait120"),b=client(1,1,2,1,"wait120"),entered=gate(),release=gate();
 await b.$queryRawUnsafe("SELECT 1"); // Separate query timeout from connection bootstrap.
 const hold=a.$transaction(async()=>{entered.open();await release.wait},{timeout:10000});await entered.wait;
 const watchdog=setTimeout(release.open,4000);
 try{const start=performance.now();await assert.rejects(b.$queryRawUnsafe("SELECT 1"));const ms=performance.now()-start;assert.ok(ms>=800&&ms<4000);metrics.failures.push({case:"socket-deadline-vs-120s-queue",ms})}
 finally{clearTimeout(watchdog);release.open();await hold}
});
test("Characterize cold connection bootstrap separately from the warm query socket deadline",options,async()=>{
 const a=client(1,1,2,undefined,"wait120"),b=client(1,1,2,1,"wait120"),entered=gate(),release=gate();
 const hold=a.$transaction(async()=>{entered.open();await release.wait},{timeout:10000});await entered.wait;
 const at=performance.now();let settled=false;
 const pending=b.$queryRawUnsafe("SELECT 1").then(()=>{settled=true;return "completed"},()=>{settled=true;return "rejected"});
 try{await sleep(1400);const settledWithin1400ms=settled;await sleep(4800);const settledWithin6200ms=settled;release.open();const outcome=await pending;
  metrics.failures.push({case:"cold-bootstrap",socketTimeoutSeconds:1,connectTimeoutSeconds:5,settledWithin1400ms,settledWithin6200ms,outcome,ms:performance.now()-at});
  // Reproduce the observed limitation explicitly; this is not a passed assertion
  // that a cold call is safely bounded by socket_timeout.
  assert.equal(settledWithin1400ms,false);assert.equal(outcome,"completed");assert.equal((await direct.$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);
 }finally{release.open();await hold}
});
test("A caller deadline alone does not cancel a cold queued autocommit write",options,async()=>{
 const a=client(1,1,2,undefined,"wait120"),b=client(1,1,2,1,"wait120"),entered=gate(),release=gate();
 const hold=a.$transaction(async()=>{entered.open();await release.wait},{timeout:10000});await entered.wait;
 const write=b.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (42)`);
 try{assert.equal(await Promise.race([write.then(()=>"committed"),sleep(200).then(()=>"caller-deadline")]),"caller-deadline");
  assert.deepEqual(await rows(),[]);release.open();assert.equal(await write,1);assert.deepEqual((await rows()).map(r=>r.id),[42]);
  metrics.failures.push({case:"caller-deadline-is-not-cancellation",lateCommitObserved:true});
 }finally{release.open();await hold}
});
test("Pooler client-connection cap rejects excess clients without damaging existing sessions",options,async()=>{
 const a=client(1,1,2,undefined,"limited"),b=client(1,1,2,undefined,"limited"),c=client(1,1,2,undefined,"limited");
 await a.$queryRawUnsafe("SELECT 1");await b.$queryRawUnsafe("SELECT 1");await assert.rejects(c.$queryRawUnsafe("SELECT 1"));
 assert.equal((await a.$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);await b.$disconnect();await c.$disconnect();
 assert.equal((await client(1,1,2,undefined,"limited").$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);
});
test("Terminated physical backend aborts its transaction and a new pooled connection recovers",options,async()=>{
 let killed=0;await assert.rejects(client(4,1).$transaction(async tx=>{killed=(await tx.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid"))[0].pid;
  await tx.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (31)`);const [r]=await direct.$queryRawUnsafe<{stopped:boolean}[]>("SELECT pg_terminate_backend($1) AS stopped",killed);assert.equal(r.stopped,true);await tx.$queryRawUnsafe("SELECT 1")
 }));assert.deepEqual(await rows(),[]);assert.equal((await client(4,1).$queryRawUnsafe<any[]>("SELECT 1 AS n"))[0].n,1);metrics.failures.push({case:"backend-terminated",pid:killed,rolledBack:true});
});
test("Compare actual Prisma pool sizes 1/2/4 against physical PgBouncer pools 1/2/4",options,async()=>{
 for(const serverPool of [1,2,4])for(const prismaPool of [1,2,4]){
  const c=client(serverPool,prismaPool,10),latencies:number[]=[],pids=new Set<number>();await c.$connect();const started=performance.now();
  for(let round=0;round<3;round++)await Promise.all(Array.from({length:12},async()=>{const at=performance.now();await c.$transaction(async tx=>{const [r]=await tx.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid FROM pg_sleep(0.03)");pids.add(r.pid)});latencies.push(performance.now()-at)}));
  // Distinct backends over time are not the instantaneous Prisma pool size:
  // a transaction pool may assign a different backend to a later transaction.
  latencies.sort((a,b)=>a-b);assert.ok(pids.size<=serverPool);
  metrics.comparisons.push({serverPool,prismaPool,rounds:3,transactions:36,wallMs:performance.now()-started,p50Ms:latencies[17],p95Ms:latencies[34],physicalBackends:pids.size});await c.$disconnect();
 }assert.equal(metrics.comparisons.length,9);console.log("5B real pooling matrix",JSON.stringify(metrics.comparisons));
});

async function otp(kind:"OTP_INITIAL"|"OTP_RETAKE"){
 const p={fullName:"Synthetic pooled",email:randomUUID()+"@example.test",language:"fr" as const,emailReport:false};let ownerId:string;
 if(kind==="OTP_INITIAL"){const r=await entry(p);assert.equal(r.status,409);ownerId=r.body.challengeId as string}
 else{const row=await db.adaptiveInterview.create({data:{displayName:p.fullName,email:p.email,emailIdentity:p.email,tokenHash:randomUUID().replaceAll("-","").padEnd(64,"0"),state:{},lastTestStartedAt:new Date(Date.now()-31*86400000),expiresAt:new Date(Date.now()+86400000)}});ownerId=row.id;
  await new Queue(db).enqueue({interviewId:row.id,lastTestStartedAt:row.lastTestStartedAt,codeHash:createHmac("sha256",pepper).update(`retake:${row.id}:654321`).digest("hex"),payload:{recipient:p.email,recipientName:p.fullName,subject:"Synthetic",htmlContent:"<p>654321</p>"}})}
 const table=kind==="OTP_INITIAL"?"ParticipantEmailDeliveryJob":"OtpDeliveryJob";
 const [job]=await db.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}" WHERE "${kind==="OTP_INITIAL"?"challengeId":"interviewId"}"=$1::uuid`,ownerId);return {p,ownerId,job,table,request:{kind,jobId:job.id,phase:"DELIVER"}};
}
for(const kind of ["OTP_INITIAL","OTP_RETAKE"] as const)test(`Real pooled concurrent ${kind} reserves and sends once, then verifies the OTP`,options,async()=>{
 const f=await otp(kind),a=client(4,1),b=client(4,1);await Promise.all([new Queue(a,send).processJob(kind,f.job.id),new Queue(b,send).processJob(kind,f.job.id)]);await processJob(f.request);
 assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT status FROM "${f.table}" WHERE id=$1::uuid`,f.job.id))[0].status,"ACCEPTED");
 const code=kind==="OTP_RETAKE"?"654321":calls[0].htmlContent.match(/>(\d{6})<\//)![1];
 const result=kind==="OTP_INITIAL"?await entry({...f.p,challengeId:f.ownerId,verificationCode:code}):await (await import("../src/services/participant-retake.service.js")).startParticipantTest({...f.p,verificationCode:code});assert.equal(result.status,201);
});
test("Real pooled workers compete for the last Brevo credit without overspending",options,async()=>{
 process.env.EMAIL_ACCOUNT_DAILY_LIMIT="1";process.env.EMAIL_APP_DAILY_LIMIT="1";const first=await otp("OTP_INITIAL"),second=await otp("OTP_INITIAL");
 await Promise.all([new Queue(client(4,1),send).processJob("OTP_INITIAL",first.job.id),new Queue(client(4,1),send).processJob("OTP_INITIAL",second.job.id)]);
 assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
});
test("UNCERTAIN OTP survives pooled reconciliation and duplicate notifications without another send",options,async()=>{
 const f=await otp("OTP_INITIAL");lost=true;await processJob(f.request);assert.equal(calls.length,1);lost=false;
 await db.$executeRawUnsafe(`UPDATE "ParticipantEmailDeliveryJob" SET "leaseUntil"=CASE WHEN "attemptToken" IS NOT NULL THEN (clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' ELSE NULL END,"nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=$1::uuid`,f.job.id);
 const {runMaintenance}=await import("../src/services/maintenance.service.js");await runMaintenance(db,{stages:["otpInitial"],maxBatches:2});await Promise.all([processJob(f.request),processJob(f.request)]);
 assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count({where:{status:"UNCERTAIN"}}),1);
 assert.equal((await db.$queryRawUnsafe<any[]>(`SELECT status FROM "ParticipantEmailDeliveryJob" WHERE id=$1::uuid`,f.job.id))[0].status,"UNCERTAIN");
});
test("Concurrent publication leases are unique and a lost acknowledgement reuses its notification UUID",options,async()=>{
 await Promise.all([otp("OTP_INITIAL"),otp("OTP_INITIAL"),otp("OTP_INITIAL")]);
 const {JobPublications}=await import("../src/services/job-publication.service.js"),notifications:string[]=[];
 const publisher={publish:async(n:{notificationId:string})=>{notifications.push(n.notificationId)}};
 await Promise.all([new JobPublications(client(4,1)).publishBatch(publisher,3),new JobPublications(client(4,1)).publishBatch(publisher,3)]);
 assert.equal(notifications.length,3);assert.equal(new Set(notifications).size,3);assert.equal(calls.length,0);assert.equal(await db.emailBudgetReservation.count(),0);
 const f=await otp("OTP_INITIAL"),ids:string[]=[];await new JobPublications(db).publishBatch({publish:async n=>{ids.push(n.notificationId);throw Error("ACK_LOST")}},1);
 await db.$executeRawUnsafe(`UPDATE "JobPublicationIntent" SET "nextAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE "jobId"=$1::uuid`,f.job.id);
 await new JobPublications(db).publishBatch({publish:async n=>{ids.push(n.notificationId)}},1);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 await processJob(f.request);await processJob(f.request);assert.equal(calls.length,1);
});
test("Maintenance leases and replay receipts fence overlapping pooled invocations",options,async()=>{
 const {MaintenanceInvocations}=await import("../src/services/maintenance-invocation.service.js"),{runMaintenance}=await import("../src/services/maintenance.service.js");
 const entered=gate(),release=gate(),id=randomUUID();
 const first=new MaintenanceInvocations(client(4,1),async(c,o,f)=>{const result=await runMaintenance(c,{...o,stages:["nonces"]},f);entered.open();await release.wait;return result});
 const hold=first.run("cleanup",id);await entered.wait;try{await assert.rejects(new MaintenanceInvocations(client(4,1)).run("cleanup",id));await assert.rejects(new MaintenanceInvocations(client(4,1)).run("cleanup",randomUUID()))}finally{release.open();await hold}
 assert.equal(await db.$queryRawUnsafe<any[]>(`SELECT id FROM "MaintenanceRun"`).then(r=>r.length),1);assert.equal(calls.length,0);
});
test("Report creation and its publication intent commit together or both roll back through the pool",options,async()=>{
 const {enqueueReportInTransaction}=await import("../src/services/report-queue.service.js");let state=createPreparedInterview("fr");while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
 await assert.rejects(db.$transaction(async tx=>{const row=await tx.adaptiveInterview.create({data:{displayName:"Synthetic",tokenHash:randomUUID(),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});assert.ok(await enqueueReportInTransaction(tx,row.id));throw Error("BEFORE_COMMIT")}),/BEFORE_COMMIT/);
 assert.equal(await db.adaptiveReportJob.count(),0);assert.equal((await db.$queryRawUnsafe<{n:number}[]>(`SELECT count(*)::int AS n FROM "JobPublicationIntent"`))[0].n,0);
});
for(const language of ["fr","ar"] as const)test(`Concurrent pooled ${language} PDF report preparation sends and reserves once`,options,async()=>{
 let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
 const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic PDF",email:randomUUID()+"@example.test",reportEmailRequested:true,tokenHash:randomUUID(),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
 const job=await db.adaptiveReportJob.create({data:{interviewId:row.id,status:"COMPLETE",summary,emailStatus:"PENDING"}}),request={kind:"REPORT",jobId:job.id,phase:"EMAIL"};
 await Promise.all([processJob(request),processJob(request)]);await processJob(request);
 assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{id:job.id}})).emailStatus,"SENT");
 assert.equal(Buffer.from(calls[0].attachment[0].content,"base64").subarray(0,5).toString(),"%PDF-");assert.equal(aiCalls,0);
});
test("Actual owned PgBouncer interruption rolls back an active transaction and a restart preserves UNCERTAIN",{...options,timeout:90000},async()=>{
 const f=await otp("OTP_INITIAL");lost=true;await processJob(f.request);assert.equal(calls.length,1);lost=false;
 const context=JSON.parse(await readFile(process.env.LOT4_NATIVE_CONTEXT!,"utf8")) as {root:string;pooling:{pid:number;executable:string;config:string;port:number}};
 assert.equal(Number((await readFile(join(context.root,"pgbouncer.pid"),"utf8")).trim()),context.pooling.pid);
 const a=client(4,1),entered=gate(),release=gate();
 const tx=a.$transaction(async t=>{await t.$executeRawUnsafe(`INSERT INTO "PoolProbe" VALUES (43)`);entered.open();await release.wait;await t.$queryRawUnsafe("SELECT 1")},{timeout:10000});
 // Observe rejection immediately so a forced process loss cannot become an
 // unhandled rejection while the replacement process is being prepared.
 const outcome=tx.then(()=>"committed",()=>"rolled-back");await entered.wait;
 // SIGKILL cannot be caught or deferred: PgBouncer cannot perform a graceful
 // shutdown and flush pending transactions. On Windows, Node.js calls
 // TerminateProcess regardless of the signal value, so behaviour is identical.
 process.kill(context.pooling.pid,"SIGKILL");release.open();assert.equal(await outcome,"rolled-back");assert.deepEqual(await direct.$queryRawUnsafe(`SELECT id FROM "PoolProbe"`),[]);
 // On Windows (SIGTERM path), PgBouncer closes connections gracefully before
 // exiting; explicit disconnect flushes the pool state before the restart.
 // On Linux (SIGKILL path), the OS sends TCP RST to all pool connections
 // immediately. Calling $disconnect() here triggers Prisma's native engine
 // reconnect loop which can block for its entire internal timeout (minutes).
 // The losing side of Promise.race() does NOT cancel the underlying future,
 // so a raced $disconnect() would continue holding Prisma's state lock and
 // block any subsequent db operation including processJob below.
 // On Linux, skip the explicit disconnect: Prisma 5's resilient pool detects
 // and replaces dead connections automatically on the next operation.
 if(process.platform!=="linux"){await db.$disconnect();await connection.client.$disconnect();}
 const fd=openSync(join(context.root,"pooler-restart.log"),"w"),env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot};
 const child=spawn(context.pooling.executable,[context.pooling.config],{env,windowsHide:true,stdio:["ignore",fd,fd]});closeSync(fd);const ended=once(child,"exit");
 try{
  let ready=false;for(let n=0;n<40;n++){
   ready=await new Promise<boolean>(r=>{const s=net.connect({host:"127.0.0.1",port:context.pooling.port});s.once("connect",()=>{s.destroy();r(true)});s.once("error",()=>{s.destroy();r(false)})});
   if(ready)break;await sleep(100);
  }assert.equal(ready,true);assert.notEqual(child.pid,context.pooling.pid);
   // On Linux, PgBouncer was SIGKILLed. Now that the replacement is ready,
   // flush the client connection pool so Prisma connects cleanly to the
   // new instance instead of hitting dead sockets from the killed process.
   if(process.platform==="linux"){await db.$disconnect();await connection.client.$disconnect();}
  await processJob(f.request);assert.equal(calls.length,1);assert.equal(await db.emailBudgetReservation.count({where:{status:"UNCERTAIN"}}),1);
  metrics.failures.push({case:"actual-pooler-restart",oldPid:context.pooling.pid,newPid:child.pid,transactionRolledBack:true,uncertainPreserved:true});
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill(process.platform==="linux"?"SIGKILL":undefined);await ended}
});
