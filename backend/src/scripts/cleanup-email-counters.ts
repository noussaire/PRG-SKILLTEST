import { prisma } from "../db/prisma.js";
import { EmailBudget } from "../services/email-budget.service.js";

const budget = new EmailBudget(prisma);
try {
  const result = await budget.purgeExpiredData();
  console.log("Email retention cleanup complete:", JSON.stringify(result));
} finally { await prisma.$disconnect(); }
