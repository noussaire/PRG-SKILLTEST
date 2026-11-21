import {test,before,after,beforeEach,afterEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {request,type Server} from "node:http";
import express from "express";
import {maintenanceRouter,MAINTENANCE_PREFIX as prefix} from "../src/routes/maintenance.routes.js";
import {MaintenanceInvocationError} from "../src/services/maintenance-invocation.service.js";
import {authenticateMaintenance} from "../src/security/maintenance-auth.js";
import type {MaintenanceResult} from "../src/services/maintenance.service.js";
const secret=Buffer.alloc(32,71).toString("base64url"),next=Buffer.alloc(32,72).toString("base64url");
const keys=["SKILLQUEST_MAINTENANCE_ENABLED","SKILLQUEST_MAINTENANCE_SECRET","JOIN_CODE_PEPPER","JOIN_CODE_PEPPER_PREVIOUS","SKILLQUEST_PROXY_HMAC_KEY","SKILLQUEST_EDGE_HMAC_KEY","QSTASH_CURRENT_SIGNING_KEY","QSTASH_NEXT_SIGNING_KEY","QSTASH_TOKEN","OTP_ENCRYPTION_KEYS","BREVO_API_KEY","GROQ_API_KEY"];
let saved:(string|undefined)[],server:Server,base:string,calls:any[],behavior:((signal:AbortSignal)=>Promise<MaintenanceResult>)|undefined;
const result=(stop:MaintenanceResult["stop"]="IDLE"):MaintenanceResult=>({stop,batches:1,rows:0,elapsedMs:1,stage:"nonces",changed:{nonces:0},oldestUnpublishedDueLagSeconds:0});
before(async()=>{const app=express();app.use(prefix,maintenanceRouter(async(task,id,signal)=>{calls.push({task,id});return behavior?behavior(signal):result()}));
  server=app.listen(0,"127.0.0.1");await once(server,"listening");const a=server.address();assert.ok(a&&typeof a!=="string");base=`http://127.0.0.1:${a.port}`});
after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))});
beforeEach(()=>{saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);Object.assign(process.env,{SKILLQUEST_MAINTENANCE_ENABLED:"1",SKILLQUEST_MAINTENANCE_SECRET:secret});calls=[];behavior=undefined});
afterEach(()=>keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i]}));
const call=(path="/cleanup",headers:Record<string,string>={},method="GET",body?:string)=>fetch(base+prefix+path,{method,headers:{Authorization:`Bearer ${secret}`,"X-Skillquest-Maintenance-Id":randomUUID(),...headers},body});
test("Maintenance is disabled unless explicitly enabled, even with the correct secret",async()=>{
  for(const enabled of [undefined,"0","true","yes"]){if(enabled===undefined)delete process.env.SKILLQUEST_MAINTENANCE_ENABLED;else process.env.SKILLQUEST_MAINTENANCE_ENABLED=enabled;
    assert.equal((await call()).status,503)}assert.equal(calls.length,0);
});
test("Missing, malformed and reused cryptographic material fail closed",async()=>{
  for(const value of [undefined,"short",secret+"="," "+secret]){if(value===undefined)delete process.env.SKILLQUEST_MAINTENANCE_SECRET;else process.env.SKILLQUEST_MAINTENANCE_SECRET=value;assert.equal((await call()).status,503)}
  process.env.SKILLQUEST_MAINTENANCE_SECRET=secret;
  for(const key of keys.filter(k=>!["SKILLQUEST_MAINTENANCE_ENABLED","SKILLQUEST_MAINTENANCE_SECRET","OTP_ENCRYPTION_KEYS"].includes(k))){process.env[key]=secret;assert.equal((await call()).status,503);delete process.env[key]}
  process.env.SKILLQUEST_PROXY_HMAC_KEY=Buffer.from(secret,"base64url").toString("base64");assert.equal((await call()).status,503);delete process.env.SKILLQUEST_PROXY_HMAC_KEY;
  for(const ring of [JSON.stringify({v1:Buffer.from(secret,"base64url").toString("base64")}),"invalid","[]"]){process.env.OTP_ENCRYPTION_KEYS=ring;assert.equal((await call()).status,503)}assert.equal(calls.length,0);
});
test("Only authenticated fixed GET/POST routes execute, with no client-selected options",async()=>{
  for(const task of ["cleanup","reconcile","sessions"])for(const method of ["GET","POST"]){const r=await call("/"+task,{"User-Agent":"anything","X-Forwarded-For":"1.2.3.4"},method);assert.equal(r.status,200);assert.match(r.headers.get("cache-control")!,/no-store/)}
  assert.equal(calls.length,6);assert.deepEqual(calls.map(c=>Object.keys(c)),Array.from({length:6},()=>["task","id"]));
});
test("IP, User-Agent, Cron, participant and QStash headers never authenticate maintenance",async()=>{
  for(const value of ["","Bearer wrong",secret,`Basic ${secret}`,`Bearer ${next}`])assert.equal((await call("/cleanup",{Authorization:value,"User-Agent":"vercel-cron/1.0","X-Real-IP":"127.0.0.1","X-Forwarded-For":"127.0.0.1","X-Vercel-Cron-Schedule":"* * * * *","Upstash-Signature":"forged","X-Skillquest-Proxy-Proof":"forged"})).status,401);
  assert.equal(authenticateMaintenance("é".repeat(50),secret),false);assert.equal(calls.length,0);
});
test("Invalid or missing invocation UUIDs are rejected before execution",async()=>{
  for(const id of ["","invalid","1; DROP TABLE",randomUUID().toUpperCase(),"00000000-0000-0000-0000-000000000000"])assert.equal((await call("/cleanup",{"X-Skillquest-Maintenance-Id":id})).status,400);assert.equal(calls.length,0);
});
test("Queries, alternate paths, bodies and dangerous parameters cannot select a command",async()=>{
  for(const path of ["/cleanup?secret="+secret,"/cleanup?maxRows=999999","/cleanup/","/CLEANUP","/unknown","/__proto__","/%63leanup"]){const r=await call(path);assert.ok([400,404].includes(r.status));assert.ok(!(await r.text()).includes(secret))}
  assert.equal((await call("/cleanup",{"Content-Type":"application/json"},"POST",JSON.stringify({command:"publish",url:"https://example.test",maxRows:999999}))).status,400);
  assert.equal(calls.length,0);
});
test("Unsupported methods and unauthenticated preflight fail closed",async()=>{
  for(const method of ["HEAD","PUT","DELETE","OPTIONS"])assert.equal((await call("/cleanup",{},method)).status,405);
  assert.equal((await call("/cleanup",{Authorization:""},"OPTIONS")).status,401);assert.equal(calls.length,0);
});
test("Duplicate authentication and invocation headers are refused",async()=>{
  const raw=async(headers:string[])=>new Promise<number>((resolve,reject)=>{const req=request(base+prefix+"/cleanup",{method:"GET",headers:["Host",new URL(base).host,...headers]},res=>{res.resume();resolve(res.statusCode!)});req.on("error",reject);req.end()});
  assert.equal(await raw(["Authorization",`Bearer ${secret}`,"X-Skillquest-Maintenance-Id",randomUUID()]),200);calls=[];
  for(const duplicate of ["Authorization","X-Skillquest-Maintenance-Id"]){const status=await new Promise<number>((resolve,reject)=>{
    const headers=["Host",new URL(base).host,"Authorization",`Bearer ${secret}`,"X-Skillquest-Maintenance-Id",randomUUID(),duplicate,duplicate==="Authorization"?`Bearer ${secret}`:randomUUID()];
    const req=request(base+prefix+"/cleanup",{method:"GET",headers},res=>{res.resume();resolve(res.statusCode!)});req.on("error",reject);req.end()});assert.equal(status,duplicate==="Authorization"?401:400)}assert.equal(calls.length,0);
});
test("Busy, replay, cooldown and stale owner have explicit non-success statuses",async()=>{
  for(const [code,status]of [["BUSY",409],["REPLAY",409],["COOLDOWN",429],["LEASE_LOST",503]] as const){behavior=async()=>{throw new MaintenanceInvocationError(code,code==="COOLDOWN"?60:1)};const r=await call();assert.equal(r.status,status);assert.ok(!(await r.text()).includes(secret))}
  behavior=async()=>{throw Error("sensitive-database-detail")};const r=await call();assert.equal(r.status,500);assert.ok(!(await r.text()).includes("sensitive"));
});
test("Partial and failed maintenance never return a success acknowledgement",async()=>{
  for(const stop of ["DEADLINE","ABORTED","FAILED"] as const){behavior=async()=>result(stop);assert.equal((await call()).status,503)}
});
test("Client disconnect aborts the cooperative invocation",async()=>{
  let entered!:()=>void,aborted!:()=>void;const ready=new Promise<void>(r=>entered=r),cancelled=new Promise<void>(r=>aborted=r);
  behavior=signal=>new Promise(r=>{signal.addEventListener("abort",()=>{aborted();r(result("ABORTED"))},{once:true});entered()});
  const c=new AbortController();const pending=fetch(base+prefix+"/cleanup",{headers:{Authorization:`Bearer ${secret}`,"X-Skillquest-Maintenance-Id":randomUUID()},signal:c.signal});
  await ready;c.abort();await assert.rejects(pending);await cancelled;
});
test("Replacing the dedicated test secret rejects the old credential",async()=>{
  process.env.SKILLQUEST_MAINTENANCE_SECRET=next;assert.equal((await call()).status,401);assert.equal((await call("/cleanup",{Authorization:`Bearer ${next}`})).status,200);assert.equal(calls.length,1);
});
