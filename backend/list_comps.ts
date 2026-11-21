import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const comps = await prisma.competency.findMany({ orderBy: { label: "asc" } });
  console.log(`TOTAL COMPETENCIES: ${comps.length}`);
  comps.forEach((c, idx) => {
    console.log(`${idx + 1}. [${c.slug}] ${c.label}`);
  });
}

main().finally(() => prisma.$disconnect());
