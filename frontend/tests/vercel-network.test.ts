import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { internalNetworkProof } from "../src/lib/network-proof";
import { POST } from "../src/app/api/adaptive/start/route";
import { digest, signProof, verifyProof } from "../../shared/network-proof.mjs";

const key=Buffer.alloc(32,47).toString("base64"), edge=Buffer.alloc(32,59).toString("base64");
const variables=["NODE_ENV","VERCEL","VERCEL_ENV","SKILLQUEST_NETWORK_SOURCE","SKILLQUEST_VERCEL_INGRESS","SKILLQUEST_PROXY_MODE","SKILLQUEST_PROXY_HMAC_KEY","SKILLQUEST_EDGE_HMAC_KEY","API_INTERNAL_URL"];
let saved: Array<string|undefined>;
beforeEach(()=>{
  saved=variables.map(k=>process.env[k]);
  Object.assign(process.env,{NODE_ENV:"production",VERCEL:"1",VERCEL_ENV:"preview",SKILLQUEST_NETWORK_SOURCE:"vercel",SKILLQUEST_VERCEL_INGRESS:"direct",
    SKILLQUEST_PROXY_MODE:"required",SKILLQUEST_PROXY_HMAC_KEY:key,SKILLQUEST_EDGE_HMAC_KEY:edge,API_INTERNAL_URL:"https://backend.example.test"});
});
afterEach(()=>variables.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];}));
const target=new URL("https://backend.example.test/api/v1/adaptive/start?lang=ar");
function request(headers:Record<string,string>={}) {return new NextRequest("https://frontend.example.test/api/adaptive/start?lang=ar",{method:"POST",headers:{"content-type":"application/json",...headers},body:"{}"});}
function proof(headers:Record<string,string>={}) {
  return internalNetworkProof(request(headers),target,Buffer.from("{}"),"{}","")["x-skillquest-proxy-proof"];
}
function payload(token:string){return verifyProof(token,key,"skillquest-api","POST",target.pathname+target.search,digest("{}"),"");}

test("Vercel headers alone never opt into network trust",()=>{
  delete process.env.SKILLQUEST_NETWORK_SOURCE;
  assert.equal(payload(proof({"x-vercel-forwarded-for":"192.0.2.7","x-forwarded-for":"192.0.2.8","x-real-ip":"192.0.2.9","x-vercel-id":"forged"})).network,null);
});

test("Vercel adapter requires explicit direct ingress and real deployment environment configuration",()=>{
  for(const [name,value] of [["VERCEL",undefined],["VERCEL","0"],["NODE_ENV","test"],["NODE_ENV","development"],["VERCEL_ENV",undefined],
    ["VERCEL_ENV","development"],["SKILLQUEST_VERCEL_INGRESS",undefined],["SKILLQUEST_VERCEL_INGRESS","trusted-proxy"],["SKILLQUEST_NETWORK_SOURCE","typo"]] as const){
    const previous=process.env[name];if(value===undefined)delete process.env[name];else Object.assign(process.env,{[name]:value});
    assert.throws(()=>proof({"x-vercel-forwarded-for":"192.0.2.7","vercel":"1","x-vercel-env":"production"}),/PROXY_CONFIG_INVALID/);
    if(previous===undefined)delete process.env[name];else Object.assign(process.env,{[name]:previous});
  }
});

test("Explicit Vercel adapter minimizes IPv4, mapped IPv4 and IPv6 and mints fresh internal nonces",()=>{
  for(const [ip,network] of [["192.0.2.7","192.0.2.7/32"],["::ffff:192.0.2.7","192.0.2.7/32"],["2001:0db8:1:2::9876","2001:db8:1:2::/64"]]){
    const a=payload(proof({"x-vercel-forwarded-for":ip})),b=payload(proof({"x-vercel-forwarded-for":ip}));
    assert.equal(a.network,network);assert.notEqual(a.nonce,b.nonce);assert.ok(Math.abs(Date.now()-a.ts)<1000);
  }
  process.env.VERCEL_ENV="production";assert.equal(payload(proof({"x-vercel-forwarded-for":"192.0.2.7"})).network,"192.0.2.7/32");
});

test("Vercel adapter rejects missing, ambiguous or malformed IP without alternate-header or edge-proof fallback",()=>{
  const signedEdge=signProof(edge,"skillquest-bff","POST","/api/adaptive/start?lang=ar","{}","","198.51.100.9");
  for(const ip of [undefined,"","unknown","192.0.2.7, 198.51.100.8","192.0.2.7:443","[2001:db8::1]","fe80::1%eth0","010.0.0.1","192.0.2.7/32"]){
    const headers:Record<string,string>={"x-forwarded-for":"198.51.100.1","x-real-ip":"198.51.100.2",forwarded:"for=198.51.100.3",
      "x-skillquest-edge-proof":signedEdge,"x-vercel-signature":"browser-forged"};
    if(ip!==undefined)headers["x-vercel-forwarded-for"]=ip;
    assert.equal(payload(proof(headers)).network,null);
  }
});

test("Vercel BFF ignores forged secondary headers and replaces browser internal proofs",async t=>{
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const h=new Headers(init?.headers);
    for(const name of ["x-forwarded-for","x-real-ip","x-vercel-forwarded-for","x-skillquest-edge-proof","x-vercel-signature"])assert.equal(h.get(name),null);
    assert.equal(payload(h.get("x-skillquest-proxy-proof")!).network,"192.0.2.7/32");
    return Response.json({challengeId:"synthetic"},{status:409});
  });
  const r=await POST(request({"x-vercel-forwarded-for":"192.0.2.7","x-forwarded-for":"198.51.100.1","x-real-ip":"198.51.100.2",
    "x-skillquest-edge-proof":"forged","x-skillquest-proxy-proof":"forged","x-vercel-signature":"forged"}));
  assert.equal(r.status,409);assert.equal(r.headers.get("set-cookie"),null);
});

test("Missing Vercel origin preserves unknown-network refusal and never substitutes proxy IP",async t=>{
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    assert.equal(payload(new Headers(init?.headers).get("x-skillquest-proxy-proof")!).network,null);
    return Response.json({code:"EMAIL_NETWORK_UNAVAILABLE"},{status:503});
  });
  const r=await POST(request({"x-forwarded-for":"192.0.2.1","x-real-ip":"192.0.2.2"}));
  assert.equal(r.status,503);assert.equal((await r.json()).code,"EMAIL_NETWORK_UNAVAILABLE");
});

test("Vercel mode cannot fall back to unsigned localhost when the internal key is missing",async t=>{
  delete process.env.SKILLQUEST_PROXY_HMAC_KEY;Object.assign(process.env,{NODE_ENV:"test",SKILLQUEST_PROXY_MODE:"local"});
  const f=t.mock.method(globalThis,"fetch",async()=>{throw Error("Must not call backend");});
  assert.equal((await POST(request({"x-vercel-forwarded-for":"192.0.2.7"}))).status,503);assert.equal(f.mock.callCount(),0);
  delete process.env.SKILLQUEST_NETWORK_SOURCE;
  assert.deepEqual(internalNetworkProof(request(),target,Buffer.from("{}"),"{}",""),{});
});

test("Vercel identity remains bound to exact backend method, query, body and bearer",()=>{
  const token=proof({"x-vercel-forwarded-for":"192.0.2.7"});
  for(const [method,path,body,bearer] of [["GET",target.pathname+target.search,digest("{}"),""],
    ["POST",target.pathname+"?lang=fr",digest("{}"),""],["POST",target.pathname+target.search,digest("changed"),""],
    ["POST",target.pathname+target.search,digest("{}"),"Bearer forged"]]){
    assert.throws(()=>verifyProof(token,key,"skillquest-api",method,path,body,bearer),/PROXY_PROOF_INVALID/);
  }
});
