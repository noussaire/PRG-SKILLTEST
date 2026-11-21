import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/**
 * Hache un mot de passe en utilisant l'algorithme scrypt avec un sel aléatoire de 16 octets.
 * Ce module est totalement isolé des variables d'environnement applicatives pour permettre
 * les opérations d'administration et de maintenance hors-ligne (ex: reset-admin-password).
 *
 * Format du hash stocké : scrypt:<salt_hex_32>:<derived_hex_128>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/**
 * Vérifie un mot de passe candidat contre le hash scrypt stocké en base.
 * Utilise timingSafeEqual pour immuniser contre les attaques par canal auxiliaire (timing attacks).
 */
export async function verifyPassword(password: string, saved: string): Promise<boolean> {
  const [algorithm, salt, digest] = saved.split(":");
  if (algorithm !== "scrypt" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  if (expected.length !== 64) return false;
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, actual);
}
