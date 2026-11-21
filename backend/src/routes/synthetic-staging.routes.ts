import express from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { verifyAdminToken } from "../security/adminAuth.js";
import { assertSyntheticDatabase, openSyntheticMail, stagingConfiguration, stagingProof, syntheticEmail, validStagingProof } from "../security/synthetic-staging.js";
import { JobPublications } from "../services/job-publication.service.js";
import { SyntheticQstashPublisher } from "../services/synthetic-providers.service.js";
import { jobRequestSchema } from "../services/job-request.js";
import { processJob } from "../services/job-processing.service.js";
import { publishSyntheticOtp } from "../services/synthetic-otp-publication.service.js";
import { receiveSyntheticOtp } from "../services/synthetic-otp-receive.service.js";
import { type ReceiveStep, extractCorrelationId, logReceiveDiagnostic } from "../security/synthetic-receive-diagnostic.js";

export const SYNTHETIC_PREFIX = "/api/internal/synthetic";
const empty = z.object({}).strict(), identified = z.object({ id: z.string().uuid() }).strict();
const paths = new Set(["/status", "/mail/read", "/jobs/run", "/notifications/publish", "/notifications/publish-otp", "/notifications/receive", "/cleanup"]);
export function syntheticStagingRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("Pragma", "no-cache");
    try { if (!stagingConfiguration()) { res.sendStatus(404); return; } }
    catch { res.status(503).json({ code: "SYNTHETIC_STAGING_UNAVAILABLE" }); return; }
    if (req.method !== "POST" || !paths.has(req.url) || req.originalUrl !== SYNTHETIC_PREFIX + req.url) { res.sendStatus(404); return; }
    if (req.headers["content-encoding"] || !req.is("application/json")) { res.sendStatus(415); return; }
    next();
  });
  router.use(express.raw({ type: "application/json", limit: "8kb", inflate: false }));
  router.use(async (req, res) => {
    const count = (name: string) => req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name).length;
    const names = ["authorization", "x-skillquest-staging-id", "x-skillquest-staging-time", "x-skillquest-staging-proof"];
    if (names.some(n => count(n) !== 1)) { res.sendStatus(401); return; }
    const [authorization, id, timestamp, proof] = names.map(n => req.headers[n]);
    if (typeof authorization !== "string" || !/^Bearer [a-f0-9]{64}$/.test(authorization) || typeof id !== "string" || !z.string().uuid().safeParse(id).success ||
        typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp) || typeof proof !== "string" || !Buffer.isBuffer(req.body)) { res.sendStatus(401); return; }
    const isReceive = req.url === "/notifications/receive";
    let admissionStep: ReceiveStep = "ADMISSION_DB_ASSERTION";
    const correlationId = extractCorrelationId(req, id);
    try {
      if (!validStagingProof(proof, stagingProof(req.method, req.originalUrl, req.body, authorization, id, timestamp))) { res.sendStatus(401); return; }
      admissionStep = "ADMISSION_DB_ASSERTION";
      await assertSyntheticDatabase(prisma);
      admissionStep = "ADMISSION_ADMIN_SESSION";
      const admin = await verifyAdminToken(authorization.slice(7));
      if (!admin || !syntheticEmail(admin.email)) { res.sendStatus(401); return; }
      const actor = createHash("sha256").update(authorization).digest("hex");
      admissionStep = "ADMISSION_ANTI_REPLAY";
      const accepted = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='2000ms'`);
        await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text`, actor);
        const [{ count: recent }] = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "SyntheticInvocation"
          WHERE actor=$1 AND "createdAt">(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute'`, actor);
        if (recent >= 30) return "RATE";
        const used = await tx.$executeRawUnsafe(`INSERT INTO "SyntheticInvocation" (id,actor,"expiresAt")
          SELECT $1::uuid,$2,(clock_timestamp() AT TIME ZONE 'UTC')+interval '24 hours'
          WHERE $3::float8 BETWEEN extract(epoch FROM clock_timestamp())*1000-60000 AND extract(epoch FROM clock_timestamp())*1000+5000
          ON CONFLICT DO NOTHING`, id, actor, Number(timestamp));
        return used === 1 ? "OK" : "REPLAY";
      }, { maxWait: 2000, timeout: 4000 });
      if (accepted !== "OK") { res.status(accepted === "RATE" ? 429 : 409).json({ code: `SYNTHETIC_${accepted}` }); return; }
      let body: unknown;
      try { body = JSON.parse(req.body.toString("utf8")); } catch { res.sendStatus(400); return; }
      if (req.url === "/status") {
        empty.parse(body);
        const notifications = await prisma.$queryRawUnsafe(`SELECT id,payload,"receivedAt",disposition FROM "SyntheticNotification" ORDER BY "createdAt" DESC,id LIMIT 20`);
        const mail = await prisma.$queryRawUnsafe(`SELECT id,purpose,"expiresAt" FROM "SyntheticMail" WHERE "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY "createdAt" DESC,id LIMIT 20`);
        res.json({ simulated: true, notifications, mail }); return;
      }
      if (req.url === "/mail/read") {
        const { id: mailId } = identified.parse(body);
        const [mail] = await prisma.$queryRawUnsafe<{ ciphertext: string }[]>(`SELECT ciphertext FROM "SyntheticMail" WHERE id=$1::uuid AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')`, mailId);
        if (!mail) { res.sendStatus(404); return; }
        // Only this doubly authenticated response can expose a synthetic OTP.
        res.json(openSyntheticMail(mailId, mail.ciphertext)); return;
      }
      if (req.url === "/jobs/run") {
        const job = jobRequestSchema.parse(body); await processJob(job);
        res.json({ simulated: true, attemptReturned: true }); return;
      }
      if (req.url === "/notifications/publish-otp") {
        res.json(await publishSyntheticOtp(prisma, body)); return;
      }
      if (req.url === "/notifications/publish") {
        empty.parse(body);
        const result = await new JobPublications(prisma).publishBatch(new SyntheticQstashPublisher(prisma), 3);
        res.json({ simulated: true, ...result }); return;
      }
      if (req.url === "/notifications/receive") {
        res.json(await receiveSyntheticOtp(prisma, body, { correlationId })); return;
      }
      empty.parse(body);
      const removed = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='2000ms'`);
        const mail = await tx.$executeRawUnsafe(`WITH stale AS (SELECT id FROM "SyntheticMail" WHERE "expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED)
          DELETE FROM "SyntheticMail" m USING stale s WHERE m.id=s.id`);
        const invocations = await tx.$executeRawUnsafe(`WITH stale AS (SELECT id FROM "SyntheticInvocation" WHERE "expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED)
          DELETE FROM "SyntheticInvocation" m USING stale s WHERE m.id=s.id`);
        return { mail, invocations };
      }, { maxWait: 2000, timeout: 4000 });
      res.json({ simulated: true, removed });
    } catch (error) {
      if (error instanceof z.ZodError) { res.sendStatus(400); return; }
      if (isReceive && !(error as any)?.__receiveDiagnosticLogged) {
        logReceiveDiagnostic(admissionStep, error, correlationId);
      }
      res.status(503).json({ code: "SYNTHETIC_OPERATION_UNAVAILABLE" });
    }
  });
  return router;
}
