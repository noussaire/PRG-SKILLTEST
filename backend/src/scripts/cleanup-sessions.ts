import { prisma } from "../db/prisma.js";
await prisma.adminSession.deleteMany({
  where: { expiresAt: { lte: new Date() } },
});
await prisma.participant.updateMany({
  where: { tokenExpiresAt: { lte: new Date() }, revokedAt: null },
  data: { revokedAt: new Date() },
});
await prisma.$disconnect();
