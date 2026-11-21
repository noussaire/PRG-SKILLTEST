import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";

const options = { skip: process.env.LOT4_NATIVE_CONTEXT ? false : "Owned native PostgreSQL required", timeout: 60000 };
let db: PrismaClient, server: Server, base: string, workspace: string, contextFile: string;
let Queue: typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let send: typeof import("../src/services/brevo.service.js").sendReportEmail;
let messages: any[];
const fetchLocal = globalThis.fetch.bind(globalThis);
const pepper = "serverless-synthetic-pepper-0123456789abcdef";
const profile = (email: string, language: "fr" | "ar" = "fr") => ({ fullName: "Synthetic student", email, language, consent: true, adult: true, emailReport: true });
before(async () => {
  if (options.skip) return;
  db = (await connectLot4NativeDatabase()).client; contextFile = process.env.LOT4_NATIVE_CONTEXT!;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:pepper,GROQ_API_KEY:""});
  const artifact = JSON.parse(await readFile(resolve("output/vercel-entry-step1-20261031/package-context.json"),"utf8"));
  workspace = await realpath(artifact.workspace);
  assert.ok(workspace.startsWith(await realpath(resolve("output/vercel-entry-step1-20261031")) + sep + "package-"));
  process.env.DOTENV_CONFIG_PATH = join(workspace,"nonexistent-synthetic.env");
  const entry = await import(pathToFileURL(artifact.entry).href);
  assert.equal(typeof entry.default,"function");
  server = entry.default.listen(0,"127.0.0.1"); await once(server,"listening");
  const address=server.address(); assert.ok(address && typeof address!=="string"); base=`http://127.0.0.1:${address.port}`;
  ({OtpDeliveryQueue:Queue}=await import("../src/services/otp-delivery.service.js"));
  ({sendReportEmail:send}=await import("../src/services/brevo.service.js"));
});
beforeEach(async t => {
  if (options.skip) return;
  messages=[]; delete process.env.SKILLQUEST_PROXY_HMAC_KEY; delete process.env.SKILLQUEST_PROXY_MODE;
  Object.assign(process.env,{NODE_ENV:"test",BREVO_API_KEY:"synthetic-only-no-network",BREVO_SENDER_EMAIL:"sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"60",EMAIL_APP_DAILY_LIMIT:"240",
    OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"100",OTP_GLOBAL_DAILY_SENDS:"120",
    OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=input instanceof Request?input.url:String(input);
    if(url==="https://api.brevo.com/v3/smtp/email") {messages.push(JSON.parse(String(init?.body)));return Response.json({messageId:"synthetic"},{status:201});}
    if(!url.startsWith("http://127.0.0.1:")) throw Error("EXTERNAL_NETWORK_FORBIDDEN");
    return fetchLocal(input,init);
  });
  await db.$executeRawUnsafe(`TRUNCATE "ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async()=>{
  if(options.skip)return;
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  const compiled=await import(pathToFileURL(join(workspace,"backend/dist/db/prisma.js")).href);await compiled.prisma.$disconnect();
  const source=await import("../src/db/prisma.js");await source.prisma.$disconnect();await db.$disconnect();
});
async function api(path:string,body?:unknown,token?:string){
  const r=await fetch(base+"/api/v1"+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json() as any,headers:r.headers};
}
async function verified(p:ReturnType<typeof profile>){
  const reservationsBefore = await db.emailBudgetReservation.count();
  const issued=await api("/adaptive/start",p);assert.equal(issued.status,409);
  assert.equal(messages.length,0); // HTTP import/request never starts delivery.
  const job=await db.participantEmailDeliveryJob.findUniqueOrThrow({where:{challengeId:issued.body.challengeId}});
  assert.equal(job.status,"PENDING");assert.equal(await db.emailBudgetReservation.count(),reservationsBefore);
  await new Queue(db,send).runOnce();const code=messages.find(m=>m.to[0].email===p.email).htmlContent.match(/>(\d{6})<\//)![1];
  const result=await api("/adaptive/start",{...p,challengeId:issued.body.challengeId,verificationCode:code});assert.equal(result.status,201);return result;
}

test("Compiled serverless HTTP entry preserves config, health, auth and queues OTP without automatic delivery",options,async()=>{
  assert.equal((await api("/health")).status,200);
  assert.equal((await api("/adaptive/config?lang=ar")).body.totalQuestions,31);
  assert.equal((await api("/adaptive/me")).status,401);
  const result=await verified(profile("entry@example.test"));
  assert.equal((await api("/adaptive/me",undefined,result.body.token)).status,200);
  assert.equal(result.headers.get("cache-control"),"private, no-store");
});
test("Compiled serverless entry preserves complete FR/AR journeys and packaged PDF assets",options,async()=>{
  const pdf=await import(pathToFileURL(join(workspace,"backend/dist/services/report-pdf.service.js")).href);
  for(const language of ["fr","ar"] as const){
    messages=[];const r=await verified(profile(`${language}@example.test`,language));let current=r.body.interview;
    for(let n=0;n<31;n++){
      const q=current.currentQuestion;
      const response=await api(`/adaptive/answer?lang=${language}`,{questionId:q.id,choiceId:q.choices[0].id},r.body.token);
      assert.equal(response.status,200);current=response.body;
    }
    assert.equal(current.currentQuestion,null);assert.equal(current.report.skills.length,31);
    const stored=await db.adaptiveInterview.findUniqueOrThrow({where:{id:r.body.interview.id}});
    const html=await pdf.printableReportHTML(stored,{status:"COMPLETE",summary:JSON.stringify({fr:"Synthèse synthétique.",ar:"ملخص تجريبي."}),nextAttemptAt:new Date()});
    assert.ok(html.includes("data:image/png;base64,"));assert.ok(html.includes("data:font/ttf;base64,"));assert.equal(html.match(/<section /g)?.length,31);
  }
});
test("Compiled serverless entry preserves retake after 30 days and revokes previous access",options,async()=>{
  const p=profile("retake-entry@example.test"),first=await verified(p);
  await db.adaptiveInterview.update({where:{id:first.body.interview.id},data:{lastTestStartedAt:new Date(Date.now()-31*86400000)}});
  await db.$executeRawUnsafe(`UPDATE "ParticipantEmailGate" SET "nextIssueAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
  await db.$executeRawUnsafe(`UPDATE "EmailOtpThrottle" SET "nextSendAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '61 seconds'`);
  messages=[];const next=await verified(p);assert.equal(next.body.interview.id,first.body.interview.id);
  assert.equal((await api("/adaptive/me",undefined,first.body.token)).status,401);assert.equal(await db.adaptiveInterview.count(),1);
});
test("Compiled serverless entry preserves administrator sessions and the ten-attempt login envelope",options,async()=>{
  const {hashPassword}=await import("../src/security/tokens.js");
  await db.user.create({data:{email:"entry-admin@example.test",role:"ADMIN",passwordHash:await hashPassword("synthetic-password")}});
  const login=await api("/admin/auth/login",{email:"entry-admin@example.test",password:"synthetic-password"});assert.equal(login.status,200);
  assert.equal((await api("/admin/auth/me",undefined,login.body.token)).status,200);
  assert.equal((await api("/admin/auth/me",undefined,"a".repeat(64))).status,401);
  for(let n=0;n<10;n++)assert.equal((await api("/admin/auth/login",{email:"limited-admin@example.test",password:"wrong"})).status,401);
  assert.equal((await api("/admin/auth/login",{email:"limited-admin@example.test",password:"wrong"})).status,429);
});
test("Unchanged compiled localhost entry still starts workers/listener and stops its own process cleanly",options,async()=>{
  const free=createServer();await new Promise<void>(r=>free.listen(0,"127.0.0.1",r));const address=free.address();assert.ok(address&&typeof address!=="string");
  const port=address.port;await new Promise<void>(r=>free.close(()=>r()));
  await db.$executeRawUnsafe(`INSERT INTO "EmailAbuseCounter" (scope,"subjectHash",metric,"windowStart","expiresAt",count)
    VALUES ('IDENTITY',$1,'OTP_FAILURE',(clock_timestamp() AT TIME ZONE 'UTC')-interval '4 days',(clock_timestamp() AT TIME ZONE 'UTC')-interval '3 days',1)`,"c".repeat(64));
  const loader=pathToFileURL(resolve("output/lot3-rollback-6f44523a33/test-loader.mjs")).href;
  const script=resolve("output/vercel-entry-step1-20261031/local-probe.mjs");
  const child=spawn(process.execPath,["--loader",loader,script,workspace],{cwd:resolve("."),windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    TEMP:resolve("output/vercel-entry-step1-20261031"),TMP:resolve("output/vercel-entry-step1-20261031"),NODE_ENV:"test",LOT4_NATIVE_CONTEXT:contextFile,
    JOIN_CODE_PEPPER:pepper,PORT:String(port),DOTENV_CONFIG_PATH:join(workspace,"nonexistent-synthetic.env")},stdio:["ignore","pipe","pipe","ipc"]});
  let logs="";child.stdout?.on("data",v=>{logs+=String(v);});child.stderr?.on("data",v=>{logs+=String(v);});
  const exited=once(child,"exit");
  try{
    const started=await Promise.race([once(child,"message"),exited.then(()=>{throw Error("Local child exited before ready: "+logs);})]);
    const info=started[0] as {intervals:number;listens:number};assert.equal(info.intervals,6);assert.equal(info.listens,1);
    const r=await fetch(`http://127.0.0.1:${port}/api/v1/health`);assert.equal(r.status,200);
    const deadline=Date.now()+7000;
    while(await db.emailAbuseCounter.count()){
      assert.ok(Date.now()<deadline,"Local maintenance did not run");await new Promise(r=>setTimeout(r,50));
    }
    child.send("stop");const [code]=await exited;assert.equal(code,0,logs);
  }finally{if(child.exitCode===null){child.kill();await exited;}}
});
