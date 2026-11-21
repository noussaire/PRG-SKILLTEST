import { getAdaptiveCatalog, type InterviewLanguage } from "./adaptive-catalog.js";
import { PREPARED_BANK } from "./prepared-bank.js";
import { PREPARED_BRANCHES } from "./prepared-branches.js";
import type { InterviewState, InterviewQuestion } from "./adaptive.service.js";

// Display translation preserves saved IDs, scoring and original observations.
export function localizePreparedState(source: InterviewState, language: InterviewLanguage): InterviewState {
  if (!source.engine || source.language === language) return source;
  const ar = language === "ar";
  function translateQuestion(question: InterviewQuestion): InterviewQuestion {
    const entry = PREPARED_BANK.find(item => item[0] === question.skillId);
    if (!entry || !question.rubric) return question;
    const labels = entry[ar ? 4 : 3];
    const choices = question.choices?.map(choice => ({ ...choice, label: labels[4 - question.rubric![choice.id].level] }));
    let previousDecision = question.previousDecision;
    if (previousDecision) {
      const previous = source.answers.find(answer => answer.question.id === previousDecision!.questionId);
      const previousEntry = PREPARED_BANK.find(item => item[0] === previous?.question.skillId);
      const rubric = previous?.choiceId ? previous.question.rubric?.[previous.choiceId] : undefined;
      if (previousEntry && rubric) previousDecision = {
        ...previousDecision, choiceLabel: previousEntry[ar ? 4 : 3][4 - rubric.level],
        consequence: PREPARED_BRANCHES[previousEntry[0]][4 - rubric.level][ar ? 2 : 1],
      };
    }
    const prompt = entry[ar ? 2 : 1];
    return { ...question, choices, prompt, text: `${previousDecision ? `${previousDecision.consequence}\n\n` : ""}${prompt}`, ...(previousDecision ? { previousDecision } : {}) };
  }
  const answers = source.answers.map(observed => {
    const question = translateQuestion(observed.question);
    const choice = question.choices?.find(item => item.id === observed.choiceId);
    const rubric = observed.choiceId ? question.rubric?.[observed.choiceId] : undefined;
    if (!choice || !rubric) return observed; // Historical free text retains its original wording.
    return { ...observed, question, answer: choice.label, assessment: assessmentFor(question.skillId, language, rubric.level, choice.label) };
  });
  const translated: InterviewState = { ...source, language, answers, currentQuestion: source.currentQuestion ? translateQuestion(source.currentQuestion) : null };
  if (source.summary) translated.summary = summaryFor(translated);
  return translated;
}

// The existing text column can store both translations without changing saved jobs.
export function localizedAISummary(summary: string | null | undefined, language: InterviewLanguage, originalLanguage: InterviewLanguage): string | null {
  if (!summary) return null;
  try {
    const value = JSON.parse(summary);
    if (value && typeof value.fr === "string" && typeof value.ar === "string") return value[language].trim() || null;
  } catch { /* Existing plain text summary. */ }
  return language === originalLanguage ? summary : null;
}

export function assessmentFor(skillId: string, language: InterviewLanguage, level: 1 | 2 | 3 | 4, choiceLabel: string) {
  const skill = getAdaptiveCatalog(language).find(item => item.id === skillId)!;
  const ar = language === "ar";
  return {
        level: level, evidenceQuote: choiceLabel,
        rationale: ar
          ? `${level >= 3 ? "ينسجم التصرف المختار مع هذا الهدف" : "يتيح هذا الاختيار فرصة للتدريب حول الهدف التالي"}: ${skill.description} هذا مؤشر خاص بالموقف وليس دليلا على أداء فعلي.`
          : `${level >= 3 ? "L’action choisie est cohérente avec cet objectif" : "Ce choix ouvre une piste de progression autour de cet objectif"} : ${skill.description} Il s’agit d’un indice lié à cette situation, sans observation d’un comportement réel.`,
        advice: ar ? `في مشروعك المقبل، جرب هذه الخطوة واطلب ملاحظات زميل: ${skill.description}` : `Dans votre prochain projet, entraînez cette action puis demandez un retour à un camarade : ${skill.description}`,
      };
}

export function summaryFor(state: InterviewState) {
  const catalog = getAdaptiveCatalog(state.language);
  const ordered = [...state.answers].sort((a, b) => (b.assessment.level ?? 0) - (a.assessment.level ?? 0));
  const label = (id: string) => catalog.find(skill => skill.id === id)!.label;
  const strengths = ordered.filter(answer => (answer.assessment.level ?? 0) >= 3).slice(0, 3).map(answer => label(answer.question.skillId));
  const priorities = [...ordered].reverse().filter(answer => (answer.assessment.level ?? 0) <= 2).slice(0, 3).map(answer => label(answer.question.skillId));
  if (state.language === "ar") return `اكتمل مسارك في 31 مهارة. ${strengths.length ? `تبرز اختياراتك نقاط ارتكاز في: ${strengths.join("، ")}.` : "تقدم هذه المواقف نقاطا أولية للاستكشاف والتدريب."} ${priorities.length ? `يمكن بدء التدريب بـ: ${priorities.join("، ")}.` : "واصل تنويع المواقف وطلب الملاحظات لتثبيت ما تعلمته."} اختر نصيحة عملية من التقرير وجربها في مشروع صغير ثم اطلب ملاحظات شخص تثق به. تعكس النتائج اختياراتك في مواقف محددة ولا تحكم على شخصيتك أو قدراتك الفعلية.`;
  return `Votre parcours couvre 31 compétences. ${strengths.length ? `Vos choix font apparaître des points d’appui en ${strengths.join(", ")}.` : "Ces situations proposent de premiers repères à explorer et à entraîner."} ${priorities.length ? `Vous pouvez commencer votre entraînement par ${priorities.join(", ")}.` : "Continuez à varier les situations et à demander des retours pour consolider vos acquis."} Choisissez une action concrète dans ce bilan, testez-la dans un petit projet et demandez un retour. Ces résultats décrivent vos choix dans des situations particulières, sans juger votre personnalité ni prouver vos capacités réelles.`;
}

