import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { CourseSpine } from '../../conductor/course-spine';
import { GUIDE_AI_TASKS } from '../../constants/guide-ai-tasks.constants';
import { GuideCourseContentService } from '../../content/guide-course-content.service';
import {
  ASSESSOR_OUTPUT_SCHEMA,
  ASSESSOR_SYSTEM_PROMPT,
  AssessorKind,
  SideQuestDifficulty,
  buildAssessorUserMessage,
} from '../../prompts/assessor.prompt';
import {
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../../release/guide-release.bundle';
import {
  GuideCallAttribution,
  GuideModelService,
} from '../../runtime/guide-model.service';

/** A practice question with its key — server-side only. */
export interface AssessorQuestion {
  id: string;
  prompt: string;
  sourceItemId: string;
  options: Array<{
    id: string;
    text: string;
    correct: boolean;
    feedback: string;
  }>;
}

export interface AssessorActivity {
  kind: AssessorKind;
  title: string;
  intro: string;
  questions: AssessorQuestion[];
}

const QUESTIONS_BY_KIND: Record<AssessorKind, [number, number]> = {
  quick_check: [1, 2],
  micro_dilemma: [1, 1],
  spaced_recall: [2, 3],
  predict_beat: [1, 1],
};

const words = (text: string): Set<string> =>
  new Set(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => [...word].length >= 3),
  );

/** How much of a question's wording a graded quiz question shares (0–1). */
export function overlapWithQuiz(prompt: string, quizPrompts: string[]): number {
  const mine = words(prompt);
  if (!mine.size) return 0;
  let worst = 0;
  for (const quiz of quizPrompts) {
    const theirs = words(quiz);
    if (!theirs.size) continue;
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared++;
    worst = Math.max(worst, shared / Math.min(mine.size, theirs.size));
  }
  return worst;
}

/** A practice question too close to a graded one is dropped (plan §4.6). */
export const QUIZ_OVERLAP_LIMIT = 0.6;

/**
 * Keep what is well formed: three options, exactly one correct, a passage
 * the learner has reached, and nothing that rehearses a graded question.
 */
export function cleanAssessorActivity(
  kind: AssessorKind,
  raw: unknown,
  allowedItemIds: Set<string>,
  quizPrompts: string[],
): AssessorActivity | null {
  const value = (raw ?? {}) as Record<string, any>;
  const [, max] = QUESTIONS_BY_KIND[kind];
  const questions: AssessorQuestion[] = [];
  for (const question of Array.isArray(value.questions)
    ? value.questions
    : []) {
    const prompt = String(question?.prompt ?? '').trim();
    const options = Array.isArray(question?.options) ? question.options : [];
    if (!prompt || options.length !== 3) continue;
    if (
      options.filter((option: any) => option?.correct === true).length !== 1
    ) {
      continue;
    }
    const sourceItemId = String(question?.sourceItemId ?? '');
    if (!allowedItemIds.has(sourceItemId)) continue;
    if (overlapWithQuiz(prompt, quizPrompts) >= QUIZ_OVERLAP_LIMIT) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      prompt: prompt.slice(0, 400),
      sourceItemId,
      options: options.map((option: any, index: number) => ({
        id: ['a', 'b', 'c'][index],
        text: String(option?.text ?? '')
          .trim()
          .slice(0, 240),
        correct: option?.correct === true,
        feedback: String(option?.feedback ?? '')
          .trim()
          .slice(0, 300),
      })),
    });
    if (questions.length >= max) break;
  }
  if (!questions.length) return null;
  return {
    kind,
    title:
      String(value.title ?? '')
        .trim()
        .slice(0, 80) || 'A quick practice',
    intro: String(value.intro ?? '')
      .trim()
      .slice(0, 300),
    questions,
  };
}

/**
 * The Assessor specialist (plans/ally-guide/plan.md §7.7): writes the side
 * quests that have right answers, from what the learner has reached, clear
 * of the course's graded questions, at a hidden difficulty.
 */
@Injectable()
export class GuideAssessorService {
  private readonly logger = LoggerService.getInstance(
    GuideAssessorService.name,
  );

  constructor(
    private readonly models: GuideModelService,
    private readonly content: GuideCourseContentService,
  ) {}

  async generate(input: {
    kind: AssessorKind;
    trackId: string;
    spine: CourseSpine;
    languageCode: string;
    focusItemIds: string[];
    difficulty: SideQuestDifficulty;
    bundle: GuideReleaseBundle;
    tier?: GuideBudgetTier;
    attribution: GuideCallAttribution;
    onCost?: (usd: number) => void;
  }): Promise<AssessorActivity | null> {
    const [sources, quizPrompts] = await Promise.all([
      this.content.practiceSources(
        input.trackId,
        input.spine,
        input.languageCode,
        input.focusItemIds,
      ),
      this.content.quizPrompts(input.trackId),
    ]);
    if (!sources.length) return null;
    const { result } = await this.models.complete({
      role: 'assessor',
      bundle: input.bundle,
      tier: input.tier,
      task: LlmTask.GUIDE_ASSESSOR,
      aiTaskId: GUIDE_AI_TASKS.ASSESSOR,
      attribution: input.attribution,
      onCost: input.onCost,
      request: {
        system: [
          {
            text: input.bundle.prompts.assessor?.text ?? ASSESSOR_SYSTEM_PROMPT,
            cache: true,
          },
        ],
        messages: [
          {
            role: 'user',
            content: buildAssessorUserMessage({
              kind: input.kind,
              difficulty: input.difficulty,
              languageCode: input.languageCode,
              sources,
              quizPrompts,
            }),
          },
        ],
        maxTokens: 4_000,
        outputSchema: ASSESSOR_OUTPUT_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        timeoutMs: 30_000,
      },
    });
    if (result.stopReason !== 'end_turn') {
      this.logger.warn(`Assessor stopped with ${result.stopReason}`);
      return null;
    }
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    return cleanAssessorActivity(
      input.kind,
      JSON.parse(text),
      new Set(sources.map((source) => source.itemId)),
      quizPrompts,
    );
  }
}

/** Mark answers against the key. Deterministic: no model grades practice. */
export function gradeAssessorActivity(
  activity: AssessorActivity,
  answers: Array<{ questionId: string; optionId: string }>,
): Array<{
  questionId: string;
  correct: boolean;
  correctOptionId: string;
  feedback: string;
}> {
  const chosen = new Map(answers.map((a) => [a.questionId, a.optionId]));
  return activity.questions.map((question) => {
    const picked = question.options.find(
      (option) => option.id === chosen.get(question.id),
    );
    const right = question.options.find((option) => option.correct)!;
    return {
      questionId: question.id,
      correct: Boolean(picked?.correct),
      correctOptionId: right.id,
      feedback: picked?.feedback ?? right.feedback,
    };
  });
}
