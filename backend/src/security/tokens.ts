import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";

const scrypt = promisify(scryptCb);
export const normalizeJoinCode = (code: string): string => code.trim().toUpperCase();
export const hashJoinCode = (code: string): string =>
  createHmac("sha256", env.JOIN_CODE_PEPPER).update(normalizeJoinCode(code)).digest("hex");
export const createGuestToken = (): string => randomBytes(32).toString("hex");
export const hashGuestToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const createPublicId = (): string => `SQ-${randomBytes(6).toString("hex").toUpperCase()}`;

// Génération d'un code de session unique non ambigu (ex: SQ-7K4M-9B2X)
export function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let p1 = "";
  let p2 = "";
  for (let i = 0; i < 4; i++) p1 += chars[bytes[i] % chars.length];
  for (let i = 4; i < 8; i++) p2 += chars[bytes[i] % chars.length];
  return `SQ-${p1}-${p2}`;
}

// Chiffrement AES-256-GCM du code pour stockage non-clair dans PostgreSQL
export function encryptCode(code: string): string {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(env.JOIN_CODE_PEPPER).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

// Déchiffrement AES-256-GCM sécurisé
export function decryptCode(cipherText: string | null): string | null {
  if (!cipherText) return null;
  try {
    const [ivHex, tagHex, dataHex] = cipherText.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = createHash("sha256").update(env.JOIN_CODE_PEPPER).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

// Hachage et vérification des mots de passe administrateurs (isolé dans passwords.ts)
export { hashPassword, verifyPassword } from "./passwords.js";

