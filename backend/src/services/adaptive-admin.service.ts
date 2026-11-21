import type { AdaptiveInterview, AdaptiveReportJob } from "@prisma/client";
import { getAdaptiveCatalog, type InterviewLanguage } from "./adaptive-catalog.js";
import { interviewView, type InterviewState } from "./adaptive.service.js";
import { localizedAISummary } from "./prepared-localization.js";

export type AdminInterviewRow = Pick<AdaptiveInterview, "id" | "displayName" | "email" | "state" | "createdAt" | "updatedAt" | "expiresAt"> & Partial<Pick<AdaptiveInterview, "previousResult" | "lastTestStartedAt">> & { reportEmailRequested?: boolean; reportJob: (Pick<AdaptiveReportJob, "status" | "summary" | "nextAttemptAt" | "updatedAt"> & Partial<Pick<AdaptiveReportJob, "emailStatus" | "emailAcceptedAt">>) | null };
export function participantOverview(row: AdminInterviewRow) {
  const state = row.state as unknown as InterviewState;
  const completed = state.answers.length === 31 && !state.currentQuestion && !!state.summary;
  const aiGenerated = completed && (row.reportJob?.status === "COMPLETE"
    ? !!localizedAISummary(row.reportJob.summary, state.language, state.language)
    : !state.engine && !!state.summary);
  return {
    id: row.id, displayName: row.displayName, email: row.email, language: state.language,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    answeredCount: state.answers.length, totalQuestions: 31,
    status: completed ? "COMPLETED" as const : "IN_PROGRESS" as const,
    aiStatus: aiGenerated ? "COMPLETE" : row.reportJob?.status ?? "NONE", aiGenerated,
  };
}

export function adaptiveDashboard(rows: AdminInterviewRow[], language: InterviewLanguage) {
  const participants = rows.map(participantOverview);
  const completedRows = rows.filter((_, index) => participants[index].status === "COMPLETED");
  const completedTests = completedRows.length;
  const skills = getAdaptiveCatalog(language);
  // Each completed participant contributes at most once per skill; unknown levels are excluded.
  const topSkills = skills.map(skill => {
    const values = completedRows.flatMap(row => {
      const state = row.state as unknown as InterviewState;
      const level = state.answers.find(answer => answer.question.skillId === skill.id)?.assessment.level;
      return typeof level === "number" && level >= 1 && level <= 4 ? [level] : [];
    });
    return { id: skill.id, label: skill.label, participants: values.length, average: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null };
  }).filter(skill => skill.participants > 0).sort((a, b) => b.average! - a.average! || a.id.localeCompare(b.id)).slice(0, 5);
  return {
    kpis: {
      totalParticipants: rows.length, completedTests, inProgressTests: rows.length - completedTests,
      aiReports: participants.filter(row => row.aiGenerated).length,
      pendingAIReports: participants.filter(row => row.status === "COMPLETED" && ["PENDING", "PROCESSING", "RETRY"].includes(row.aiStatus)).length,
      completionRate: rows.length ? Math.round(completedTests * 100 / rows.length) : 0,
    },
    topSkills, recentParticipants: participants.slice(0, 5), generatedAt: new Date().toISOString(),
  };
}

export function adminParticipantDetail(row: AdminInterviewRow, language: InterviewLanguage) {
  const previous = row.previousResult as unknown as { state: InterviewState; reportJob: { status: string; summary: string | null; nextAttemptAt: string; emailStatus?: string; emailAcceptedAt?: string | null } | null } | null | undefined;
  const job = previous?.reportJob;
  const previousInterview = previous ? interviewView({ ...row, state: previous.state }, job ? { ...job, nextAttemptAt: new Date(job.nextAttemptAt), emailAcceptedAt: job.emailAcceptedAt ? new Date(job.emailAcceptedAt) : null } : undefined, language) : null;
  return { participant: participantOverview(row), interview: interviewView({ ...row, state: row.state as unknown as InterviewState }, row.reportJob ?? undefined, language), previousReport: previousInterview?.report ?? null };
}
