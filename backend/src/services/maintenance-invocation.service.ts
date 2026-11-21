import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { runMaintenance, type MaintenanceOptions, type MaintenanceResult } from "./maintenance.service.js";
import type { MaintenanceFence } from "./maintenance-control.js";

export type MaintenanceTask = "reconcile"|"cleanup"|"sessions";
const tasks:Record<MaintenanceTask,MaintenanceOptions> = {
  reconcile:{stages:["otpInitial","otpRetake","reportSummary","reportEmail","missingReports","missingIntents","staleIntents","rearm"],batchSize:25,maxBatches:16,maxRows:1000,budgetMs:5000,sqlTimeoutMs:1000},
  cleanup:{stages:["nonces","retention","technicalRetention"],batchSize:100,maxBatches:4,maxRows:1000,budgetMs:5000,sqlTimeoutMs:1000},
  sessions:{stages:["sessions"],batchSize:25,maxBatches:4,maxRows:100,budgetMs:5000,sqlTimeoutMs:1000},
};
export class MaintenanceInvocationError extends Error {
  constructor(readonly code:"REPLAY"|"BUSY"|"COOLDOWN"|"LEASE_LOST",readonly retryAfter=0){super(`MAINTENANCE_${code}`)}
}
const clock=`(clock_timestamp() AT TIME ZONE 'UTC')`;
type Lease={runId:string|null;attemptToken:string|null;leaseUntil:Date|null;remaining:number};

// A single global lease serializes all HTTP maintenance families. Its token is
// checked under row lock in EVERY 4A transaction, not merely at HTTP admission.
export class MaintenanceInvocations {
  constructor(private db:PrismaClient,private execute:typeof runMaintenance=runMaintenance){}
  private tx<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>){
    return this.db.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='1000ms'`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout='250ms'`);
      return work(tx);
    },{isolationLevel:"ReadCommitted",timeout:1500,maxWait:500});
  }
  private claim(task:MaintenanceTask,id:string){return this.tx(async tx=>{
    await tx.$executeRawUnsafe(`INSERT INTO "MaintenanceLease" (name) VALUES ('maintenance') ON CONFLICT DO NOTHING`);
    const [lease]=await tx.$queryRawUnsafe<Lease[]>(`SELECT *,GREATEST(0,ceil(extract(epoch FROM ("leaseUntil"-${clock}))))::int AS remaining FROM "MaintenanceLease" WHERE name='maintenance' FOR UPDATE`);
    const existing=await tx.$queryRawUnsafe<{id:string}[]>(`SELECT id FROM "MaintenanceRun" WHERE id=$1::uuid
      UNION ALL SELECT id FROM "MaintenanceReplayReceipt" WHERE id=$1::uuid`,id);
    if(existing.length)throw new MaintenanceInvocationError("REPLAY");
    if(lease.remaining>0)throw new MaintenanceInvocationError("BUSY",lease.remaining);
    await tx.$executeRawUnsafe(`INSERT INTO "MaintenanceTask" (task) VALUES ($1) ON CONFLICT DO NOTHING`,task);
    const [cooldown]=await tx.$queryRawUnsafe<{remaining:number}[]>(`SELECT GREATEST(0,ceil(extract(epoch FROM ("nextAllowedAt"-${clock}))))::int AS remaining FROM "MaintenanceTask" WHERE task=$1 FOR UPDATE`,task);
    if(cooldown.remaining>0)throw new MaintenanceInvocationError("COOLDOWN",cooldown.remaining);
    if(lease.runId)await tx.$executeRawUnsafe(`UPDATE "MaintenanceRun" SET state='INTERRUPTED',"finishedAt"=${clock},"stopCode"='LEASE_EXPIRED' WHERE id=$1::uuid AND "attemptToken"=$2::uuid AND state='RUNNING'`,lease.runId,lease.attemptToken);
    const token=randomUUID();
    await tx.$executeRawUnsafe(`INSERT INTO "MaintenanceRun" (id,task,"attemptToken",state) VALUES ($1::uuid,$2,$3::uuid,'RUNNING')`,id,task,token);
    await tx.$executeRawUnsafe(`UPDATE "MaintenanceLease" SET "runId"=$1::uuid,"attemptToken"=$2::uuid,"leaseUntil"=${clock}+interval '20 seconds' WHERE name='maintenance'`,id,token);
    return token;
  })}
  private fence(id:string,token:string):MaintenanceFence{return async tx=>{
    const active=await tx.$queryRawUnsafe<{name:string}[]>(`SELECT name FROM "MaintenanceLease" WHERE name='maintenance' AND "runId"=$1::uuid AND "attemptToken"=$2::uuid AND "leaseUntil">${clock} FOR UPDATE`,id,token);
    if(active.length!==1)throw new MaintenanceInvocationError("LEASE_LOST");
  }}
  private finish(task:MaintenanceTask,id:string,token:string,result:MaintenanceResult){return this.tx(async tx=>{
    await this.fence(id,token)(tx);
    const state=result.stop==="FAILED"?"FAILED":["DEADLINE","ABORTED"].includes(result.stop)?"PARTIAL":"COMPLETED";
    const changed=await tx.$executeRawUnsafe(`UPDATE "MaintenanceRun" SET state=$3,"finishedAt"=${clock},"stopCode"=$4 WHERE id=$1::uuid AND "attemptToken"=$2::uuid AND state='RUNNING'`,id,token,state,result.stop);
    if(changed!==1)throw new MaintenanceInvocationError("LEASE_LOST");
    await tx.$executeRawUnsafe(`UPDATE "MaintenanceTask" SET "nextAllowedAt"=${clock}+interval '60 seconds' WHERE task=$1`,task);
    await tx.$executeRawUnsafe(`UPDATE "MaintenanceLease" SET "runId"=NULL,"attemptToken"=NULL,"leaseUntil"=NULL WHERE name='maintenance' AND "runId"=$1::uuid AND "attemptToken"=$2::uuid`,id,token);
  })}
  async run(task:MaintenanceTask,id:string,signal?:AbortSignal):Promise<MaintenanceResult>{
    if(!Object.hasOwn(tasks,task))throw Error("MAINTENANCE_TASK_INVALID");
    z.string().uuid().parse(id);
    if(signal?.aborted)throw Error("MAINTENANCE_ABORTED");
    let token:string;
    try {token=await this.claim(task,id);}
    catch(error){
      // Only PostgreSQL lock contention at admission is a busy invocation.
      // Missing tables, SQL faults and connection failures remain technical errors.
      const issue=error as {code?:string;meta?:{code?:string}};
      if(issue.code==="P2010"&&issue.meta?.code==="55P03")throw new MaintenanceInvocationError("BUSY",1);
      throw error;
    }
    let result:MaintenanceResult;
    try {result=await this.execute(this.db,{...tasks[task],stages:[...tasks[task].stages!],signal},this.fence(id,token));}
    catch {result={stop:"FAILED",batches:0,rows:0,elapsedMs:0,stage:null,changed:{},oldestUnpublishedDueLagSeconds:null,errorCode:"MAINTENANCE_UNAVAILABLE"};}
    await this.finish(task,id,token,result);
    return result;
  }
}
