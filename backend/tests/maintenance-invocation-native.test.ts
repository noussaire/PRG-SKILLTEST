import {test,before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import express from "express";
import type {Server} from "node:http";
import type {PrismaClient} from "@prisma/client";
import {connectLot4NativeDatabase} from "./helpers/native-postgres.js";
import {MaintenanceInvocations} from "../src/services/maintenance-invocation.service.js";
import {runMaintenance,type MaintenanceResult} from "../src/services/maintenance.service.js";
import {MaintenanceControl} from "../src/services/maintenance-control.js";
import {maintenanceRouter,MAINTENANCE_PREFIX as prefix} from "../src/routes/maintenance.routes.js";
const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:60000};
const secret=Buffer.alloc(32,91).toString("base64url"),h="c".repeat(64),nativeFetch=globalThis.fetch.bind(globalThis);
let db:PrismaClient,other:PrismaClient,server:Server,base:string,entry:typeof import("../src/services/participant-email.service.js").startEmailVerifiedParticipant;
before(async()=>{
  if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:"maintenance4b-synthetic-pepper-0123456789abcdef",DOTENV_CONFIG_PATH:resolve("output/maintenance-step4b-20261031/nonexistent.env")});
  ({prisma:db}=await import("../src/db/prisma.js"));({startEmailVerifiedParticipant:entry}=await import("../src/services/participant-email.service.js"));
  const {app}=await import("../src/app.js");server=app.listen(0,"127.0.0.1");await once(server,"listening");const a=server.address();assert.ok(a&&typeof a!=="string");base=`http://127.0.0.1:${a.port}`;
});
beforeEach(async t=>{
  if(options.skip)return;
  Object.assign(process.env,{SKILLQUEST_MAINTENANCE_ENABLED:"1",SKILLQUEST_MAINTENANCE_SECRET:secret,BREVO_API_KEY:"synthetic-no-network",BREVO_SENDER_EMAIL:"sender@example.test",GROQ_API_KEY:"synthetic-no-network",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300"});
  delete process.env.OTP_ENCRYPTION_KEYS;
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{const u=new URL(String(input));if(u.protocol==="http:"&&u.hostname==="127.0.0.1")return nativeFetch(input,init);throw Error("ALL_PROVIDER_NETWORK_FORBIDDEN")});
  await db.$executeRawUnsafe(`TRUNCATE "MaintenanceLease","MaintenanceRun","MaintenanceTask","JobPublicationIntent","ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge","EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async()=>{if(options.skip)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await db.$disconnect();await other.$disconnect()});
const headers=(id=randomUUID())=>({Authorization:`Bearer ${secret}`,"X-Skillquest-Maintenance-Id":id});
const call=(task="cleanup",id=randomUUID(),origin=base)=>fetch(origin+prefix+"/"+task,{headers:headers(id)});
async function count(table:string){return (await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${table}"`))[0].n as number}
async function runs(){return db.$queryRawUnsafe<any[]>(`SELECT * FROM "MaintenanceRun" ORDER BY "startedAt",id`)}
async function lease(){return (await db.$queryRawUnsafe<any[]>(`SELECT * FROM "MaintenanceLease"`))[0]}
async function nonce(){const id=randomUUID();await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") VALUES ($1::uuid,(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute')`,id);return id}
async function initial(){const r=await entry({fullName:"Synthetic HTTP maintenance",email:randomUUID()+"@example.test",language:"fr",emailReport:false});assert.equal(r.status,409);return db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:r.body.challengeId as string}})}
function gate(){let open!:()=>void;const wait=new Promise<void>(r=>open=r);return {open,wait}}
async function isolated(execute:Parameters<typeof maintenanceRouter>[0],work:(base:string)=>Promise<void>){const app=express();app.use(prefix,maintenanceRouter(execute));const s=app.listen(0,"127.0.0.1");await once(s,"listening");const a=s.address();assert.ok(a&&typeof a!=="string");try{await work(`http://127.0.0.1:${a.port}`)}finally{s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}}
const empty:MaintenanceResult={stop:"IDLE",batches:0,rows:0,elapsedMs:0,stage:null,changed:{},oldestUnpublishedDueLagSeconds:0};

test("Authenticated real app endpoint commits bounded cleanup and technical-only run metadata",options,async()=>{
  await nonce();const id=randomUUID(),r=await call("cleanup",id);assert.equal(r.status,200);const result=await r.json() as MaintenanceResult;assert.equal(result.rows,1);assert.equal(await count("ProxyRequestNonce"),0);
  const [run]=await runs();assert.equal(run.id,id);assert.equal(run.state,"COMPLETED");assert.equal((await lease()).attemptToken,null);
  const text=JSON.stringify(result);assert.ok(!text.includes(secret));assert.ok(!text.includes(run.attemptToken));assert.ok(!text.includes("example.test"));
});
test("Disabled and unauthenticated callbacks touch no maintenance table even during SQL outage",options,async()=>{
  await db.$executeRawUnsafe(`ALTER TABLE "MaintenanceLease" RENAME TO "MaintenanceLease_held"`);
  try{delete process.env.SKILLQUEST_MAINTENANCE_ENABLED;assert.equal((await call()).status,503);process.env.SKILLQUEST_MAINTENANCE_ENABLED="1";
    assert.equal((await fetch(base+prefix+"/cleanup",{headers:{"User-Agent":"vercel-cron/1.0","X-Forwarded-For":"127.0.0.1"}})).status,401);
    const r=await call();assert.equal(r.status,500);assert.ok(!(await r.text()).includes("relation"));
  }finally{await db.$executeRawUnsafe(`ALTER TABLE "MaintenanceLease_held" RENAME TO "MaintenanceLease"`)}
  assert.equal(await count("MaintenanceRun"),0);
});
test("Lost HTTP acknowledgement and same UUID replay never execute a second batch",options,async()=>{
  await nonce();const id=randomUUID();assert.equal((await call("cleanup",id)).status,200);await nonce();const replay=await call("cleanup",id);assert.equal(replay.status,409);
  assert.equal((await replay.json() as any).code,"MAINTENANCE_REPLAY");assert.equal(await count("ProxyRequestNonce"),1);assert.equal(await count("MaintenanceRun"),1);
});
test("Replay stays rejected after cooldown and across another fixed task",options,async()=>{
  const id=randomUUID();assert.equal((await call("cleanup",id)).status,200);await db.$executeRawUnsafe(`UPDATE "MaintenanceTask" SET "nextAllowedAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  assert.equal((await call("sessions",id)).status,409);assert.equal((await call("cleanup",id)).status,409);assert.equal(await count("MaintenanceRun"),1);
});
test("Different invocation UUID cannot bypass the persistent task cooldown",options,async()=>{
  assert.equal((await call()).status,200);const r=await call();assert.equal(r.status,429);assert.ok(Number(r.headers.get("retry-after"))>0);assert.equal(await count("MaintenanceRun"),1);
  assert.equal((await call("sessions")).status,200);assert.equal(await count("MaintenanceRun"),2);
});
test("Independent HTTP workers cannot overlap, even across different task routes",options,async()=>{
  await nonce();const entered=gate(),release=gate();let started=0;
  const a=new MaintenanceInvocations(db,async(...args)=>{started++;entered.open();await release.wait;return runMaintenance(...args)}),b=new MaintenanceInvocations(other);
  const pids=await Promise.all([db.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<any[]>("SELECT pg_backend_pid() AS pid")]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  await isolated((task,id,signal)=>(task==="cleanup"?a:b).run(task,id,signal),async origin=>{
    const first=call("cleanup",randomUUID(),origin);await entered.wait;try{const second=await call("sessions",randomUUID(),origin);assert.equal(second.status,409);assert.equal((await second.json() as any).code,"MAINTENANCE_BUSY");assert.equal(started,1)}finally{release.open()}
    assert.equal((await first).status,200);
  });assert.equal(await count("MaintenanceRun"),1);assert.equal(await count("ProxyRequestNonce"),0);console.log("4B HTTP concurrency",JSON.stringify({pids:pids.map(p=>p[0].pid),runs:1,providerCalls:0}));
});
test("Expired lease replacement fences the old worker before its next SQL batch and finalization",options,async()=>{
  await nonce();const enterA=gate(),releaseA=gate(),enterB=gate(),releaseB=gate(),idA=randomUUID(),idB=randomUUID();
  const a=new MaintenanceInvocations(db,async(...args)=>{enterA.open();await releaseA.wait;return runMaintenance(...args)});
  const b=new MaintenanceInvocations(other,async(...args)=>{enterB.open();await releaseB.wait;return runMaintenance(...args)});
  const first=a.run("cleanup",idA);await enterA.wait;const oldToken=(await lease()).attemptToken;
  await other.$executeRawUnsafe(`UPDATE "MaintenanceLease" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  const second=b.run("sessions",idB);await enterB.wait;
  try{releaseA.open();await assert.rejects(first,/LEASE_LOST/);assert.equal((await lease()).runId,idB);assert.notEqual((await lease()).attemptToken,oldToken);assert.equal(await count("ProxyRequestNonce"),1)}finally{releaseB.open();await second}
  const states=await runs();assert.equal(states.find(r=>r.id===idA).state,"INTERRUPTED");assert.equal(states.find(r=>r.id===idB).state,"COMPLETED");
  assert.equal((await call("cleanup",idA)).status,409);assert.equal((await call()).status,200);
});
test("Fence expiration inside a transaction rolls back its earlier deletion",options,async()=>{
  await nonce();const service=new MaintenanceInvocations(db,async(client,_opts,fence)=>{
    await assert.rejects(new MaintenanceControl(1000,500,undefined,fence).transaction(client,async tx=>{
      await tx.$executeRawUnsafe(`DELETE FROM "ProxyRequestNonce"`);await tx.$executeRawUnsafe(`UPDATE "MaintenanceLease" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
    }),/LEASE_LOST/);return empty;
  });await service.run("cleanup",randomUUID());assert.equal(await count("ProxyRequestNonce"),1);assert.equal((await runs())[0].state,"COMPLETED");
});
test("Admission SQL failure atomically rolls back run, lease and task allocation",options,async()=>{
  await db.$executeRawUnsafe(`CREATE FUNCTION test_fail_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SYNTHETIC_ADMISSION_FAILURE'; END$$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_maintenance BEFORE INSERT ON "MaintenanceRun" FOR EACH ROW EXECUTE FUNCTION test_fail_maintenance()`);
  try{assert.equal((await call()).status,500);assert.equal(await count("MaintenanceRun"),0);assert.equal(await count("MaintenanceLease"),0);assert.equal(await count("MaintenanceTask"),0)}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER test_fail_maintenance ON "MaintenanceRun"`);await db.$executeRawUnsafe(`DROP FUNCTION test_fail_maintenance()`)}
  assert.equal((await call()).status,200);
});
test("Failed and partial invocations persist their result, release only their own lease, and return 503",options,async()=>{
  for(const stop of ["FAILED","DEADLINE","ABORTED"] as const){await db.$executeRawUnsafe(`TRUNCATE "MaintenanceLease","MaintenanceRun","MaintenanceTask" CASCADE`);
    const service=new MaintenanceInvocations(db,async()=>({...empty,stop}));await isolated((task,id,signal)=>service.run(task,id,signal),async origin=>{assert.equal((await call("cleanup",randomUUID(),origin)).status,503)});
    const [r]=await runs();assert.equal(r.state,stop==="FAILED"?"FAILED":"PARTIAL");assert.equal(r.stopCode,stop);assert.equal((await lease()).attemptToken,null);
  }
});
test("Unexpected worker failure cannot expose its details or leave an immediately reusable lease",options,async()=>{
  const service=new MaintenanceInvocations(db,async()=>{throw Error("secret-sensitive-error")});await isolated((task,id,signal)=>service.run(task,id,signal),async origin=>{
    const r=await call("cleanup",randomUUID(),origin);assert.equal(r.status,503);assert.ok(!(await r.text()).includes("sensitive"));assert.equal((await call("cleanup",randomUUID(),origin)).status,429)});
  assert.equal((await runs())[0].state,"FAILED");assert.equal((await lease()).attemptToken,null);
});
test("Client cancellation is propagated and partial committed batches remain resumable",options,async()=>{
  await nonce();const entered=gate(),cancelled=gate();const service=new MaintenanceInvocations(db,async(client,opts,fence)=>{
    const first=await runMaintenance(client,{...opts,stages:["nonces"],maxBatches:1,batchSize:1},fence);entered.open();
    await new Promise<void>(r=>{if(opts!.signal!.aborted)r();else opts!.signal!.addEventListener("abort",()=>r(),{once:true})});cancelled.open();return {...first,stop:"ABORTED"};
  });await isolated((task,id,signal)=>service.run(task,id,signal),async origin=>{const c=new AbortController();const pending=fetch(origin+prefix+"/cleanup",{headers:headers(),signal:c.signal});await entered.wait;c.abort();await assert.rejects(pending);await cancelled.wait;
    for(let n=0;n<100;n++){if((await runs())[0].state!=="RUNNING")break;await new Promise(r=>setTimeout(r,10))}assert.equal((await runs())[0].state,"PARTIAL")});
  assert.equal(await count("ProxyRequestNonce"),0);assert.equal((await lease()).attemptToken,null);
});
test("HTTP reconciliation keeps UNCERTAIN OTP reservations and never calls a provider",options,async()=>{
  const j=await initial();await db.$executeRawUnsafe(`INSERT INTO "EmailBudgetReservation" (id,"logicalKey",purpose,"budgetWindowStart","idempotencyKey","requestHash",status,"providerAttemptedAt","retrySafeUntil","expiresAt")
    VALUES ($1::uuid,$2,'OTP',date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC'),$2::uuid,$3,'UNCERTAIN',(clock_timestamp() AT TIME ZONE 'UTC')-interval '2 minutes',(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute',(clock_timestamp() AT TIME ZONE 'UTC')+interval '30 days')`,randomUUID(),j.id,h);
  await db.participantEmailDeliveryJob.update({where:{id:j.id},data:{status:"UNCERTAIN",leaseUntil:new Date(Date.now()-1000),attemptToken:randomUUID()}});
  const receipt=await db.emailBudgetReservation.findFirstOrThrow();assert.equal((await call("reconcile")).status,200);
  const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:j.id}});assert.equal(job.status,"UNCERTAIN");assert.equal(job.nextAttemptAt,null);assert.ok(job.encryptedPayload);
  assert.deepEqual(await db.emailBudgetReservation.findFirstOrThrow(),receipt);assert.equal(await db.adaptiveInterview.count(),0);
});
test("HTTP cleanup preserves active job, publication and reservation leases and receipts",options,async()=>{
  const j=await initial();await db.participantEmailDeliveryJob.update({where:{id:j.id},data:{expiresAt:new Date(Date.now()-1000),leaseUntil:new Date(Date.now()+60000),attemptToken:randomUUID()}});
  const saved=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:j.id}});assert.equal((await call()).status,200);assert.deepEqual(await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{id:j.id}}),saved);
});
test("Authenticated HTTP sessions route preserves administrative sessions",options,async()=>{
  const user=await db.user.create({data:{email:randomUUID()+"@example.test",role:"ADMIN"}}),a=await db.assessment.create({data:{title:"Synthetic",slug:randomUUID()}});
  const admin=await db.adminSession.create({data:{userId:user.id,tokenHash:h,expiresAt:new Date(Date.now()+60000)}});
  const session=await db.assessmentSession.create({data:{assessmentId:a.id,createdById:user.id,label:"Synthetic",codeHash:randomUUID().replaceAll("-","").padEnd(64,"0"),status:"SCHEDULED",opensAt:new Date(Date.now()-1000)}});
  assert.equal((await call("sessions")).status,200);assert.equal((await db.assessmentSession.findUniqueOrThrow({where:{id:session.id}})).status,"OPEN");assert.deepEqual(await db.adminSession.findUniqueOrThrow({where:{id:admin.id}}),admin);
});
test("HTTP callers cannot raise fixed server-side row, batch or SQL budgets",options,async()=>{
  await db.$executeRawUnsafe(`INSERT INTO "ProxyRequestNonce" (nonce,"expiresAt") SELECT gen_random_uuid(),(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute' FROM generate_series(1,1100)`);
  const id=randomUUID();assert.equal((await fetch(base+prefix+"/cleanup?maxRows=999999",{headers:headers(id)})).status,400);assert.equal(await count("MaintenanceRun"),0);
  const r=await call("cleanup",id);assert.equal(r.status,200);const body=await r.json() as MaintenanceResult;assert.ok(body.rows<=1000);assert.ok(body.batches<=4);assert.ok(body.elapsedMs<8000);assert.equal(await count("ProxyRequestNonce"),1100-body.rows);
});

for(const boundary of ["claimed","batch-committed"] as const)test(`Owned HTTP maintenance process killed after ${boundary} resumes with a fresh token and rejects replay`,options,async()=>{
  await nonce();const id=randomUUID(),child=spawn(process.execPath,["--loader",pathToFileURL(resolve("output/lot3-rollback-6f44523a33/test-loader.mjs")).href,resolve("backend/tests/helpers/maintenance-invocation-crash.ts")],{
    windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:"test",LOT4_NATIVE_CONTEXT:process.env.LOT4_NATIVE_CONTEXT,
      DOTENV_CONFIG_PATH:resolve("output/maintenance-step4b-20261031/nonexistent.env"),MAINTENANCE_CRASH_BOUNDARY:boundary,MAINTENANCE_CRASH_ID:id},stdio:["ignore","pipe","pipe","ipc"]});
  const exited=once(child,"exit"),ready=new Promise<void>(r=>child.on("message",m=>{if((m as any).boundary===boundary)r()}));let logs="",timer:ReturnType<typeof setTimeout>|undefined;child.stderr!.on("data",v=>logs+=v);
  try{await Promise.race([ready,exited.then(()=>{throw Error(logs)}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Owned crash fixture timeout: "+logs)),10000)})]);child.kill();await exited}
  finally{if(timer)clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill();await exited}}
  assert.equal((await runs())[0].state,"RUNNING");assert.equal(await count("ProxyRequestNonce"),boundary==="claimed"?1:0);assert.equal((await call("cleanup",id)).status,409);
  await db.$executeRawUnsafe(`UPDATE "MaintenanceLease" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second'`);
  assert.equal((await call()).status,200);assert.equal((await runs()).find(r=>r.id===id).state,"INTERRUPTED");assert.equal(await count("ProxyRequestNonce"),0);
  console.log("4B killed invocation",JSON.stringify({boundary,childPid:child.pid,recovered:true}));
});
