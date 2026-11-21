import { summaryFor, assessmentFor } from "./prepared-localization.js";
import { randomInt, randomUUID } from "node:crypto";
import { ADAPTIVE_SKILLS, getAdaptiveCatalog, type InterviewLanguage } from "./adaptive-catalog.js";
import { PREPARED_BANK, FOLLOW_UP, type ActionStyle, type SkillId } from "./prepared-bank.js";
import { PREPARED_BRANCHES } from "./prepared-branches.js";
import { AIServiceError, type InterviewQuestion, type InterviewState } from "./adaptive.service.js";

const CONTEXT: Record<ActionStyle, [string, string]> = {
  organiser: ["Dans la simulation, votre plan fait avancer le projet. Une nouvelle situation apparaît.", "في المحاكاة، تساعد خطتك على تقدم المشروع. يظهر موقف جديد."],
  dialoguer: ["Dans la simulation, cet échange apporte de nouveaux points de vue. Le projet se poursuit.", "في المحاكاة، يقدم هذا النقاش وجهات نظر جديدة. يتواصل المشروع."],
  agir: ["Dans la simulation, votre action est engagée. L’équipe doit maintenant préparer la suite.", "في المحاكاة، بدأ تنفيذ اختيارك. على الفريق الآن الاستعداد للخطوة التالية."],
  attendre: ["Dans la simulation, le délai se rapproche. Une nouvelle décision devient nécessaire.", "في المحاكاة، يقترب الموعد. أصبح اتخاذ قرار جديد ضروريا."],
};

export const PREPARED_ENGINE = "prepared-v2" as const;

function questionFor(skillId: string, language: InterviewLanguage, previousDecision?: InterviewQuestion["previousDecision"]): InterviewQuestion {
  const entry = PREPARED_BANK.find(item => item[0] === skillId);
  if (!entry) throw new Error("PREPARED_SKILL_MISSING");
  const ar = language === "ar";
  const labels = ar ? entry[4] : entry[3];
  const styles = entry[5] ?? ["organiser", "dialoguer", "agir", "attendre"];
  const options = labels.map((label, index) => {
    const branch = PREPARED_BRANCHES[entry[0]][index];
    return { id: randomUUID(), label, level: (4 - index) as 1 | 2 | 3 | 4, style: styles[index], nextSkill: branch[0], consequence: branch[ar ? 2 : 1] };
  });
  for (let index = options.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [options[index], options[other]] = [options[other], options[index]];
  }
  return {
    id: randomUUID(), skillId,
    text: `${previousDecision ? `${previousDecision.consequence}\n\n` : ""}${ar ? entry[2] : entry[1]}`,
    prompt: ar ? entry[2] : entry[1], ...(previousDecision ? { previousDecision } : {}),
    choices: options.map(({ id, label }) => ({ id, label })),
    rubric: Object.fromEntries(options.map(({ id, level, style: action, nextSkill, consequence }) => [id, { level, style: action, nextSkill, consequence }])),
  };
}

export function createPreparedInterview(language: InterviewLanguage): InterviewState {
  return { engine: PREPARED_ENGINE, language, answers: [], summary: null, currentQuestion: questionFor("communication", language) };
}

export function upgradePreparedInterview(state: InterviewState): InterviewState {
  if (state.engine || !state.currentQuestion) return state;
  const seen = new Set(state.answers.map(answer => answer.question.skillId));
  const skill = !seen.has(state.currentQuestion.skillId) ? state.currentQuestion.skillId : ADAPTIVE_SKILLS.find(item => !seen.has(item[0]))?.[0];
  if (!skill) throw new Error("NO_UNOBSERVED_SKILL");
  return { ...state, engine: PREPARED_ENGINE, currentQuestion: questionFor(skill, state.language) };
}


export function advancePreparedInterview(state: InterviewState, input: { questionId: string; choiceId?: string }): InterviewState {
  const question = state.currentQuestion;
  if (!question || question.id !== input.questionId || state.answers.length >= 31) throw new AIServiceError("STALE_QUESTION", 409, "Cette question a changé. Rechargez pour reprendre votre progression.");
  if (!state.engine || !question.rubric) throw new AIServiceError("MODE_CHANGED", 409, "Le parcours fonctionne maintenant sans quota d’IA pour les questions. Rechargez pour continuer au même niveau de progression.");
  const choice = question.choices?.find(item => item.id === input.choiceId);
  const rubric = choice ? question.rubric[choice.id] : null;
  if (!choice || !rubric) throw new AIServiceError("INVALID_CHOICE", 400, "Sélectionnez une proposition de cette question.");
  const ar = state.language === "ar";
  const next: InterviewState = {
    ...state,
    engine: PREPARED_ENGINE,
    answers: [...state.answers, {
      question, choiceId: choice.id, answer: choice.label,
      assessment: assessmentFor(question.skillId, state.language, rubric.level, choice.label),
    }],
    currentQuestion: null, summary: null,
  };
  const seen = new Set(next.answers.map(answer => answer.question.skillId));
  // Every selected option has its own saved reaction and preferred follow-up.
  // The fallback also supports questions saved by the previous prepared version.
  const savedBranch = PREPARED_BRANCHES[question.skillId as SkillId]?.[4 - rubric.level];
  const preferred = rubric.nextSkill ?? savedBranch?.[0];
  const consequence = rubric.consequence ?? savedBranch?.[ar ? 2 : 1] ?? CONTEXT[rubric.style][ar ? 1 : 0];
  const following = [...(preferred ? [preferred] : []), ...FOLLOW_UP[rubric.style], ...ADAPTIVE_SKILLS.map(item => item[0])].find(id => !seen.has(id));
  if (following) next.currentQuestion = questionFor(following, state.language, { questionId: question.id, choiceLabel: choice.label, consequence });
  else next.summary = summaryFor(next);
  return next;
}
