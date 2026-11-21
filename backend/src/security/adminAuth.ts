import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import type { User } from "@prisma/client";

export interface AuthenticatedAdminRequest extends Request {
  admin?: User;
}

export function createAdminToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashAdminToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyAdminToken(token: string, options: { cleanupExpired?: boolean } = {}): Promise<User | null> {
  if (!token || typeof token !== "string" || token.length !== 64) {
    return null;
  }
  const tokenHash = hashAdminToken(token);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    if (options.cleanupExpired !== false) await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }
  if (session.user.role !== "ADMIN") {
    return null;
  }

  return session.user;
}

export async function requireAdminAuth(
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  return authenticateAdmin(req, res, next, true);
}

// Same authentication and session store, without expired-session cleanup writes.
export async function requireReadOnlyAdminAuth(
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try { await authenticateAdmin(req, res, next, false); }
  catch { res.status(503).json({ error: "Diagnostic indisponible." }); }
}

async function authenticateAdmin(
  req: AuthenticatedAdminRequest, res: Response, next: NextFunction, cleanupExpired: boolean
): Promise<void> {
  const authHeader = req.headers.authorization;
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(authHeader ?? "");
  const token = match?.[1];

  if (!token) {
    res.status(401).json({ error: "Accès administrateur non autorisé. Jeton manquant." });
    return;
  }

  const user = await verifyAdminToken(token, { cleanupExpired });
  if (!user) {
    res.status(401).json({ error: "Session administrateur expirée ou invalide." });
    return;
  }

  req.admin = user;
  next();
}
