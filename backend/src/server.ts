import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { app } from "./app.js";
import { refreshSessionWindows } from "./services/session-scheduler.js";
import { startReportQueue } from "./services/report-queue.service.js";
import { startReportEmailQueue } from "./services/report-email-queue.service.js";
import { startOtpDeliveryQueue } from "./services/otp-delivery.service.js";
import { startEmailRetention } from "./services/email-retention.service.js";
import { assertProxyConfiguration } from "./security/proxy-network.js";
import { startProxyNonceRetention } from "./services/proxy-nonce-retention.service.js";
assertProxyConfiguration();
const stopProxyNonceRetention = startProxyNonceRetention();
const stopReportQueue = startReportQueue();
const stopReportEmailQueue = startReportEmailQueue();
const stopOtpDeliveryQueue = startOtpDeliveryQueue();
const stopEmailRetention = startEmailRetention();
const refresh = () => refreshSessionWindows().catch(() => console.error("Session scheduler unavailable"));
void refresh();
const scheduler = setInterval(refresh, 30000);
scheduler.unref();

const server = app.listen(env.PORT, () => {
  console.log(`SkillQuest API running: http://localhost:${env.PORT}/api/v1/health`);
});
async function shutdown() {
  stopReportQueue();
  stopReportEmailQueue();
  stopOtpDeliveryQueue();
  stopEmailRetention();
  stopProxyNonceRetention();
  clearInterval(scheduler);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason instanceof Error ? reason.message : reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error instanceof Error ? error.message : error);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

