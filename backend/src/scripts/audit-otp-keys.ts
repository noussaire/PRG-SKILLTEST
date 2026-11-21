import { prisma } from "../db/prisma.js";
import { inspectOtpKeyUsage } from "../services/otp-key-usage.service.js";

// Read-only; not executed against a real database during this qualification.
try { console.log(JSON.stringify(await inspectOtpKeyUsage(prisma))); }
finally { await prisma.$disconnect(); }
