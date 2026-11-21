import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server.js";
import { connectLot4NativeDatabase } from "./helpers/native-postgres.js";
import { signProof } from "../../shared/network-proof.mjs";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned native PostgreSQL required",timeout:60000};
const key=Buffer.alloc(32,71).toString("base64");
let db:PrismaClient,other:PrismaClient,server:Server,base:string;
let start:(request:NextRequest)=>Promise<Response>;
let Queue:typeof import("../src/services/otp-delivery.service.js").OtpDeliveryQueue;
let send:typeof import("../src/services/brevo.service.js").sendReportEmail;
let deliveries:any[],forwarded:Array<{url:string;init:RequestInit}>;
const fetchLocal=globalThis.fetch.bind(globalThis);
const profile=(email="vercel@example.test",language:"fr"|"ar"="fr")=>({fullName:"Synthetic student",email,language,consent:true,adult:true,emailReport:true});
before(async()=>{
  if(options.skip)return;
  other=(await connectLot4NativeDatabase()).client;
  Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:"vercel-network-synthetic-pepper-0123456789abcdef",GROQ_API_KEY:"",
    DOTENV_CONFIG_PATH:"output/vercel-network-step2-20261031/nonexistent-synthetic.env"});
  ({prisma:db}=await import("../src/db/prisma.js"));
  ({OtpDeliveryQueue:Queue}=await import("../src/services/otp-delivery.service.js"));
  ({sendReportEmail:send}=await import("../src/services/brevo.service.js"));
  const {app}=await import("../src/app.js");assert.equal(app.get("trust proxy"),false);
  server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
  ({POST:start}=await import(new URL("../../frontend/src/app/api/adaptive/start/route.ts",import.meta.url).href));
});
beforeEach(async t=>{
  if(options.skip)return;
  deliveries=[];forwarded=[];
  Object.assign(process.env,{NODE_ENV:"production",VERCEL:"1",VERCEL_ENV:"preview",SKILLQUEST_NETWORK_SOURCE:"vercel",SKILLQUEST_VERCEL_INGRESS:"direct",
    SKILLQUEST_PROXY_MODE:"required",SKILLQUEST_PROXY_HMAC_KEY:key,API_INTERNAL_URL:base,BREVO_API_KEY:"synthetic-only-no-network",BREVO_SENDER_EMAIL:"sender@example.test",
    EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"60",EMAIL_APP_DAILY_LIMIT:"240",OTP_IDENTITY_DAILY_SENDS:"5",OTP_NETWORK_DAILY_SENDS:"100",OTP_GLOBAL_DAILY_SENDS:"120",
    OTP_IDENTITY_DAILY_FAILURES:"15",OTP_NETWORK_DAILY_FAILURES:"150",OTP_GLOBAL_DAILY_FAILURES:"1000"});
  (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=input instanceof Request?input.url:String(input);
    if(url==="https://api.brevo.com/v3/smtp/email"){
      deliveries.push(JSON.parse(String(init?.body)));return Response.json({messageId:"synthetic"},{status:201});
    }
    if(!url.startsWith(base+"/"))throw Error("EXTERNAL_NETWORK_FORBIDDEN");
    if(new Headers(init?.headers).has("x-skillquest-proxy-proof"))forwarded.push({url,init:init!});
    return fetchLocal(input,init);
  });
  await db.$executeRawUnsafe(`TRUNCATE "ProxyRequestNonce","User","Assessment","AdaptiveInterview","ParticipantEmailGate","EmailOtpChallenge",
    "EmailBudgetReservation","EmailAbuseCounter","EmailOtpThrottle","EmailProviderState" CASCADE`);
});
after(async()=>{if(options.skip)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await db.$disconnect();await other.$disconnect();});

// Simulated Vercel ingress deliberately overwrites the browser's candidate.
// This tests application behavior, not the real platform's provenance guarantee.
async function front(body:unknown,ip:string|null="192.0.2.7",browser:Record<string,string>={}){
  const headers=new Headers({"content-type":"application/json",...browser});
  headers.delete("x-vercel-forwarded-for");if(ip!==null)headers.set("x-vercel-forwarded-for",ip);
  const r=await start(new NextRequest("https://frontend.synthetic.test/api/adaptive/start",{method:"POST",headers,body:JSON.stringify(body)}));
  return {status:r.status,body:await r.json() as any,headers:r.headers};
}
async function issue(p=profile(),ip="192.0.2.7"){
  const r=await front(p,ip);assert.equal(r.status,409);await new Queue(other,send).runOnce();
  const message=deliveries.find(m=>m.to[0].email===p.email);assert.ok(message);
  return {challengeId:r.body.challengeId as string,verificationCode:message.htmlContent.match(/>(\d{6})<\//)![1] as string};
}

test("Native simulated Vercel ingress preserves IPv4/IPv6 FR/AR OTP and secure participant cookies",options,async()=>{
  for(const [language,ip] of [["fr","192.0.2.7"],["ar","2001:db8:1:2::9876"]] as const){
    const p=profile(`${language}@example.test`,language),challenge=await issue(p,ip);
    const r=await front({...p,...challenge},ip,{"x-forwarded-for":"198.51.100.1","x-real-ip":"198.51.100.2","x-skillquest-proxy-proof":"forged","x-skillquest-edge-proof":"forged"});
    assert.equal(r.status,201);assert.equal(r.body.language,language);
    const cookie=r.headers.get("set-cookie")!;assert.match(cookie,/sq_interview=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=lax/i);
  }
  assert.equal(deliveries.length,2);assert.equal(await db.emailBudgetReservation.count(),2);assert.equal(await db.adaptiveInterview.count(),2);
  for(const f of forwarded){const h=new Headers(f.init.headers);assert.equal(h.get("x-vercel-forwarded-for"),null);assert.equal(h.get("x-forwarded-for"),null);assert.equal(h.get("x-real-ip"),null);}
});

test("Native Vercel backend refuses direct headers, missing/forged HMAC, expired proofs and replay races",options,async()=>{
  const body=JSON.stringify(profile()),path="/api/v1/adaptive/start";
  for(const token of [undefined,"forged",signProof(key,"skillquest-api","POST",path,body,"","192.0.2.7/32",undefined,Date.now()-61000)]){
    const headers:Record<string,string>={"content-type":"application/json","x-vercel-forwarded-for":"192.0.2.7","x-forwarded-for":"192.0.2.7","x-real-ip":"192.0.2.7","x-vercel-signature":"forged"};
    if(token)headers["x-skillquest-proxy-proof"]=token;
    assert.equal((await fetchLocal(base+path,{method:"POST",headers,body})).status,403);
  }
  assert.equal((await db.$queryRawUnsafe<{count:number}[]>(`SELECT count(*)::int AS count FROM "ProxyRequestNonce"`))[0].count,0);assert.equal(await db.emailOtpChallenge.count(),0);
  assert.equal((await front(profile())).status,409);const sent=forwarded[0];
  const replays=await Promise.all(Array.from({length:5},()=>fetchLocal(sent.url,sent.init)));
  assert.ok(replays.every(r=>r.status===403));assert.equal((await other.$queryRawUnsafe<{count:number}[]>(`SELECT count(*)::int AS count FROM "ProxyRequestNonce"`))[0].count,1);assert.equal(await db.emailOtpChallenge.count(),1);
  const altered=new Headers(sent.init.headers),token=altered.get("x-skillquest-proxy-proof")!;
  altered.set("x-skillquest-proxy-proof",token.slice(0,-1)+(token.endsWith("a")?"b":"a"));
  assert.equal((await fetchLocal(sent.url,{...sent.init,headers:altered})).status,403);assert.equal(deliveries.length,0);
});

test("Native missing or malformed Vercel IP refuses OTP before counters, budget or participant creation",options,async()=>{
  for(const ip of [null,"192.0.2.7, 198.51.100.1","invalid","[2001:db8::1]"]){
    const r=await front(profile(),ip,{"x-forwarded-for":"198.51.100.1","x-real-ip":"198.51.100.2","x-skillquest-edge-proof":"forged"});
    assert.equal(r.status,503);assert.equal(r.body.code,"EMAIL_NETWORK_UNAVAILABLE");
  }
  assert.equal(await db.emailOtpChallenge.count(),0);assert.equal(await db.emailAbuseCounter.count(),0);
  assert.equal(await db.emailBudgetReservation.count(),0);assert.equal(await db.adaptiveInterview.count(),0);assert.equal(deliveries.length,0);
  delete process.env.VERCEL;const count=forwarded.length;
  assert.equal((await front(profile())).status,503);assert.equal(forwarded.length,count);
});

test("Native Vercel shared NAT keeps students independent and forged browser headers cannot reset network limits",options,async()=>{
  process.env.OTP_NETWORK_DAILY_FAILURES="2";
  const a=profile("a@example.test"),b=profile("b@example.test"),ca=await issue(a),cb=await issue(b);
  const wrong=ca.verificationCode==="000000"?"111111":"000000";
  for(let n=0;n<2;n++)assert.equal((await front({...a,...ca,verificationCode:wrong},"192.0.2.7",{"x-vercel-forwarded-for":`198.51.100.${n}`,"x-forwarded-for":`203.0.113.${n}`,"x-real-ip":`203.0.113.${n}`})).status,400);
  assert.equal((await front({...a,...ca},"192.0.2.7",{"x-vercel-forwarded-for":"198.51.100.99","x-forwarded-for":"198.51.100.99"})).status,429);
  assert.equal((await front({...b,...cb},"192.0.2.7")).status,201);assert.equal(await db.adaptiveInterview.count(),1);assert.equal(deliveries.length,2);
});

test("Native changing genuine simulated Vercel networks cannot reset persistent email failure limits",options,async()=>{
  process.env.OTP_IDENTITY_DAILY_FAILURES="2";const p=profile(),c=await issue(p),wrong=c.verificationCode==="000000"?"111111":"000000";
  for(const ip of ["192.0.2.7","2001:db8:1:2::1234"])assert.equal((await front({...p,...c,verificationCode:wrong},ip)).status,400);
  assert.equal((await front({...p,...c},"198.51.100.9")).status,429);assert.equal(await db.adaptiveInterview.count(),0);
});

test("Native two Vercel network identities and independent workers compete atomically for the last Brevo credit",options,async()=>{
  Object.assign(process.env,{EMAIL_ACCOUNT_DAILY_LIMIT:"1",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"1"});
  const results=await Promise.all([front(profile("last-a@example.test"),"192.0.2.7"),front(profile("last-b@example.test"),"2001:db8:3:4::1")]);
  assert.ok(results.every(r=>r.status===409));
  const pids=await Promise.all([db.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid"),other.$queryRawUnsafe<{pid:number}[]>("SELECT pg_backend_pid() AS pid")]);
  assert.notEqual(pids[0][0].pid,pids[1][0].pid);
  await Promise.all([new Queue(db,send).runOnce(),new Queue(other,send).runOnce()]);
  assert.equal(deliveries.length,1);assert.equal(await db.emailBudgetReservation.count(),1);
  console.log("Vercel simulated concurrency proof",JSON.stringify({pids:pids.map(r=>r[0].pid),jobs:results.length,providerCalls:deliveries.length,reservations:await db.emailBudgetReservation.count()}));
});
