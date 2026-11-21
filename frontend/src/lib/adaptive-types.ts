export type InterviewLanguage = "fr" | "ar";

export interface AdaptiveSkill {
  id: string;
  label: string;
  description: string;
}

export interface AdaptiveReportSkill extends AdaptiveSkill {
  level: 1 | 2 | 3 | 4 | null;
  evidenceQuote: string;
  rationale: string;
  advice: string;
  question: string;
  answer: string;
}

export interface AdaptiveInterview {
  emailVerified?: boolean;
  mode?: "prepared-v1" | "prepared-v2" | "legacy-ai";
  id: string;
  displayName: string;
  language: InterviewLanguage;
  status: "IN_PROGRESS" | "COMPLETED";
  answeredCount: number;
  totalQuestions: number;
  currentQuestion: { id: string; skillId: string; text: string; prompt?: string; previousDecision?: { questionId: string; choiceLabel: string; consequence: string }; choices?: Array<{ id: string; label: string }> } | null;
  skills: AdaptiveSkill[];
  transcript: Array<{ question: string; answer: string }>;
  report: {
    summary: string;
    summarySource?: "rules" | "ai";
    legacyObservationCount?: number;
    aiStatus?: "NONE" | "PENDING" | "PROCESSING" | "RETRY" | "COMPLETE" | "UNAVAILABLE";
    aiRetryAt?: string | null;
    emailStatus?: "NOT_REQUESTED" | "DISABLED" | "WAITING_AI" | "PENDING" | "PROCESSING" | "RETRY" | "SENT" | "FAILED" | "UNKNOWN";
    emailAcceptedAt?: string | null;
    skills: AdaptiveReportSkill[];
    disclaimer: string;
  } | null;
  expiresAt: string;
  nextTestAllowedAt?: string | null;
}

export interface AdaptiveConfig {
  configured: boolean;
  mode?: "prepared-v1" | "prepared-v2";
  aiReportAvailable?: boolean;
  reportEmailAvailable?: boolean;
  totalQuestions: number;
  skills: AdaptiveSkill[];
}
