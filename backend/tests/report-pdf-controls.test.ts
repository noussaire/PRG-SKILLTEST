import { test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { createReportPdfRenderer, PDF_RENDER_TIMEOUT_MS, PDF_CLOSE_TIMEOUT_MS } from "../src/services/report-pdf.service.js";
import { REPORT_EMAIL_LEASE_MS } from "../src/services/report-limits.js";
import { resolvePdfBrowser } from "../src/services/report-browser.service.js";
import { readFile } from "node:fs/promises";

const row={id:"synthetic",displayName:"Synthetic",state:{} as never,expiresAt:new Date()};
const job={status:"COMPLETE",summary:"synthetic",nextAttemptAt:new Date()};
const valid=Buffer.from("%PDF-1.7\n/FontFile2 /Subtype /Image /StructTreeRoot\n%%EOF");
const gate=()=>{let open!:(value?:any)=>void;const wait=new Promise<any>(r=>open=r);return {wait,open}};
const flush=()=>new Promise<void>(r=>setImmediate(r));
function fake(phase?:string,wait?:Promise<any>){
 const facts={launches:0,closes:0,pageOptions:undefined as any,launchOptions:undefined as any};
 const page={route:async()=>{},setContent:async()=>{if(phase==="content")throw Error("CONTENT")},evaluate:async()=>{if(phase==="fonts")throw Error("FONTS");if(phase==="pending-fonts")await wait},
  pdf:async()=>{if(phase==="pdf")throw Error("PDF");if(phase==="pending-pdf")await wait;return phase==="untagged"?Buffer.from("%PDF-1.7"):valid}};
 const browser={version:()=>phase==="version"?"151.0.0.0":"153.0.0.0",newPage:async(opts:any)=>{facts.pageOptions=opts;if(phase==="page")throw Error("PAGE");return page},
  close:async()=>{facts.closes++;if(phase==="close-error")throw Error("CLOSE");if(phase==="pending-close")await wait}} as unknown as Browser;
 const runtime=async()=>({expectedMajor:153,options:{},launch:async(opts:any)=>{facts.launches++;facts.launchOptions=opts;if(phase==="launch")throw Error("LAUNCH");if(phase==="late-launch")await wait;return browser}});
 return {facts,runtime};
}
function renderer(f:ReturnType<typeof fake>,budgets={renderTimeoutMs:1000,closeTimeoutMs:100}){return createReportPdfRenderer({runtime:f.runtime,html:async()=>"<html></html>",...budgets})}
const code=(expected:string)=>(error:any)=>error.code===expected;

test("PDF fixed rendering and cleanup budgets retain a 70-second margin inside the unchanged report lease",()=>{
 assert.equal(PDF_RENDER_TIMEOUT_MS,45000);assert.equal(PDF_CLOSE_TIMEOUT_MS,5000);assert.equal(REPORT_EMAIL_LEASE_MS,120000);
 assert.equal(REPORT_EMAIL_LEASE_MS-PDF_RENDER_TIMEOUT_MS-PDF_CLOSE_TIMEOUT_MS,70000);
 assert.throws(()=>createReportPdfRenderer({renderTimeoutMs:45001}),/PDF_BUDGET_INVALID/);
});
test("PDF-only fonts are static and preserve the Arabic GSUB/GPOS shaping tables and original license",async()=>{
 for(const name of ["Regular","Bold"]){const bytes=await readFile(new URL(`../assets/fonts/SkillQuestArabicPDF-${name}.ttf`,import.meta.url));
  const count=bytes.readUInt16BE(4),tags=Array.from({length:count},(_,i)=>bytes.toString("ascii",12+i*16,16+i*16));
  assert.ok(tags.includes("glyf")&&tags.includes("GSUB")&&tags.includes("GPOS"));assert.equal(tags.includes("fvar"),false);
 }
 const license=await readFile(new URL("../assets/fonts/OFL.txt",import.meta.url),"utf8");assert.match(license,/SIL OPEN FONT LICENSE/);
});
test("PDF success closes its browser and disables scripts, service workers and network",async()=>{
 const f=fake(),r=renderer(f);assert.deepEqual(await r.render(row,job),valid);assert.equal(f.facts.closes,1);assert.equal(r.snapshot().active,0);
 assert.deepEqual(f.facts.pageOptions,{javaScriptEnabled:false,serviceWorkers:"block",offline:true});assert.ok(f.facts.launchOptions.args.includes("--disable-background-networking"));
});
for(const phase of ["page","content","fonts","pdf"] as const)test(`PDF ${phase} failure closes its browser and frees capacity`,async()=>{
 const f=fake(phase),r=renderer(f);await assert.rejects(r.render(row,job),code("REPORT_PDF_UNAVAILABLE"));assert.equal(f.facts.closes,1);assert.equal(r.snapshot().active,0);
});
test("PDF launch failure leaves no occupied renderer slot",async()=>{
 const f=fake("launch"),r=renderer(f);await assert.rejects(r.render(row,job));assert.equal(f.facts.closes,0);assert.equal(r.snapshot().active,0);
});
test("PDF font wait is globally timed out and browser closure frees capacity even if the mocked wait never settles",async()=>{
 const f=fake("pending-fonts",new Promise(()=>{})),r=renderer(f,{renderTimeoutMs:30,closeTimeoutMs:50});
 await assert.rejects(r.render(row,job),code("REPORT_PDF_TIMEOUT"));assert.equal(f.facts.closes,1);assert.equal(r.snapshot().active,0);
});
test("PDF operation deadline closes the browser and rejects a late result",async()=>{
 const pending=gate(),f=fake("pending-pdf",pending.wait),r=renderer(f,{renderTimeoutMs:30,closeTimeoutMs:50});
 await assert.rejects(r.render(row,job),code("REPORT_PDF_TIMEOUT"));pending.open();await flush();assert.equal(f.facts.closes,1);assert.equal(r.snapshot().completed,0);
});
test("download render budget is shorter without changing worker budgets", async () => {
 const f=fake("pending-fonts",new Promise(()=>{})),r=renderer(f);
 await assert.rejects(r.render(row,job,"fr",{renderTimeoutMs:20}),code("REPORT_PDF_TIMEOUT"));
 assert.equal(f.facts.launchOptions.timeout,20);assert.equal(f.facts.closes,1);assert.equal(r.snapshot().active,0);
 await assert.rejects(r.render(row,job,"fr",{renderTimeoutMs:45001}),/PDF_BUDGET_INVALID/);
});
test("PDF launch completing after the deadline is quarantined then closed before capacity is reused",async()=>{
 const pending=gate(),f=fake("late-launch",pending.wait),r=renderer(f,{renderTimeoutMs:30,closeTimeoutMs:50});
 await assert.rejects(r.render(row,job),code("REPORT_PDF_TIMEOUT"));assert.equal(r.snapshot().quarantined,true);
 await assert.rejects(r.render(row,job),code("REPORT_PDF_BUSY"));assert.equal(f.facts.launches,1);
 pending.open();await flush();await flush();assert.equal(f.facts.closes,1);assert.equal(r.snapshot().active,0);
});
test("PDF cleanup error quarantines the instance instead of starting another browser",async()=>{
 const f=fake("close-error"),r=renderer(f);await assert.rejects(r.render(row,job),code("REPORT_PDF_CLEANUP"));
 assert.equal(r.snapshot().quarantined,true);await assert.rejects(r.render(row,job),code("REPORT_PDF_BUSY"));assert.equal(f.facts.launches,1);
});
test("PDF stuck cleanup is bounded and releases capacity only after the real close promise resolves",async()=>{
 const pending=gate(),f=fake("pending-close",pending.wait),r=renderer(f,{renderTimeoutMs:1000,closeTimeoutMs:30});
 await assert.rejects(r.render(row,job),code("REPORT_PDF_CLEANUP"));assert.equal(r.snapshot().active,1);await assert.rejects(r.render(row,job),code("REPORT_PDF_BUSY"));
 pending.open();await flush();assert.equal(r.snapshot().active,0);assert.equal(f.facts.closes,1);
});
test("PDF concurrent requests receive immediate backpressure without a second browser or unbounded waiting queue",async()=>{
 const pending=gate(),f=fake("pending-pdf",pending.wait),r=renderer(f),first=r.render(row,job);await flush();
 await assert.rejects(r.render(row,job),code("REPORT_PDF_BUSY"));assert.equal(f.facts.launches,1);pending.open();await first;assert.equal(r.snapshot().active,0);
});
test("Wrong serverless Chromium major is closed before page creation",async()=>{
 const f=fake("version"),r=renderer(f);await assert.rejects(r.render(row,job),code("REPORT_PDF_BROWSER_VERSION"));assert.equal(f.facts.closes,1);assert.equal(f.facts.pageOptions,undefined);
});
test("Untagged or malformed PDF output is rejected and never silently replaces the accessible report",async()=>{
 const f=fake("untagged"),r=renderer(f);await assert.rejects(r.render(row,job),code("REPORT_PDF_INVALID"));assert.equal(f.facts.closes,1);
});
test("PDF preparation failure does not launch a browser or retain the capacity slot",async()=>{
 const f=fake(),r=createReportPdfRenderer({runtime:f.runtime,html:async()=>{throw Error("ASSET_FAILURE")}});
 await assert.rejects(r.render(row,job));assert.equal(f.facts.launches,0);assert.equal(r.snapshot().active,0);
});
test("PDF browser configuration fails closed without silently substituting an unqualified runtime",async t=>{
 const old=process.env.REPORT_PDF_BROWSER_MODE;t.after(()=>{if(old===undefined)delete process.env.REPORT_PDF_BROWSER_MODE;else process.env.REPORT_PDF_BROWSER_MODE=old});
 process.env.REPORT_PDF_BROWSER_MODE="invalid";await assert.rejects(resolvePdfBrowser(),code("REPORT_PDF_CONFIGURATION"));
 if(process.platform!=="linux"||process.arch!=="x64"){process.env.REPORT_PDF_BROWSER_MODE="serverless";await assert.rejects(resolvePdfBrowser(),code("REPORT_PDF_CONFIGURATION"))}
});
