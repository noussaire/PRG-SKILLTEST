import { emitKeypressEvents } from "node:readline";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../security/passwords.js";

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("TTY_REQUIRED");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      process.stdin.removeListener("keypress", listener);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const listener = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        done();
        reject(new Error("CANCELLED"));
        return;
      }
      if (key.name === "return") {
        done();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (text && !key.ctrl && !text.includes("\u001b") && value.length < 1024)
        value += text;
    };
    process.stdin.on("keypress", listener);
  });
}
let hasError = false;
try {
  const email = z.string().email().parse(process.argv[2]?.trim().toLowerCase());
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== "ADMIN") throw new Error("ADMIN_NOT_FOUND");
  const password = await readHidden(
    "Nouveau mot de passe (saisie masquée, 12 caractères minimum) : ",
  );
  if (password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
  if (password !== (await readHidden("Confirmer le mot de passe : ")))
    throw new Error("PASSWORD_MISMATCH");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.adminSession.deleteMany({ where: { userId: user.id } });
  });
  console.log(
    "Mot de passe mis à jour avec succès. Les sessions de ce compte ont été révoquées.",
  );
} catch (error) {
  hasError = true;
  const messages: Record<string, string> = {
    TTY_REQUIRED: "Ouvrez un terminal interactif.",
    ADMIN_NOT_FOUND: "Compte administrateur introuvable.",
    PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 12 caractères.",
    PASSWORD_MISMATCH: "Les mots de passe ne correspondent pas.",
    CANCELLED: "Opération annulée.",
  };
  console.error(
    messages[error instanceof Error ? error.message : ""] ??
      "Réinitialisation impossible. Vérifiez l'adresse et la configuration.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (hasError) {
    process.exit(1);
  }
}
