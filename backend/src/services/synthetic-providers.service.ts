import type { PrismaClient } from "@prisma/client";
import { assertSyntheticDatabase, sealSyntheticMail, syntheticEmail, syntheticName, SyntheticStagingError } from "../security/synthetic-staging.js";
import type { JobNotification, JobPublisher } from "./job-publication.service.js";
import { parseNotification } from "./qstash-publisher.service.js";
import type { ReportEmailMessage } from "./brevo.service.js";
import type { InterviewState } from "./adaptive.service.js";
import { logOtpEvent } from "./otp-diagnostic.service.js";

// Faults are installed only by local fixtures / explicitly authorized DB tools.
// No browser-selected URL, status code, provider credential or fault endpoint.
async function fault(db: Pick<PrismaClient, "$queryRawUnsafe">, provider: string, id: string) {
  const rows = await db.$queryRawUnsafe<{ outcome: string }[]>(`UPDATE "SyntheticProviderFault" SET remaining=remaining-1
    WHERE provider=$1 AND id=$2::uuid AND remaining>0 RETURNING outcome`, provider, id);
  return rows[0]?.outcome;
}
export async function simulateEmail(db: PrismaClient, input: ReportEmailMessage & { recipient: string; recipientName: string; idempotencyKey: string; purpose?: "OTP" | "REPORT" }) {
  await assertSyntheticDatabase(db);
  if (!syntheticEmail(input.recipient) || !syntheticName(input.recipientName)) throw new SyntheticStagingError("SYNTHETIC_IDENTITY_REQUIRED");
  const outcome = await fault(db, "EMAIL", input.idempotencyKey);
  if (outcome === "REJECTED" || outcome === "RATE_LIMIT") return { outcome };
  // Capture is encrypted, bounded, and uses the SAME immutable logical send UUID.
  // No PDF binary is retained in the test mailbox.
  await db.$executeRawUnsafe(`INSERT INTO "SyntheticMail" (id,purpose,ciphertext,"expiresAt")
    SELECT $1::uuid,$2,$3,LEAST((clock_timestamp() AT TIME ZONE 'UTC')+interval '20 minutes',
      COALESCE((SELECT "expiresAt" FROM "ParticipantEmailDeliveryJob" WHERE id=$1::uuid),
               (SELECT "expiresAt" FROM "OtpDeliveryJob" WHERE id=$1::uuid),
               (clock_timestamp() AT TIME ZONE 'UTC')+interval '20 minutes'))
    ON CONFLICT DO NOTHING`, input.idempotencyKey, input.purpose ?? "REPORT", sealSyntheticMail(input.idempotencyKey, {
      recipient: input.recipient, subject: input.subject, htmlContent: input.htmlContent,
      attachments: input.attachments?.map(a => ({ name: a.name, bytes: Buffer.from(a.content, "base64").length })) ?? [], simulated: true,
    }));
  return { outcome: outcome === "ACCEPTED_RESPONSE_LOST" ? "UNCERTAIN" : "ACCEPTED" };
}

// A durable LOCAL transport simulator, not a connected QStash client. Published,
// received and job-complete are deliberately independent persisted facts.
export class SyntheticQstashPublisher implements JobPublisher {
  constructor(private db: Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">) {}
  async publish(value: JobNotification, signal: AbortSignal) {
    logOtpEvent("QSTASH_PUBLISH_SKIPPED", "skipped", { traceId: value.jobId, mode: "synthetic", code: "SYNTHETIC_TRANSPORT" });
    await assertSyntheticDatabase(this.db); signal.throwIfAborted();
    const n = parseNotification(value), outcome = await fault(this.db, "QUEUE", n.notificationId);
    if (outcome === "REJECTED" || outcome === "RATE_LIMIT") throw new SyntheticStagingError("SYNTHETIC_PUBLICATION_FAILED");
    await this.db.$executeRawUnsafe(`INSERT INTO "SyntheticNotification" (id,payload) VALUES ($1::uuid,$2::jsonb) ON CONFLICT DO NOTHING`, n.notificationId, JSON.stringify(n));
    if (outcome === "ACCEPTED_RESPONSE_LOST") throw new SyntheticStagingError("SYNTHETIC_PUBLICATION_UNKNOWN");
  }
}

export async function simulateSummary(db: PrismaClient) {
  await assertSyntheticDatabase(db);
  return JSON.stringify({
    fr: "Simulation pédagogique synthétique, sans appel IA. Les choix décrivent des préférences dans des situations fictives. Entraînez-vous à reformuler une consigne et à comparer deux solutions. Ce bilan ne prouve aucune capacité réelle.",
    ar: "محاكاة تربوية اصطناعية دون اتصال بالذكاء الاصطناعي. تصف الاختيارات تفضيلات في مواقف خيالية. تدرّب على إعادة صياغة التعليمات ومقارنة حلّين. لا يثبت هذا التقرير أي قدرة فعلية.",
  });
}

export async function simulateTurn(db: PrismaClient, state: InterviewState, answer?: string, existing = false) {
  await assertSyntheticDatabase(db);
  const index = state.answers.length + (answer === undefined ? 0 : 1), ar = state.language === "ar";
  const assessment = answer === undefined ? null : { level: 2 as const, evidenceQuote: answer.slice(0, 100),
    rationale: ar ? "ملاحظة اصطناعية لا تثبت قدرة فعلية." : "Observation synthétique, sans preuve de capacité réelle.",
    advice: ar ? "قارن حلين في موقف خيالي." : "Comparez deux solutions dans une situation fictive." };
  return { assessment: existing ? null : assessment,
    nextQuestion: existing || index >= 31 ? null : ar ? `موقف اصطناعي رقم ${index + 1}: كيف تنظّم العمل مع فريق؟` : `Situation synthétique ${index + 1} : comment organiser le travail en équipe ?`,
    choices: index >= 31 && !existing ? null : ar ? ["توضيح الهدف", "مناقشة الخطة", "تجربة حل", "طلب رأي"] : ["Clarifier le but", "Discuter du plan", "Essayer une solution", "Demander un avis"],
    summary: index >= 31 && !existing ? ar ? "خلاصة اصطناعية لمواقف خيالية." : "Synthèse simulée de situations fictives." : null };
}
