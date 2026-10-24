import {
  QuizAnswer,
  QuizContent,
  QuizQuestion,
  QuizQuestionGrading,
  QuizQuestionType,
  QuizShowExplanations,
} from 'src/track/type/quiz.type';
import { correctAnswerOf } from 'src/track/util/track-quiz-grading.util';
import { plainText } from '../context/guide-context';

/**
 * The quiz firewall for explanations (plans/ally-guide/plan.md §6.4).
 *
 * The orchestrator never holds an answer key. When the learner asks about a
 * quiz, the Assessor is given only what the quiz player has already shown
 * the learner — and only when the quiz's `showExplanations` allows it — and
 * whatever comes back is checked against the key before the orchestrator
 * sees it. Pure functions, so the rules can be tested without a model.
 */

/** The parts of a submitted attempt the firewall reads. */
export interface QuizAttemptView {
  attemptNumber: number;
  answers: QuizAnswer[];
  grading: QuizQuestionGrading[];
}

export type QuizExplainDecision =
  | {
      allowed: false;
      /**
       * `never`: the quiz never explains, after any attempt or retake.
       * `quiz_open`: the learner is in the quiz now.
       * `no_attempt`: nothing submitted yet, so nothing has been earned.
       */
      reason: 'never' | 'quiz_open' | 'no_attempt';
    }
  | { allowed: true };

/**
 * Whether Ally may discuss this quiz beyond pointing to the material. The
 * setting is checked first and alone decides `never`: no number of attempts
 * or retakes turns it into anything else.
 */
export function decideQuizExplanation(input: {
  showExplanations: QuizShowExplanations | string | null | undefined;
  quizOpen: boolean;
  attempt: QuizAttemptView | null;
}): QuizExplainDecision {
  const setting = input.showExplanations ?? QuizShowExplanations.AFTER_SUBMIT;
  if (
    setting !== QuizShowExplanations.AFTER_EACH &&
    setting !== QuizShowExplanations.AFTER_SUBMIT
  ) {
    // `never`, or a value this code does not know: the safe reading.
    return { allowed: false, reason: 'never' };
  }
  if (input.quizOpen) return { allowed: false, reason: 'quiz_open' };
  if (!input.attempt || !input.attempt.grading?.length) {
    return { allowed: false, reason: 'no_attempt' };
  }
  return { allowed: true };
}

/** One question as the learner has already seen it after submitting. */
export interface LearnerAllowedQuestion {
  number: number;
  prompt: string;
  yourAnswer: string | null;
  result: 'right' | 'not_right' | 'ungraded' | 'pending';
  explanation?: string;
  correctAnswer?: string;
  graderNote?: string;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const optionTexts = (
  options: Array<{ id: string; text: string }>,
  ids: string[] | undefined,
): string =>
  (ids ?? [])
    .map((id) => options.find((option) => option.id === id)?.text)
    .filter((text): text is string => Boolean(text))
    .map((text) => plainText(text))
    .join('; ');

/** The learner's own answer, in words. */
export function answerText(
  question: QuizQuestion,
  answer: QuizAnswer | undefined,
): string | null {
  if (!answer) return null;
  let text = '';
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      text = optionTexts(question.options, answer.selectedOptionIds);
      break;
    case QuizQuestionType.TRUE_FALSE:
      text =
        answer.booleanAnswer === undefined
          ? ''
          : answer.booleanAnswer
            ? 'True'
            : 'False';
      break;
    case QuizQuestionType.ORDERING:
      text = optionTexts(question.items, answer.orderedItemIds).replace(
        /; /g,
        ' → ',
      );
      break;
    case QuizQuestionType.MATCHING:
      text = (answer.pairs ?? [])
        .map(
          (pair) =>
            `${optionTexts(question.left, [pair.leftId])} → ${optionTexts(question.right, [pair.rightId])}`,
        )
        .join('; ');
      break;
    case QuizQuestionType.FILL_BLANK:
      text = (answer.blanks ?? []).map((blank) => blank.answer).join('; ');
      break;
    case QuizQuestionType.OPEN_ENDED:
      text = answer.text ?? '';
      break;
    default:
      text = '';
  }
  text = text.trim();
  return text ? clip(text, 400) : null;
}

/**
 * The correct answer in words — only where the quiz player shows it
 * (`showCorrectAnswer` not false, and a key exists).
 */
export function shownCorrectAnswer(question: QuizQuestion): string | null {
  const key = correctAnswerOf(question);
  if (!key) return null;
  let text = '';
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      text = optionTexts(question.options, key.selectedOptionIds);
      break;
    case QuizQuestionType.TRUE_FALSE:
      text = key.booleanAnswer ? 'True' : 'False';
      break;
    case QuizQuestionType.ORDERING:
      text = optionTexts(question.items, key.orderedItemIds).replace(
        /; /g,
        ' → ',
      );
      break;
    case QuizQuestionType.MATCHING:
      text = (key.pairs ?? [])
        .map(
          (pair) =>
            `${optionTexts(question.left, [pair.leftId])} → ${optionTexts(question.right, [pair.rightId])}`,
        )
        .join('; ');
      break;
    case QuizQuestionType.FILL_BLANK:
      text = (key.blanks ?? [])
        .map((blank) => blank.acceptedAnswers[0] ?? '')
        .filter(Boolean)
        .join('; ');
      break;
    default:
      text = '';
  }
  return text.trim() || null;
}

/**
 * What the learner has already been shown for one submitted attempt, at the
 * same level of detail as the quiz player's results (`buildQuestionResult`):
 * right or not, the explanation, the correct answer where the question shows
 * it, and the grader's note on a written answer. Never a rubric, never a
 * question they did not submit, never another option's correctness.
 */
export function learnerAllowedView(
  quiz: QuizContent,
  attempt: QuizAttemptView,
): LearnerAllowedQuestion[] {
  const answers = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const out: LearnerAllowedQuestion[] = [];
  quiz.questions.forEach((question, index) => {
    const entry = attempt.grading.find((g) => g.questionId === question.id);
    if (!entry) return;
    if (question.type === QuizQuestionType.LIKERT_SCALE) return;
    const result: LearnerAllowedQuestion['result'] =
      entry.graded === false && entry.correct === null
        ? 'ungraded'
        : entry.correct === null
          ? 'pending'
          : entry.correct
            ? 'right'
            : 'not_right';
    const view: LearnerAllowedQuestion = {
      number: index + 1,
      prompt: clip(plainText(question.prompt ?? ''), 400),
      yourAnswer: answerText(question, answers.get(question.id)),
      result,
    };
    if (question.explanation?.trim()) {
      view.explanation = clip(plainText(question.explanation), 600);
    }
    if (result !== 'pending') {
      const correct = shownCorrectAnswer(question);
      if (correct) view.correctAnswer = clip(correct, 400);
    }
    if (entry.llm?.feedback?.trim()) {
      view.graderNote = clip(entry.llm.feedback.trim(), 400);
    }
    out.push(view);
  });
  return out;
}

/** Folded for matching: case, accents kept, punctuation and spacing dropped. */
export const foldForMatch = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Too short to find reliably in free text ("True", "Yes", "B"). */
const significant = (folded: string) =>
  folded.length >= 12 || folded.split(' ').length >= 3;

/**
 * Every piece of the quiz's key the learner has NOT been shown: the correct
 * options and accepted answers, explanations and rubrics — minus anything
 * that already appears in `allowed` (what the player showed them). With no
 * `allowed` view, that is the whole key.
 */
export function keyMaterial(
  quiz: QuizContent,
  allowed: LearnerAllowedQuestion[] = [],
): string[] {
  const candidates: string[] = [];
  for (const question of quiz.questions) {
    if (question.explanation) candidates.push(plainText(question.explanation));
    switch (question.type) {
      case QuizQuestionType.MCQ_SINGLE:
      case QuizQuestionType.MCQ_MULTI:
        for (const id of question.correctOptionIds ?? []) {
          const option = question.options.find((o) => o.id === id);
          if (option) candidates.push(plainText(option.text));
        }
        break;
      case QuizQuestionType.ORDERING:
        candidates.push(
          optionTexts(question.items, question.correctOrder).replace(
            /; /g,
            ' ',
          ),
        );
        break;
      case QuizQuestionType.MATCHING:
        for (const pair of question.correctPairs ?? []) {
          candidates.push(
            `${optionTexts(question.left, [pair.leftId])} ${optionTexts(question.right, [pair.rightId])}`,
          );
        }
        break;
      case QuizQuestionType.FILL_BLANK:
        for (const blank of question.blanks ?? []) {
          candidates.push(...blank.acceptedAnswers);
        }
        break;
      case QuizQuestionType.OPEN_ENDED:
        if (question.rubric?.guidance) {
          candidates.push(plainText(question.rubric.guidance));
        }
        for (const criterion of question.rubric?.criteria ?? []) {
          if (criterion.description) candidates.push(criterion.description);
        }
        break;
      default:
        break;
    }
  }
  const shown = foldForMatch(
    allowed
      .flatMap((q) => [
        q.prompt,
        q.yourAnswer ?? '',
        q.explanation ?? '',
        q.correctAnswer ?? '',
        q.graderNote ?? '',
      ])
      .join(' \n '),
  );
  const out = new Set<string>();
  for (const candidate of candidates) {
    const folded = foldForMatch(candidate);
    if (!folded || !significant(folded)) continue;
    if (shown.includes(folded)) continue;
    out.add(folded);
  }
  return [...out];
}

/**
 * The "no key material" check (plan §6.4): the first piece of unearned key
 * that `text` contains, or null. Matching is on folded text, so a change of
 * case or punctuation does not slip through.
 */
export function findKeyMaterial(
  text: string,
  material: string[],
): string | null {
  const folded = foldForMatch(text);
  return material.find((piece) => folded.includes(piece)) ?? null;
}

/**
 * Where the material behind a quiz is: the items the learner has reached
 * before it in the same chapter (else the chapter before), titles only.
 */
export function materialBefore(
  spine: {
    items: Array<{
      id: string;
      title: string;
      type: string;
      state: string;
      sectionIndex: number;
    }>;
  },
  quizItemId: string,
): string[] {
  const index = spine.items.findIndex((item) => item.id === quizItemId);
  if (index < 0) return [];
  const quiz = spine.items[index];
  const before = spine.items
    .slice(0, index)
    .filter((item) => item.type !== 'QUIZ' && item.state !== 'locked');
  const sameChapter = before.filter(
    (item) => item.sectionIndex === quiz.sectionIndex,
  );
  const picked = sameChapter.length ? sameChapter : before.slice(-3);
  return picked.slice(-4).map((item) => item.title);
}
