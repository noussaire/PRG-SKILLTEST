import { prisma } from "../db/prisma.js";
import { EmailBudget } from "./email-budget.service.js";

export const EMAIL_RETENTION_INTERVAL_MS = 3600000;

// Startup catch-up and hourly bounded batches. The shared budget lock serializes
// different processes; this guard prevents overlapping runs in this process.
export function startEmailRetention(purge: () => Promise<unknown> = () => new EmailBudget(prisma).purgeExpiredData()) {
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await purge(); }
    catch { console.error("Email retention cleanup temporarily unavailable"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, EMAIL_RETENTION_INTERVAL_MS);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
