import { Router } from "express";
import { createHash } from "node:crypto";
import { rateLimit } from "../../security/http-rate-limit.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { verifyPassword } from "../../security/tokens.js";
import {
  createAdminToken,
  hashAdminToken,
  requireAdminAuth,
  type AuthenticatedAdminRequest,
} from "../../security/adminAuth.js";

export const adminAuthRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: req => createHash("sha256").update(String(req.body?.email ?? "").trim().toLowerCase()).digest("hex"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Réessayez dans 15 minutes." },
});

const loginSchema = z.object({
  email: z.string().trim().email("Format d'email invalide"),
  password: z.string().min(1, "Mot de passe requis").max(1024),
});

// POST /api/v1/admin/auth/login
adminAuthRouter.post("/login", loginLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Données invalides." });
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.role !== "ADMIN" || !user.passwordHash) {
      // Message générique pour éviter l'énumération des utilisateurs
      res.status(401).json({ error: "Identifiants administrateur incorrects." });
      return;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: "Identifiants administrateur incorrects." });
      return;
    }

    // Création d'une session administrateur de 7 jours
    const token = createAdminToken();
    const tokenHash = hashAdminToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.adminSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    res.status(200).json({
      token,
      admin: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Admin login failed:", error instanceof Error ? error.name : "UnknownError");
    res.status(500).json({ error: "Connexion temporairement indisponible." });
  }
});

// POST /api/v1/admin/auth/logout
adminAuthRouter.post("/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(authHeader ?? "");
  const token = match?.[1];

  if (token) {
    const tokenHash = hashAdminToken(token);
    await prisma.adminSession.deleteMany({
      where: { tokenHash },
    });
  }

  res.status(200).json({ success: true, message: "Déconnexion réussie." });
});

// GET /api/v1/admin/auth/me
adminAuthRouter.get("/me", requireAdminAuth, (req: AuthenticatedAdminRequest, res) => {
  if (!req.admin) {
    res.status(401).json({ error: "Non authentifié." });
    return;
  }
  res.status(200).json({
    admin: {
      id: req.admin.id,
      email: req.admin.email,
      role: req.admin.role,
    },
  });
});
