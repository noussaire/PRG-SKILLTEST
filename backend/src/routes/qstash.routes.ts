import express from "express";
import { authenticateQstash, qstashConfiguration, QSTASH_CALLBACK_PATH, QstashConfigurationError } from "../security/qstash-signature.js";
import { parseNotification } from "../services/qstash-publisher.service.js";
import type { JobNotification } from "../services/job-publication.service.js";
import { QstashIntentError, type QstashDisposition } from "../services/qstash-consumer.service.js";
import { wakeJobs } from "../services/job-dispatch.service.js";
import { diagnosticId, logOtpEvent, safeOtpCode, withOtpContext } from "../services/otp-diagnostic.service.js";

export function qstashRouter(consume: (n:JobNotification)=>Promise<QstashDisposition> = async n => {
  const {prisma}=await import("../db/prisma.js");
  const {consumeQstash}=await import("../services/qstash-consumer.service.js");
  return consumeQstash(prisma,n);
}) {
  const router=express.Router();
  router.use(QSTASH_CALLBACK_PATH, (_req, _res, next) => withOtpContext({ requestId: diagnosticId() }, next));
  router.all(QSTASH_CALLBACK_PATH,(req,res,next)=>{
    try { qstashConfiguration(); } catch { logOtpEvent("WORKER_FAILED", "disabled", { code: "QSTASH_DISABLED" }); res.status(503).json({code:"QSTASH_DISABLED"});return; }
    if(req.method!=="POST"||req.originalUrl!==QSTASH_CALLBACK_PATH){logOtpEvent("WORKER_FAILED", "skipped", { code: "QSTASH_METHOD_OR_URL_INVALID" });res.status(405).json({code:"QSTASH_METHOD_OR_URL_INVALID"});return;}
    if(typeof req.headers["upstash-signature"]!=="string"){logOtpEvent("WORKER_FAILED", "failed", { code: "QSTASH_SIGNATURE_INVALID" });res.status(401).json({code:"QSTASH_SIGNATURE_INVALID"});return;}
    if(!req.is("application/json")){logOtpEvent("WORKER_FAILED", "skipped", { code: "QSTASH_JSON_REQUIRED" });res.status(415).json({code:"QSTASH_JSON_REQUIRED"});return;}
    next();
  },express.raw({type:"application/json",limit:"8kb",inflate:false}),async(req,res)=>{
    let config;
    try{config=qstashConfiguration();await authenticateQstash(req.headers["upstash-signature"],req.body,config);}
    catch(error){logOtpEvent("WORKER_FAILED", "failed", { code: "QSTASH_SIGNATURE_INVALID" });res.status(error instanceof QstashConfigurationError?503:401).json({code:"QSTASH_SIGNATURE_INVALID"});return;}
    let notification:JobNotification;
    try{notification=parseNotification(JSON.parse((req.body as Buffer).toString("utf8")));}
    catch{logOtpEvent("WORKER_FAILED", "failed", { code: "QSTASH_NOTIFICATION_INVALID" });res.status(400).json({code:"QSTASH_NOTIFICATION_INVALID"});return;}
    await withOtpContext({ traceId: notification.jobId }, async () => {
    logOtpEvent("WORKER_RECEIVED", "ok", { notificationId: notification.notificationId, code: "CALLBACK_ACCEPTED" });
    try{
      const disposition=await consume(notification),retry=disposition==="BUSY"||disposition==="DEFERRED";
      logOtpEvent("WORKER_FINISHED", retry ? "waiting" : disposition === "UNCERTAIN" ? "uncertain" : "ok", { code: disposition });
      await wakeJobs();
      if(retry)res.setHeader("Retry-After","30");
      res.status(retry?503:200).json({disposition});
    }catch(error){logOtpEvent("WORKER_FAILED", "failed", { code: safeOtpCode(error) });res.status(error instanceof QstashIntentError?409:500).json({code:error instanceof QstashIntentError?"QSTASH_INTENT_MISMATCH":"QSTASH_PROCESSING_UNAVAILABLE"});}
    });
  });
  return router;
}
