import express from "express";
import { authenticateMaintenance, maintenanceSecret } from "../security/maintenance-auth.js";
import { MaintenanceInvocationError, type MaintenanceTask } from "../services/maintenance-invocation.service.js";
import type { MaintenanceResult } from "../services/maintenance.service.js";

export const MAINTENANCE_PREFIX="/api/internal/maintenance";
const paths:Record<string,MaintenanceTask>={
  [`${MAINTENANCE_PREFIX}/reconcile`]:"reconcile",[`${MAINTENANCE_PREFIX}/cleanup`]:"cleanup",[`${MAINTENANCE_PREFIX}/sessions`]:"sessions",
};
type Executor=(task:MaintenanceTask,id:string,signal:AbortSignal)=>Promise<MaintenanceResult>;
export function maintenanceRouter(execute:Executor=async(task,id,signal)=>{
  const {prisma}=await import("../db/prisma.js");
  const {MaintenanceInvocations}=await import("../services/maintenance-invocation.service.js");
  return new MaintenanceInvocations(prisma).run(task,id,signal);
}){
  const router=express.Router();
  router.use(async(req,res)=>{
    res.setHeader("Cache-Control","private, no-store");res.setHeader("Pragma","no-cache");
    let secret:string;
    try{secret=maintenanceSecret();}catch{res.status(503).json({code:"MAINTENANCE_DISABLED"});return;}
    const count=(name:string)=>req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()===name).length;
    if(count("authorization")!==1||!authenticateMaintenance(req.headers.authorization,secret)){res.status(401).json({code:"MAINTENANCE_UNAUTHORIZED"});return;}
    const task=Object.hasOwn(paths,req.originalUrl)?paths[req.originalUrl]:undefined;
    if(!task){res.status(req.originalUrl.includes("?")?400:404).json({code:"MAINTENANCE_ROUTE_INVALID"});return;}
    if(!["GET","POST"].includes(req.method)){res.setHeader("Allow","GET, POST");res.status(405).json({code:"MAINTENANCE_METHOD_INVALID"});return;}
    const id=req.headers["x-skillquest-maintenance-id"];
    if(count("x-skillquest-maintenance-id")!==1||typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||
      req.headers["transfer-encoding"]!==undefined||![undefined,"0"].includes(req.headers["content-length"])||req.headers["content-encoding"]!==undefined){res.status(400).json({code:"MAINTENANCE_REQUEST_INVALID"});return;}
    const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort()};
    req.once("aborted",abort);res.once("close",closed);
    try {
      const result=await execute(task,id,controller.signal);
      if(!res.destroyed)res.status(["FAILED","ABORTED","DEADLINE"].includes(result.stop)?503:200).json(result);
    } catch(error){
      if(res.destroyed)return;
      if(error instanceof MaintenanceInvocationError){
        if(error.retryAfter)res.setHeader("Retry-After",String(error.retryAfter));
        res.status(error.code==="COOLDOWN"?429:error.code==="LEASE_LOST"?503:409).json({code:`MAINTENANCE_${error.code}`});
      }else res.status(500).json({code:"MAINTENANCE_UNAVAILABLE"});
    }finally{req.off("aborted",abort);res.off("close",closed);}
  });
  return router;
}
