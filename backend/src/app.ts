import express from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit, socketRateLimitKey } from "./security/http-rate-limit.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { participantRouter } from "./routes/participant.routes.js";
import { adminRouter } from "./routes/admin/index.js";
import { adaptiveRouter } from "./routes/adaptive.routes.js";
import { proxyNetwork } from "./security/proxy-network.js";
import { digest } from "../../shared/network-proof.mjs";
import { qstashRouter } from "./routes/qstash.routes.js";
import { MAINTENANCE_PREFIX, maintenanceRouter } from "./routes/maintenance.routes.js";
import { SYNTHETIC_PREFIX, syntheticStagingRouter } from "./routes/synthetic-staging.routes.js";
import { stagingConfiguration } from "./security/synthetic-staging.js";
import { syntheticBoundary } from "./security/synthetic-boundary.js";
import { jobDispatchRouter } from "./routes/job-dispatch.routes.js";
import { logDispatchPreflight } from "./services/job-dispatch.service.js";
import { diagnosticId, logOtpEvent, withOtpContext } from "./services/otp-diagnostic.service.js";

stagingConfiguration(); // Invalid explicit activation fails at import, never falls back.

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use((req, res, next) => {
  if (req.method !== "POST" || req.path !== "/api/v1/adaptive/start") return next();
  // Correlation only: this header grants no trust, identity or authorization.
  const requestId = diagnosticId(req.headers["x-skillquest-request-id"]);
  withOtpContext({ requestId }, () => {
    const started = performance.now();
    logOtpEvent("START_RECEIVED", "started");
    res.once("finish", () => logOtpEvent("START_FINISHED", [409, 429].includes(res.statusCode) ? "waiting" : res.statusCode >= 400 ? "failed" : "ok",
      { requestId, httpStatus: res.statusCode, durationMs: performance.now() - started }));
    res.once("close", () => {
      if (!res.writableEnded) logOtpEvent("START_FINISHED", "uncertain", { requestId, code: "ABORTED", durationMs: performance.now() - started });
    });
    next();
  });
});
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 50000, keyGenerator: socketRateLimitKey, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Service temporairement limité. Réessayez plus tard." } }));

// En-têtes de sécurité HTTP stricts
app.use(
  helmet({
    contentSecurityPolicy: false, // géré côté frontend Next.js
    crossOriginEmbedderPolicy: false,
  })
);

// Authenticate maintenance before CORS preflight and any body parser. Routes
// never accept browser-selected commands, limits or destinations.
app.use(SYNTHETIC_PREFIX, syntheticStagingRouter());
app.use(MAINTENANCE_PREFIX,maintenanceRouter());
app.use(jobDispatchRouter());

// Configuration CORS sécurisée
const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      // Autoriser requêtes serveur-à-serveur (sans origin) ou origines configurées
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(Object.assign(new Error("CORS_FORBIDDEN"), { status: 403 }));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Browser clients send plain JSON. Reject compression before constructing a
// decoder, including malformed compressed frames and decompression bombs.
// Dedicated callback consumes authenticated RAW bytes before the JSON parser.
app.use(qstashRouter());
app.use(express.json({ limit: "2mb", inflate: false, verify: (_req, res, buffer) => {
  (res as express.Response).locals.proxyBodyHash = digest(buffer);
} }));

// Health Check avec test de connectivité base de données
app.use(syntheticBoundary);
app.get("/api/v1/health", async (_req, res) => {
  logDispatchPreflight();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      service: "skillquest-api",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      service: "skillquest-api",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api/v1", participantRouter);
app.use("/api/v1/adaptive", proxyNetwork, adaptiveRouter);
app.use("/api/v1/admin", adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Ressource introuvable." });
});

// Gestionnaire d'erreurs global sans fuite de secrets ni de stack traces
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("API error:", error instanceof Error ? error.name : "UnknownError");
  const candidate = error as { status?: number };
  const status = candidate.status && [400, 403, 413, 415].includes(candidate.status) ? candidate.status : 500;

  res.status(status).json({ error: status === 500 ? "Une erreur interne est survenue. Veuillez réessayer ultérieurement." : status === 413 ? "Le contenu dépasse la taille autorisée." : status === 415 ? "Envoyez le contenu JSON sans compression." : "Requête invalide ou origine non autorisée." });
});

