import type { AdaptiveInterview, InterviewLanguage } from "./adaptive-types";
export interface AdminAdaptiveParticipant {
  id: string; displayName: string; email: string | null; language: InterviewLanguage;
  createdAt: string; updatedAt: string; expiresAt: string;
  answeredCount: number; totalQuestions: number; status: "IN_PROGRESS" | "COMPLETED";
  aiStatus: string; aiGenerated: boolean;
}
export interface AdaptiveDashboard {
  kpis: { totalParticipants: number; completedTests: number; inProgressTests: number; aiReports: number; pendingAIReports: number; completionRate: number };
  topSkills: { id: string; label: string; participants: number; average: number | null }[];
  recentParticipants: AdminAdaptiveParticipant[]; generatedAt: string;
}
export interface AdaptiveParticipantList {
  participants: AdminAdaptiveParticipant[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface AdaptiveParticipantDetail { participant: AdminAdaptiveParticipant; interview: AdaptiveInterview; previousReport?: AdaptiveInterview["report"] }
