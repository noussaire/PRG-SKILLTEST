import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { assertSyntheticDatabase, stagingConfiguration, syntheticEmail, syntheticName } from "./synthetic-staging.js";

export const syntheticBoundary: RequestHandler = async (req, res, next) => {
  try {
    if (!stagingConfiguration()) { next(); return; }
    await assertSyntheticDatabase(prisma);
    const visit = (value: unknown, depth = 0): boolean => {
      if (depth > 12) return false;
      if (!value || typeof value !== "object") return true;
      return Object.entries(value).every(([key, field]) => {
        if (["email", "emailIdentity"].includes(key) && field !== null) return typeof field === "string" && syntheticEmail(field);
        if (["displayName", "fullName"].includes(key)) return typeof field === "string" && syntheticName(field);
        return visit(field, depth + 1);
      });
    };
    if (!visit(req.body)) { res.status(400).json({ code: "SYNTHETIC_IDENTITY_REQUIRED" }); return; }
    next();
  } catch { res.status(503).json({ code: "SYNTHETIC_STAGING_UNAVAILABLE" }); }
};
