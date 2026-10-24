import {
  QuizContent,
  QuizQuestion,
  QuizQuestionType,
  QuizShowExplanations,
} from 'src/track/type/quiz.type';
import { QuizKey } from './deterministic-checks';

/**
 * The answer material of a quiz, as the leak check reads it (plan §6.4).
 * Only what can be matched as text: correct option texts with their
 * distractors, accepted fill-in answers, and explanations. True/false keys
 * ("true") and orderings are not text a reply could leak by naming.
 */
export function quizKeysFromContent(
  content: QuizContent | null | undefined,
  earned: { submitted: boolean } = { submitted: false },
): QuizKey[] {
  if (!content?.questions?.length) return [];
  const explanationsEarned =
    earned.submitted &&
    (content.settings?.showExplanations ??
      QuizShowExplanations.AFTER_SUBMIT) !== QuizShowExplanations.NEVER;
  const keys: QuizKey[] = [];
  for (const question of content.questions) {
    // After submission the learner has seen what this quiz shows them; a
    // question that hides its correct answer stays secret.
    const stillSecret =
      !explanationsEarned || question.showCorrectAnswer === false;
    if (!stillSecret) continue;
    const key = keyFor(question);
    if (key) keys.push(key);
  }
  return keys;
}

function keyFor(question: QuizQuestion): QuizKey | null {
  const explanation = question.explanation?.trim() || null;
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI: {
      const correct = new Set(question.correctOptionIds ?? []);
      const options = question.options ?? [];
      return {
        answers: options.filter((o) => correct.has(o.id)).map((o) => o.text),
        distractors: options
          .filter((o) => !correct.has(o.id))
          .map((o) => o.text),
        explanation,
      };
    }
    case QuizQuestionType.FILL_BLANK:
      return {
        answers: (question.blanks ?? []).flatMap(
          (b) => b.acceptedAnswers ?? [],
        ),
        distractors: [],
        explanation,
      };
    case QuizQuestionType.OPEN_ENDED:
      return {
        answers: [],
        distractors: [],
        explanation: question.rubric?.guidance?.trim() || explanation,
      };
    default:
      return explanation ? { answers: [], distractors: [], explanation } : null;
  }
}
