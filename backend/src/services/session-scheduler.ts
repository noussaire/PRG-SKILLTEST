import { prisma } from "../db/prisma.js";
// The request-time policy remains authoritative, including when this timer is delayed.
export async function refreshSessionWindows(now = new Date()) {
  await prisma.assessmentSession.updateMany({
    where: { status: { in: ["OPEN", "SCHEDULED"] }, closesAt: { lte: now } },
    data: { status: "CLOSED" },
  });
  await prisma.assessmentSession.updateMany({
    where: {
      status: "SCHEDULED",
      opensAt: { lte: now },
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
    },
    data: { status: "OPEN" },
  });
}
