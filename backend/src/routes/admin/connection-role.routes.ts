import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireReadOnlyAdminAuth } from "../../security/adminAuth.js";

export const adminConnectionRoleRouter = Router();
adminConnectionRoleRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
adminConnectionRoleRouter.get("/", requireReadOnlyAdminAuth, async (_req, res) => {
  try {
    // Same singleton as configuredDispatch. No application jobs or providers.
    const rows = await prisma.$queryRaw<{ is_app: boolean; is_runtime: boolean }[]>`SELECT
current_user = 'skillquest_app' AS is_app,
current_user = 'skillquest_runtime' AS is_runtime`;
    if (rows.length !== 1 || typeof rows[0].is_app !== "boolean" || typeof rows[0].is_runtime !== "boolean") {
      res.status(503).json({ error: "Diagnostic indisponible." });
      return;
    }
    res.json({ is_app: rows[0].is_app, is_runtime: rows[0].is_runtime });
  } catch {
    res.status(503).json({ error: "Diagnostic indisponible." });
  }
});
