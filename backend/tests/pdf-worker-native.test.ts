import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {Prisma,PrismaClient} from "@prisma/client";
import {connectLot4NativeDatabase} from "./helpers/native-postgres.js";
import {createPreparedInterview,advancePreparedInterview} from "../src/services/prepared-interview.service.js";
import {ReportEmailError} from "../src/services/brevo.service.js";

const options={skip:process.env.LOT4_NATIVE_CONTEXT?false:"Owned temporary PostgreSQL required",timeout:60000};
let db:PrismaClient,other:PrismaClient,renderer:typeof import("../src/services/report-pdf.service.js").reportPdfRenderer;
let processJob:typeof import("../src/services/job-processing.service.js").processJob,calls:number;
const pdf=Buffer.from("%PDF-1.7\nSynthetic worker attachment\n%%EOF");
before(async()=>{if(options.skip)return;other=(await connectLot4NativeDatabase()).client;
 Object.assign(process.env,{NODE_ENV:"test",JOIN_CODE_PEPPER:"pdf5c-synthetic-pepper-0123456789abcdef",DOTENV_CONFIG_PATH:"output/pdf-linux-step5c-20261101/nonexistent.env"});
 ({prisma:db}=await import("../src/db/prisma.js"));({reportPdfRenderer:renderer}=await import("../src/services/report-pdf.service.js"));({processJob}=await import("../src/services/job-processing.service.js"));
});
beforeEach(async t=>{if(options.skip)return;calls=0;
 Object.assign(process.env,{BREVO_API_KEY:"synthetic-only",BREVO_SENDER_EMAIL:"sender@example.test",GROQ_API_KEY:"synthetic-only",EMAIL_ACCOUNT_DAILY_LIMIT:"300",EMAIL_OTHER_USAGE_MARGIN:"0",EMAIL_APP_DAILY_LIMIT:"300"});
 (t as import("node:test").TestContext).mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0])=>{assert.equal(String(input),"https://api.brevo.com/v3/smtp/email");calls++;return Response.json({messageId:"synthetic"},{status:201})});
 await db.$executeRawUnsafe(`TRUNCATE "JobPublicationIntent","AdaptiveInterview","EmailBudgetReservation","EmailAbuseCounter","EmailProviderState" CASCADE`);
});
after(async()=>{await db?.$disconnect();await other?.$disconnect()});
async function report(){let state=createPreparedInterview("fr");while(state.currentQuestion)state=advancePreparedInterview(state,{questionId:state.currentQuestion.id,choiceId:state.currentQuestion.choices![0].id});
 const row=await db.adaptiveInterview.create({data:{displayName:"Synthetic PDF worker",email:randomUUID()+"@example.test",reportEmailRequested:true,tokenHash:randomUUID(),state:state as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
 return db.adaptiveReportJob.create({data:{interviewId:row.id,status:"COMPLETE",summary:JSON.stringify({fr:"Synthèse.",ar:"خلاصة."}),emailStatus:"PENDING"}});
}
test("PDF capacity contention retains retry beyond six fencing attempts without reserving budget or sending",options,async t=>{
 const job=await report();await db.adaptiveReportJob.update({where:{id:job.id},data:{emailAttempts:6}});
 const mock=t.mock.method(renderer,"render",async()=>{throw new ReportEmailError("REPORT_PDF_BUSY",true,15)});
 await processJob({kind:"REPORT",jobId:job.id,phase:"EMAIL"});const deferred=await db.adaptiveReportJob.findUniqueOrThrow({where:{id:job.id}});
 assert.equal(deferred.emailStatus,"RETRY");assert.equal(deferred.emailAttempts,7);assert.equal(deferred.emailLeaseUntil,null);assert.equal(deferred.emailAttemptWindowAt,null);
 assert.equal(calls,0);assert.equal(await db.emailBudgetReservation.count(),0);mock.mock.restore();
 t.mock.method(renderer,"render",async()=>pdf);await db.adaptiveReportJob.update({where:{id:job.id},data:{emailNextAttemptAt:new Date()}});
 await processJob({kind:"REPORT",jobId:job.id,phase:"EMAIL"});await processJob({kind:"REPORT",jobId:job.id,phase:"EMAIL"});
 assert.equal(calls,1);assert.equal(await db.emailBudgetReservation.count(),1);assert.equal((await db.adaptiveReportJob.findUniqueOrThrow({where:{id:job.id}})).emailStatus,"SENT");
});
test("PDF deadline failure before provider contact creates neither reservation nor UNCERTAIN receipt",options,async t=>{
 const job=await report();t.mock.method(renderer,"render",async()=>{throw new ReportEmailError("REPORT_PDF_TIMEOUT",true,60)});
 await processJob({kind:"REPORT",jobId:job.id,phase:"EMAIL"});const row=await db.adaptiveReportJob.findUniqueOrThrow({where:{id:job.id}});
 assert.equal(row.emailStatus,"RETRY");assert.equal(row.emailAttemptWindowAt,null);assert.equal(row.emailLastErrorCode,"REPORT_PDF_TIMEOUT");assert.equal(calls,0);assert.equal(await db.emailBudgetReservation.count(),0);
});
test("A lease made stale during PDF preparation cannot reserve budget or send the prepared attachment",options,async t=>{
 const job=await report();t.mock.method(renderer,"render",async()=>{await other.adaptiveReportJob.update({where:{id:job.id},data:{emailLeaseUntil:new Date(Date.now()-1000)}});return pdf});
 await processJob({kind:"REPORT",jobId:job.id,phase:"EMAIL"});assert.equal(calls,0);assert.equal(await db.emailBudgetReservation.count(),0);
});
