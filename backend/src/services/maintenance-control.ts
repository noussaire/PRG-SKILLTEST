import { performance } from "node:perf_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";

export type MaintenanceFence = (tx: Prisma.TransactionClient) => Promise<void>;

export class MaintenanceStopped extends Error {
  constructor(readonly code: "DEADLINE" | "ABORTED") { super(code); }
}

// Cooperative between transactions; an in-flight transaction is fenced by its
// remaining wall-clock timeout. No detached work or permanent timer is started.
export class MaintenanceControl {
  private readonly deadline: number;
  constructor(readonly budgetMs: number, readonly sqlTimeoutMs: number, readonly signal?: AbortSignal, private readonly fence?:MaintenanceFence,
    private readonly admissionLimits?: { maxWaitMs: number; lockTimeoutMs: number }) {
    this.deadline = performance.now() + budgetMs;
  }
  check() {
    if (this.signal?.aborted) throw new MaintenanceStopped("ABORTED");
    if (this.remaining() < 10) throw new MaintenanceStopped("DEADLINE");
  }
  remaining() { return Math.max(0, Math.floor(this.deadline - performance.now())); }
  async transaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.check();
    return db.$transaction(async tx => {
      this.check();
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='${Math.max(1, Math.min(this.sqlTimeoutMs, this.remaining()))}ms'`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout='${Math.max(1, Math.min(this.admissionLimits?.lockTimeoutMs ?? 250, this.sqlTimeoutMs, this.remaining()))}ms'`);
      await this.fence?.(tx);
      const result = await work(tx);
      this.check(); // Cancellation before commit rolls back this whole batch.
      await this.fence?.(tx);
      return result;
    }, { isolationLevel: "ReadCommitted", maxWait: Math.max(1, Math.min(this.admissionLimits?.maxWaitMs ?? 500, this.remaining())), timeout: Math.max(1, this.remaining()) });
  }
}
