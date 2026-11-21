export type ParticipantView = {
  participant: { displayName: string; publicId: string };
  session: { label: string; assessment: string; acceptingDecisions: boolean; closesAt: string | null };
  attempt: {
    status: "IN_PROGRESS" | "COMPLETED";
    missionVersion: number;
    completedDecisions: number;
    remainingQuestions: { min: number; max: number };
    currentNode: {
      id: string;
      kind: "QUESTION" | "ENDING";
      title: string;
      story: string;
      question: string | null;
      choices: Array<{ id: string; label: string; position: number }>;
    };
  };
};
