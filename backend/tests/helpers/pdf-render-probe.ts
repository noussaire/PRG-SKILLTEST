import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {createPreparedInterview,advancePreparedInterview} from "../../src/services/prepared-interview.service.js";
import {createReportPdfRenderer,printableReportHTML} from "../../src/services/report-pdf.service.js";
import {resolvePdfBrowser} from "../../src/services/report-browser.service.js";

globalThis.fetch=()=>{throw Error("ALL_EXTERNAL_FETCH_FORBIDDEN")};
const run=process.argv[2];assert.ok(run);const browserVersions=new Set<string>();
const runtime=async()=>{const selected=await resolvePdfBrowser();return {...selected,launch:async(options:Parameters<typeof selected.launch>[0])=>{const browser=await selected.launch(options);browserVersions.add(browser.version());return browser}}};
const renderer=createReportPdfRenderer({runtime});
function fixture(language:"fr"|"ar") {
 let state=createPreparedInterview(language);while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
 const mixed="سَلَامٌ — لا، لأ، لإ، لآ — 0123456789 / ٠١٢٣٤٥٦٧٨٩ — Français/العربية";
 const fr=("Une phrase synthétique assez longue pour vérifier les retours à la ligne et les sauts de page. "+mixed+". ").repeat(12);
 const ar=("نص تجريبي طويل لاختبار وصل الحروف والصفحات مع الكلمات الفرنسية et les accents é è ç. "+mixed+". ").repeat(12);
 return {row:{id:randomUUID(),displayName:"Étudiante synthétique سلمى عبد الرحمن 0123456789",state:state as never,expiresAt:new Date(Date.now()+86400000)},
  job:{status:"COMPLETE",summary:JSON.stringify({fr,ar}),nextAttemptAt:new Date()}};
}
const result:any={platform:process.platform,arch:process.arch,node:process.version,mode:process.env.REPORT_PDF_BROWSER_MODE,linuxExecuted:process.platform==="linux",renders:[]};
process.send?.({ready:true});await new Promise<void>(r=>process.once("message",()=>r()));
try {
 for(const language of ["fr","ar"] as const){const f=fixture(language),at=performance.now(),rssBefore=process.memoryUsage().rss;
  const pdf=await renderer.render(f.row,f.job);await writeFile(join(run,language+".pdf"),pdf);
  const html=await printableReportHTML(f.row,f.job);assert.match(html,/Content-Security-Policy/);assert.equal(html.match(/<section /g)?.length,31);
  const structure=pdf.toString("latin1"),pages=structure.match(/\/Type \/Page\b/g)?.length??0;assert.ok(pages>=3&&pages<=25);
  result.renders.push({language,durationMs:performance.now()-at,pdfBytes:pdf.length,pages,nodeRssBefore:rssBefore,nodeRssAfter:process.memoryUsage().rss,tagged:structure.includes("/StructTreeRoot"),fontEmbedded:/\/FontFile[23]\b/.test(structure)});
 }
 const f=fixture("fr"),concurrent=await Promise.allSettled(Array.from({length:3},()=>renderer.render(f.row,f.job)));
 assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(concurrent.filter(r=>r.status==="rejected"&&(r.reason as any).code==="REPORT_PDF_BUSY").length,2);
 result.concurrency={submitted:3,completed:1,busy:2,snapshot:renderer.snapshot()};
 let closed=false;
 const interrupted=createReportPdfRenderer({runtime:async()=>{const selected=await runtime();return {...selected,launch:async options=>{
  const b=await selected.launch(options),newPage=b.newPage.bind(b),close=b.close.bind(b);
  b.close=async options=>{await close(options);closed=!b.isConnected()};b.newPage=async options=>{const p=await newPage(options);p.pdf=async()=>{throw Error("CONTROLLED_PDF_INTERRUPTION")};return p};return b;
 }}}});
 await assert.rejects(interrupted.render(f.row,f.job));assert.equal(closed,true);assert.equal(interrupted.snapshot().active,0);
 result.controlledInterruption={closed:true};result.browserVersions=[...browserVersions];result.success=true;
} catch(error){result.success=false;result.error=error instanceof Error?error.message:"PDF_QUALIFICATION_FAILED";process.exitCode=1}
await writeFile(join(run,"renders.json"),JSON.stringify(result,null,2));process.send?.({done:true});await new Promise(r=>setTimeout(r,500));
process.disconnect?.();
