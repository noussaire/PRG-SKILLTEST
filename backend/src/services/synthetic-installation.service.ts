import type { PrismaClient } from "@prisma/client";
import { stagingConfiguration, SyntheticStagingError, syntheticEmail } from "../security/synthetic-staging.js";

// Deliberate offline administration only; not imported by startup or a route.
// Refuses any existing identity, challenge, reservation or outbox, even hashed.
export interface InitializeSyntheticOptions {
  explicitProjectId?: string;
  explicitDatabaseName?: string;
}

export interface BootstrapSyntheticOptions extends InitializeSyntheticOptions {
  adminEmail: string;
  password?: string;
  passwordHash?: string;
}

export interface BootstrapSyntheticResult {
  stagingId: string;
  projectId: string | null;
  databaseName: string;
  adminEmail: string;
  action: "CREATED" | "UPDATED";
}

function checkTargetDatabaseIdentity(name: string, expectedDatabaseName?: string) {
  const lowerName = name.toLowerCase();
  const dbUrl = process.env.DATABASE_URL?.toLowerCase() ?? "";
  if (lowerName === "skillquest-db" || lowerName.includes("skillquest-db") || dbUrl.includes("skillquest-db")) {
    throw new SyntheticStagingError("FORBIDDEN_LEGACY_DATABASE");
  }
  if (expectedDatabaseName && name !== expectedDatabaseName) {
    throw new SyntheticStagingError("DATABASE_NAME_MISMATCH");
  }
}

export async function initializeEmptySyntheticDatabase(db: PrismaClient, options: InitializeSyntheticOptions = {}) {
  const config = stagingConfiguration(); if (!config) throw new SyntheticStagingError();
  const effectiveProject = options.explicitProjectId ?? config.project;
  if (effectiveProject !== null && !/^prj_[a-zA-Z0-9]+$/.test(effectiveProject)) {
    throw new SyntheticStagingError("INVALID_PROJECT_ID");
  }
  if (config.project !== null && options.explicitProjectId && config.project !== options.explicitProjectId) {
    throw new SyntheticStagingError("PROJECT_ID_MISMATCH");
  }

  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
    await tx.$executeRawUnsafe(`LOCK TABLE "SyntheticStagingInstallation","User","Participant","AdaptiveInterview",
      "EmailOtpChallenge","ParticipantEmailDeliveryJob","OtpDeliveryJob","EmailBudgetReservation","JobPublicationIntent" IN SHARE ROW EXCLUSIVE MODE`);
    const [{ name }] = await tx.$queryRawUnsafe<{ name: string }[]>(`SELECT current_database() AS name`);
    checkTargetDatabaseIdentity(name, options.explicitDatabaseName);

    const [existing] = await tx.$queryRawUnsafe<{ stagingId: string; projectId: string | null; databaseName: string }[]>(`SELECT * FROM "SyntheticStagingInstallation"`);
    if (existing) {
      if (existing.stagingId !== config.id || existing.projectId !== effectiveProject || existing.databaseName !== name) throw new SyntheticStagingError();
      return;
    }
    const [{ used }] = await tx.$queryRawUnsafe<{ used: boolean }[]>(`SELECT
      EXISTS(SELECT 1 FROM "User") OR EXISTS(SELECT 1 FROM "Participant") OR EXISTS(SELECT 1 FROM "AdaptiveInterview") OR
      EXISTS(SELECT 1 FROM "EmailOtpChallenge") OR EXISTS(SELECT 1 FROM "ParticipantEmailDeliveryJob") OR EXISTS(SELECT 1 FROM "OtpDeliveryJob") OR
      EXISTS(SELECT 1 FROM "EmailBudgetReservation") OR EXISTS(SELECT 1 FROM "JobPublicationIntent") AS used`);
    if (used) throw new SyntheticStagingError("SYNTHETIC_DATABASE_NOT_EMPTY");
    await tx.$executeRawUnsafe(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","projectId","databaseName") VALUES (1,$1::uuid,$2,$3)`, config.id, effectiveProject, name);
  }, { maxWait: 2000, timeout: 5000 });
}

export async function bootstrapSyntheticStaging(db: PrismaClient, options: BootstrapSyntheticOptions): Promise<BootstrapSyntheticResult> {
  const config = stagingConfiguration(); if (!config) throw new SyntheticStagingError();
  const effectiveProject = options.explicitProjectId ?? config.project;
  if (effectiveProject !== null && !/^prj_[a-zA-Z0-9]+$/.test(effectiveProject)) {
    throw new SyntheticStagingError("INVALID_PROJECT_ID");
  }
  if (config.project !== null && options.explicitProjectId && config.project !== options.explicitProjectId) {
    throw new SyntheticStagingError("PROJECT_ID_MISMATCH");
  }

  const cleanEmail = options.adminEmail.trim().toLowerCase();
  if (!syntheticEmail(cleanEmail)) {
    throw new SyntheticStagingError("INVALID_SYNTHETIC_ADMIN_EMAIL");
  }

  let finalHash = options.passwordHash;
  if (!finalHash) {
    if (!options.password || options.password.length < 12) {
      throw new SyntheticStagingError("PASSWORD_TOO_SHORT");
    }
    const { hashPassword } = await import("../security/tokens.js");
    finalHash = await hashPassword(options.password);
  }

  return await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='4000ms'`);
    await tx.$executeRawUnsafe(`LOCK TABLE "SyntheticStagingInstallation","User","Participant","AdaptiveInterview",
      "EmailOtpChallenge","ParticipantEmailDeliveryJob","OtpDeliveryJob","EmailBudgetReservation","JobPublicationIntent" IN SHARE ROW EXCLUSIVE MODE`);
    const [{ name }] = await tx.$queryRawUnsafe<{ name: string }[]>(`SELECT current_database() AS name`);
    checkTargetDatabaseIdentity(name, options.explicitDatabaseName);

    // Strictly ensure no non-synthetic operational / business entities exist
    const [{ used }] = await tx.$queryRawUnsafe<{ used: boolean }[]>(`SELECT
      EXISTS(SELECT 1 FROM "Participant") OR EXISTS(SELECT 1 FROM "AdaptiveInterview") OR
      EXISTS(SELECT 1 FROM "EmailOtpChallenge") OR EXISTS(SELECT 1 FROM "ParticipantEmailDeliveryJob") OR EXISTS(SELECT 1 FROM "OtpDeliveryJob") OR
      EXISTS(SELECT 1 FROM "EmailBudgetReservation") OR EXISTS(SELECT 1 FROM "JobPublicationIntent") AS used`);
    if (used) throw new SyntheticStagingError("SYNTHETIC_DATABASE_NOT_EMPTY");

    // Manage singleton staging installation marker
    const [existing] = await tx.$queryRawUnsafe<{ stagingId: string; projectId: string | null; databaseName: string }[]>(`SELECT * FROM "SyntheticStagingInstallation"`);
    if (existing) {
      if (existing.stagingId !== config.id || existing.projectId !== effectiveProject || existing.databaseName !== name) {
        throw new SyntheticStagingError("EXISTING_MARKER_MISMATCH");
      }
    } else {
      await tx.$executeRawUnsafe(`INSERT INTO "SyntheticStagingInstallation" (singleton,"stagingId","projectId","databaseName") VALUES (1,$1::uuid,$2,$3)`, config.id, effectiveProject, name);
    }

    // Ensure exactly ONE synthetic administrator account exists
    const users = await tx.user.findMany();
    let action: "CREATED" | "UPDATED" = "CREATED";

    if (users.length === 0) {
      await tx.user.create({
        data: {
          email: cleanEmail,
          role: "ADMIN",
          passwordHash: finalHash!,
        }
      });
      action = "CREATED";
    } else if (users.length === 1) {
      const u = users[0];
      if (u.email !== cleanEmail || u.role !== "ADMIN") {
        throw new SyntheticStagingError("EXISTING_ADMIN_MISMATCH");
      }
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: finalHash! }
      });
      await tx.adminSession.deleteMany({ where: { userId: u.id } });
      action = "UPDATED";
    } else {
      throw new SyntheticStagingError("MULTIPLE_USERS_DETECTED");
    }

    return {
      stagingId: config.id,
      projectId: effectiveProject,
      databaseName: name,
      adminEmail: cleanEmail,
      action,
    };
  }, { maxWait: 2000, timeout: 5000 });
}
