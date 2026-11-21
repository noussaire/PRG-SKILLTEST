import { prisma } from "../db/prisma.js";
import { aiConfigured, AIServiceError } from "./adaptive.service.js";

export async function reserveReportRequest() {
  if (!aiConfigured()) throw new AIServiceError("AI_NOT_CONFIGURED", 503, "La synthèse IA n’est pas configurée.");
  const setting = process.env.AI_DAILY_REQUEST_LIMIT ?? "400";
  if (!/^\d+$/.test(setting) || !Number.isSafeInteger(Number(setting)) || Number(setting) < 1) throw new AIServiceError("AI_CONFIGURATION", 503, "Budget IA invalide.");
  const day = new Date().toISOString().slice(0, 10), limit = Number(setting);
  const reserved = await prisma.$queryRaw<Array<{ requests: number }>>`
    INSERT INTO "AdaptiveDailyUsage" ("day", "requests") VALUES (${day}, 1)
    ON CONFLICT ("day") DO UPDATE SET "requests" = "AdaptiveDailyUsage"."requests" + 1
    WHERE "AdaptiveDailyUsage"."requests" < ${limit} RETURNING "requests"
  `;
  if (!reserved.length) {
    const midnight = new Date(); midnight.setUTCHours(24, 0, 0, 0);
    throw new AIServiceError("AI_DAILY_LIMIT", 429, "Budget de synthèses IA atteint.", Math.max(1, Math.ceil((midnight.getTime() - Date.now()) / 1000)), "day");
  }
}
