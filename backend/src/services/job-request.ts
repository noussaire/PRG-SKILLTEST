import { z } from "zod";

const jobId = z.string().uuid();
export function assertJobId(value: string) { jobId.parse(value); }

// No recipient, payload, SQL table or executable destination can come from a
// future queue message. The kind and phase select a fixed application handler.
export const jobRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OTP_INITIAL"), jobId, phase: z.literal("DELIVER") }).strict(),
  z.object({ kind: z.literal("OTP_RETAKE"), jobId, phase: z.literal("DELIVER") }).strict(),
  z.object({ kind: z.literal("REPORT"), jobId, phase: z.enum(["SUMMARY", "EMAIL"]) }).strict(),
]);
export type JobRequest = z.infer<typeof jobRequestSchema>;
