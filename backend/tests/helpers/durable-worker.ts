import { connectLot4NativeDatabase } from "./native-postgres.js";
const owned = await connectLot4NativeDatabase();
process.env.JOIN_CODE_PEPPER = "durable-local-only-pepper-0123456789abcdef";
process.env.SKILLQUEST_STAGING_MODE = "synthetic-v1";
const { prisma } = await import("../../src/db/prisma.js");
try {
  if (process.argv[2] === "dispatch") {
    const { configuredDispatch } = await import("../../src/services/job-dispatch.service.js");
    console.log(JSON.stringify(await configuredDispatch()));
  } else if (process.argv[2] === "pdf") {
    const { reportPdfRenderer } = await import("../../src/services/report-pdf.service.js");
    const { writeFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const job = await prisma.adaptiveReportJob.findUniqueOrThrow({ where: { id: process.argv[3] }, include: { interview: true } });
    const pdf = await reportPdfRenderer.render(job.interview, job);
    await writeFile(resolve(owned.context.root, `pdf-${job.id}.pdf`), pdf);
    console.log(JSON.stringify({ sha256: createHash("sha256").update(pdf).digest("hex"), bytes: pdf.length }));
  } else if (process.argv[2] === "receive") {
    const { consumeQstash } = await import("../../src/services/qstash-consumer.service.js");
    const [row] = await prisma.$queryRawUnsafe<{ payload: any }[]>(`SELECT payload FROM "SyntheticNotification" WHERE id=$1::uuid`, process.argv[3]);
    console.log(JSON.stringify({ disposition: await consumeQstash(prisma, row.payload) }));
  } else if (process.argv[2] === "crash-before" || process.argv[2] === "crash-after") {
    const { EmailBudget } = await import("../../src/services/email-budget.service.js");
    const original = EmailBudget.prototype.claim;
    EmailBudget.prototype.claim = async function (...args) {
      if (process.argv[2] === "crash-after") await original.apply(this, args);
      process.send?.({ ready: true });
      await new Promise(() => { setInterval(() => {}, 1000); });
      throw Error("UNREACHABLE");
    };
    const { processJob } = await import("../../src/services/job-processing.service.js");
    await processJob({ kind: "OTP_INITIAL", jobId: process.argv[3], phase: "DELIVER" });
  } else throw Error("LOCAL_ACTION_INVALID");
} finally { await prisma.$disconnect(); await owned.client.$disconnect(); }
