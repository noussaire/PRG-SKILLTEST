import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAdminAuth } from "../../security/adminAuth.js";
import { adaptiveDashboard } from "../../services/adaptive-admin.service.js";

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireAdminAuth);
adminDashboardRouter.get("/", async (req, res) => {
  const language = z.enum(["fr", "ar"]).default("fr").safeParse(req.query.lang);
  if (!language.success) return void res.status(400).json({ error: "Langue invalide." });
  const rows = await prisma.adaptiveInterview.findMany({
    select: { id: true, displayName: true, email: true, state: true, createdAt: true, updatedAt: true, expiresAt: true, reportJob: { select: { status: true, summary: true, nextAttemptAt: true, updatedAt: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  res.json(adaptiveDashboard(rows, language.data));
});
