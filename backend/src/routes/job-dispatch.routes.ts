import express from "express";
import { DISPATCH_PATH, dispatchAuthenticated, dispatchSecret } from "../security/dispatch-auth.js";
import { configuredDispatch, DispatchBusy, type DispatchResult } from "../services/job-dispatch.service.js";

export function jobDispatchRouter(execute: (signal: AbortSignal) => Promise<DispatchResult> = configuredDispatch) {
  const router = express.Router();
  router.all(DISPATCH_PATH, async (req, res) => {
    let secret: string;
    try { secret = dispatchSecret(); } catch { res.status(503).json({ code: "DISPATCH_DISABLED" }); return; }
    const authCount = req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === "authorization").length;
    if (authCount !== 1 || !dispatchAuthenticated(req.headers.authorization, secret)) { res.status(401).json({ code: "DISPATCH_UNAUTHORIZED" }); return; }
    if (!["GET", "POST"].includes(req.method) || req.originalUrl !== DISPATCH_PATH || req.headers["transfer-encoding"] !== undefined ||
      ![undefined, "0"].includes(req.headers["content-length"]) || req.headers["content-encoding"] !== undefined) {
      res.status(400).json({ code: "DISPATCH_REQUEST_INVALID" }); return;
    }
    const controller = new AbortController(), abort = () => controller.abort(), closed = () => { if (!res.writableEnded) abort(); };
    req.once("aborted", abort); res.once("close", closed);
    try {
      const result = await execute(controller.signal);
      res.status(result.stop === "PARTIAL" ? 503 : 200).json(result);
    } catch (error) {
      if (error instanceof DispatchBusy) res.setHeader("Retry-After", "10");
      res.status(error instanceof DispatchBusy ? 429 : 503).json({ code: error instanceof DispatchBusy ? "DISPATCH_BUSY" : "DISPATCH_UNAVAILABLE" });
    } finally { req.off("aborted", abort); res.off("close", closed); }
  });
  return router;
}
