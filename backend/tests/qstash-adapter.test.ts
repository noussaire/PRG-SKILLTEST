import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import type { Server } from "node:http";
import { qstashRouter } from "../src/routes/qstash.routes.js";
import { QstashPublisher, type SimulatedQstashTransport } from "../src/services/qstash-publisher.service.js";
import { QSTASH_CALLBACK_PATH } from "../src/security/qstash-signature.js";
import type { JobNotification } from "../src/services/job-publication.service.js";
import { qstashCurrent, qstashNext, qstashUrl, signQstash } from "./helpers/qstash-signature.js";

const variables=["NODE_ENV","VERCEL","SKILLQUEST_QSTASH_MODE","QSTASH_CURRENT_SIGNING_KEY","QSTASH_NEXT_SIGNING_KEY","QSTASH_CALLBACK_URL","QSTASH_DEV","SKILLQUEST_PROXY_HMAC_KEY"];
let saved:Array<string|undefined>,server:Server,base:string,consumed:number;
const nativeFetch=globalThis.fetch.bind(globalThis);
const notification=():JobNotification=>({version:1,notificationId:randomUUID(),kind:"OTP_INITIAL",jobId:randomUUID(),phase:"DELIVER",generation:0,dueAt:new Date().toISOString()});
before(async()=>{
  const app=express();app.use(qstashRouter(async()=>{consumed++;return "COMPLETE";}));
  app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(err.status??500).json({error:"rejected"}));
  server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
});
after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
beforeEach(()=>{saved=variables.map(k=>process.env[k]);consumed=0;Object.assign(process.env,{NODE_ENV:"test",SKILLQUEST_QSTASH_MODE:"simulated",QSTASH_CURRENT_SIGNING_KEY:qstashCurrent,QSTASH_NEXT_SIGNING_KEY:qstashNext,QSTASH_CALLBACK_URL:qstashUrl});});
afterEach(()=>variables.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];}));
const post=(body:string|Buffer,signature?:string,path=QSTASH_CALLBACK_PATH,headers:Record<string,string>={})=>nativeFetch(base+path,{method:"POST",headers:{"content-type":"application/json",...(signature?{"upstash-signature":signature}:{}),...headers},body:typeof body==="string"?body:new Uint8Array(body)});

test("QStash official verifier accepts current and next synthetic signing keys on exact raw body",async()=>{
  const raw=" \n"+JSON.stringify(notification(),null,2)+"\n";
  for(const key of [qstashCurrent,qstashNext]){const r=await post(raw,signQstash(raw,key));assert.equal(r.status,200);assert.equal((await r.json()).disposition,"COMPLETE");}
  assert.equal(consumed,2);
});

test("Missing, forged, altered and wrong-issuer signatures never access the consumer",async()=>{
  const raw=JSON.stringify(notification()),valid=signQstash(raw);
  for(const sig of [undefined,"forged",valid.slice(0,-1)+(valid.endsWith("A")?"B":"A"),signQstash(raw,"different-synthetic-signing-key-0123456789"),signQstash(raw,qstashCurrent,{iss:"not-Upstash"})])assert.equal((await post(raw,sig)).status,401);
  assert.equal(consumed,0);
});

test("Signature for another URL, body, query or raw-byte representation is refused",async()=>{
  const raw=JSON.stringify(notification());
  assert.equal((await post(raw,signQstash(raw,qstashCurrent,{sub:"https://other.example.test/api/internal/jobs/qstash"}))).status,401);
  assert.equal((await post(raw+" ",signQstash(raw))).status,401);
  assert.equal((await post(raw,signQstash(raw),QSTASH_CALLBACK_PATH+"?target=other")).status,405);
  assert.equal((await post(raw,signQstash(raw),QSTASH_CALLBACK_PATH+"/")).status,405);
  assert.equal(consumed,0);
});

test("Expired, future and missing temporal claims and algorithm confusion are refused",async()=>{
  const raw=JSON.stringify(notification()),now=Math.floor(Date.now()/1000);
  for(const change of [{exp:now-1},{nbf:now+60},{iat:now+60},{exp:undefined},{nbf:undefined},{iat:undefined},{exp:now+10000},{jti:undefined}])assert.equal((await post(raw,signQstash(raw,qstashCurrent,change))).status,401);
  for(const header of [{alg:"none"},{alg:"HS512"},{crit:["unsupported"]},{b64:false}])assert.equal((await post(raw,signQstash(raw,qstashCurrent,{},header))).status,401);
  assert.equal(consumed,0);
});

test("Valid signature cannot smuggle payload, email, token, PDF or wrong job phase",async()=>{
  const n=notification();for(const value of [{...n,email:"synthetic@example.test"},{...n,payload:{}},{...n,token:"student-token"},{...n,pdf:"data"},{...n,jobId:"invalid"},{...n,phase:"EMAIL"},{...n,version:2},{...n,generation:1e20}]){
    const raw=JSON.stringify(value);assert.equal((await post(raw,signQstash(raw))).status,400);
  }
  assert.equal(consumed,0);
});

test("Compression, wrong content type, excessive body and non-POST methods are rejected",async()=>{
  const raw=JSON.stringify(notification());
  assert.equal((await post(raw,signQstash(raw),QSTASH_CALLBACK_PATH,{"content-encoding":"gzip"})).status,415);
  assert.equal((await post(raw,signQstash(raw),QSTASH_CALLBACK_PATH,{"content-type":"text/plain"})).status,415);
  const large=" ".repeat(9000);assert.equal((await post(large,signQstash(large))).status,413);
  assert.equal((await nativeFetch(base+QSTASH_CALLBACK_PATH)).status,405);assert.equal(consumed,0);
});

test("Callback is disabled by default, misconfiguration and production simulation fail closed",async()=>{
  const raw=JSON.stringify(notification());delete process.env.SKILLQUEST_QSTASH_MODE;assert.equal((await post(raw,signQstash(raw))).status,503);
  process.env.SKILLQUEST_QSTASH_MODE="real";assert.equal((await post(raw,signQstash(raw))).status,503);
  process.env.SKILLQUEST_QSTASH_MODE="simulated";Object.assign(process.env,{NODE_ENV:"production"});assert.equal((await post(raw,signQstash(raw))).status,503);
  Object.assign(process.env,{NODE_ENV:"test",VERCEL:"1"});assert.equal((await post(raw,signQstash(raw))).status,503);delete process.env.VERCEL;
  const next=process.env.QSTASH_NEXT_SIGNING_KEY;delete process.env.QSTASH_NEXT_SIGNING_KEY;assert.equal((await post(raw,signQstash(raw))).status,503);process.env.QSTASH_NEXT_SIGNING_KEY=next;
  process.env.QSTASH_CALLBACK_URL="http://backend.synthetic.test/api/internal/jobs/qstash";assert.equal((await post(raw,signQstash(raw))).status,503);assert.equal(consumed,0);
});

test("Next.js HMAC and QSTASH_DEV never replace the dedicated signing keys",async()=>{
  const raw=JSON.stringify(notification());process.env.SKILLQUEST_PROXY_HMAC_KEY="synthetic-proxy-key-0123456789abcdef";process.env.QSTASH_DEV="true";
  assert.equal((await post(raw,signQstash(raw,process.env.SKILLQUEST_PROXY_HMAC_KEY))).status,401);
  process.env.QSTASH_CURRENT_SIGNING_KEY=process.env.SKILLQUEST_PROXY_HMAC_KEY;assert.equal((await post(raw,signQstash(raw,process.env.SKILLQUEST_PROXY_HMAC_KEY))).status,503);assert.equal(consumed,0);
});

test("QStash publisher uses only injected simulated HTTP with stable deduplication and minimal metadata",async()=>{
  const requests:any[]=[],transport:SimulatedQstashTransport={mode:"simulated",request:async(url,init)=>{requests.push({url,init});return Response.json({messageId:"synthetic"},{status:202});}};
  const publisher=new QstashPublisher({token:"synthetic-token",publishOrigin:"https://qstash-eu-central-1.upstash.io",callbackUrl:qstashUrl},transport),n=notification();
  await publisher.publish(n,new AbortController().signal);await publisher.publish(n,new AbortController().signal);
  assert.equal(requests.length,2);assert.equal(decodeURIComponent(new URL(requests[0].url).pathname.slice("/v2/publish/".length)),qstashUrl);
  const h=new Headers(requests[0].init.headers);assert.equal(h.get("upstash-deduplication-id"),n.notificationId);assert.equal(h.get("authorization"),"Bearer synthetic-token");
  assert.equal(requests[0].init.redirect,"error");assert.equal(requests[0].init.body,requests[1].init.body);assert.deepEqual(JSON.parse(requests[0].init.body),n);
});

test("Publisher never confirms an error, redirect, missing acknowledgement or invalid origin",async()=>{
  const n=notification(),config={token:"synthetic-token",publishOrigin:"https://qstash.upstash.io",callbackUrl:qstashUrl};
  for(const response of [new Response(null,{status:429}),new Response(null,{status:500}),new Response(null,{status:302}),new Response(null,{status:204}),Response.json({})]){
    await assert.rejects(new QstashPublisher(config,{mode:"simulated",request:async()=>response}).publish(n,new AbortController().signal));
  }
  assert.throws(()=>new QstashPublisher({...config,publishOrigin:"https://attacker.example.test"},{mode:"simulated",request:async()=>Response.json({})}));
  assert.throws(()=>new QstashPublisher(config,{mode:"real" as any,request:async()=>Response.json({})}));
});
