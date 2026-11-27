import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  QuizContent,
  QuizOption,
  QuizQuestion,
  QuizQuestionType,
} from 'src/track/type/quiz.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBrief } from '../../type/course-copilot.type';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  asArray,
  asBoolean,
  asText,
  briefForPrompt,
  isRecord,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

/**
 * Course Pilot phase 4B: is each quiz question's marked answer actually right?
 *
 * A second model answers every choice and true/false question WITHOUT the answer key or the
 * explanations (both would hand it the answer), and code compares its answers with the key. A
 * question it answers differently, or calls ambiguous, is a dispute. The quiz writer gets the
 * disputes as repair notes on its one repair pass; on that pass a question still disputed is
 * dropped while at least half the quiz remains (a wrong key marks right learners wrong, which
 * is worse than a missing question).
 *
 * Only questions with one checkable key: single/multi choice and true/false. Ordering, matching,
 * fill-in and written answers are not checked. A failed check never blocks the quiz.
 */

const CHECKED_TYPES: ReadonlySet<QuizQuestionType> = new Set([
  QuizQuestionType.MCQ_SINGLE,
  QuizQuestionType.MCQ_MULTI,
  QuizQuestionType.TRUE_FALSE,
]);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PROMPT_PREVIEW_CHARS = 80;

type CheckedQuestion = QuizQuestion & {
  options?: QuizOption[];
  correctOptionIds?: string[];
  correctAnswer?: boolean;
};

export interface AnswerKeyDispute {
  questionId: string;
  /** 1-based position in the quiz, as the writer numbered it. */
  number: number;
  prompt: string;
  keyed: string;
  answered: string;
  ambiguous: boolean;
  reason: string;
}

export interface SolverAnswer {
  n: number;
  answer: string[];
  ambiguous: boolean;
  reason: string;
}

/** The questions as the solver sees them: no key, no explanation, options lettered. */
export function questionsForSolver(content: QuizContent): {
  n: number;
  kind: 'single' | 'multi' | 'true_false';
  question: string;
  options?: { letter: string; text: string }[];
}[] {
  return (content.questions ?? [])
    .map((question, index) => ({
      question: question as CheckedQuestion,
      index,
    }))
    .filter(({ question }) => CHECKED_TYPES.has(question.type))
    .map(({ question, index }) => {
      if (question.type === QuizQuestionType.TRUE_FALSE) {
        return {
          n: index + 1,
          kind: 'true_false' as const,
          question: question.prompt,
        };
      }
      return {
        n: index + 1,
        kind:
          question.type === QuizQuestionType.MCQ_MULTI
            ? ('multi' as const)
            : ('single' as const),
        question: question.prompt,
        options: (question.options ?? []).map((option, i) => ({
          letter: LETTERS[i] ?? String(i + 1),
          text: option.text,
        })),
      };
    });
}

/** Pure: raw model JSON → one answer per question number it answered. */
export function normaliseSolverAnswers(
  raw: unknown,
): Map<number, SolverAnswer> {
  const out = new Map<number, SolverAnswer>();
  const root = isRecord(raw) ? raw : {};
  for (const entry of asArray(root.answers).filter(isRecord)) {
    const n = Number(entry.n ?? entry.number);
    if (!Number.isInteger(n) || n < 1 || out.has(n)) continue;
    const answer = (Array.isArray(entry.answer) ? entry.answer : [entry.answer])
      .map((value: unknown) => asText(String(value ?? '')).toUpperCase())
      .filter(Boolean);
    if (!answer.length) continue;
    out.set(n, {
      n,
      answer,
      ambiguous: asBoolean(entry.ambiguous) === true,
      reason: asText(entry.reason, 300),
    });
  }
  return out;
}

const describeOptions = (options: QuizOption[], ids: string[]) =>
  options
    .map((option, i) => ({ option, letter: LETTERS[i] }))
    .filter(({ option }) => ids.includes(option.id))
    .map(({ option, letter }) => `${letter} "${option.text}"`)
    .join(' + ') || 'nothing';

/**
 * Pure: compare the solver's answers with the key. A question the solver skipped is not a
 * dispute — a gap in the check must not cost the writer a repair.
 */
export function compareAnswerKey(
  content: QuizContent,
  answers: Map<number, SolverAnswer>,
): AnswerKeyDispute[] {
  const disputes: AnswerKeyDispute[] = [];
  (content.questions ?? []).forEach((raw, index) => {
    const question = raw as CheckedQuestion;
    if (!CHECKED_TYPES.has(question.type)) return;
    const solved = answers.get(index + 1);
    if (!solved) return;

    let keyed: string;
    let answered: string;
    let agrees: boolean;
    if (question.type === QuizQuestionType.TRUE_FALSE) {
      keyed = String(question.correctAnswer === true);
      const given = solved.answer[0]?.toLowerCase();
      if (given !== 'true' && given !== 'false') return;
      answered = given;
      agrees = given === keyed;
    } else {
      const options = question.options ?? [];
      const key = new Set(question.correctOptionIds ?? []);
      const pickedIds = solved.answer
        .map((letter) => options[LETTERS.indexOf(letter)]?.id)
        .filter((id): id is string => Boolean(id));
      if (!pickedIds.length) return;
      keyed = describeOptions(options, [...key]);
      answered = describeOptions(options, pickedIds);
      agrees =
        pickedIds.length === key.size && pickedIds.every((id) => key.has(id));
    }
    if (agrees && !solved.ambiguous) return;
    disputes.push({
      questionId: question.id,
      number: index + 1,
      prompt: question.prompt,
      keyed,
      answered,
      ambiguous: solved.ambiguous,
      reason: solved.reason,
    });
  });
  return disputes;
}

/** Repair notes the quiz writer reads on its repair pass. */
export function answerKeyProblems(disputes: AnswerKeyDispute[]): string[] {
  return disputes.map((d) => {
    const what =
      d.keyed === d.answered
        ? `agreed with the key (${d.keyed}) but found the question ambiguous`
        : `answered ${d.answered} where the key marks ${d.keyed}` +
          (d.ambiguous ? ', and found the question ambiguous' : '');
    return (
      `Question ${d.number} ("${d.prompt.slice(0, PROMPT_PREVIEW_CHARS)}"): an independent check ` +
      `that could not see the answer key ${what}.` +
      (d.reason ? ` Its reason: ${d.reason}` : '') +
      ' Fix the key, or rewrite the question so that only the keyed answer is right.'
    );
  });
}

@Injectable()
export class AnswerKeyCheckSpecialist {
  private readonly logger = new Logger(AnswerKeyCheckSpecialist.name);

  constructor(
    private readonly llm: SpecialistLlmService,
    @Optional() private readonly configService?: AppConfigService,
  ) {}

  /** COURSE_PILOT_ANSWER_CHECK; off = quizzes ship as the writer keyed them. */
  get enabled(): boolean {
    return this.configService?.courseCopilot?.answerCheck === true;
  }

  /**
   * The questions whose key the check disputes. Empty when nothing is checkable, when the
   * check finds nothing, or when the check itself fails (logged, never thrown).
   */
  async check(
    content: QuizContent,
    brief: CourseBrief,
    usageMetadata: Record<string, any> = {},
  ): Promise<AnswerKeyDispute[]> {
    const questions = questionsForSolver(content);
    if (!questions.length) return [];
    try {
      const { data } = await this.llm.runJson({
        specialist: 'answer_key_check',
        promptCode: COURSE_COPILOT_PROMPTS.ANSWER_KEY_CHECK,
        taskId: COURSE_COPILOT_AI_TASKS.ANSWER_KEY_CHECK,
        task: LlmTask.COURSE_COPILOT_ANSWER_KEY_CHECK,
        maxTokens: SPECIALIST_MAX_TOKENS.ANSWER_KEY_CHECK,
        usageMetadata,
        variables: {
          brief_json: briefForPrompt(brief),
          questions_json: JSON.stringify(questions, null, 2),
        },
      });
      return compareAnswerKey(content, normaliseSolverAnswers(data));
    } catch (error) {
      this.logger.warn(
        `Answer-key check skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
