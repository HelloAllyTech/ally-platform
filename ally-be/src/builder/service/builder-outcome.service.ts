import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  loadPromptTemplate,
  promptModelOr,
} from 'src/common/util/prompt-template.util';
import { BUILDER_OUTCOME_SYSTEM, renderPrompt } from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderLessonCuratorService } from './builder-lesson-curator.service';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderLessonRepository } from '../repository/builder-knowledge.repository';
import {
  BuilderPrFeedbackRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import {
  BuilderExemplarOutcome,
  BuilderFailureTag,
  BuilderLessonCategory,
  BuilderPrFeedbackKind,
} from '../enum/builder.enum';
import {
  BUILDER_AI_TASKS,
  BUILDER_MAX_TOKENS,
} from '../constants/builder.constants';

/**
 * The feedback half of the flywheel: turn what happened to a build into
 * something the next build reads.
 *
 * Three signals, none of which Builder previously used:
 *
 *  - **Merge outcomes.** A merged PR and one closed without merging looked
 *    identical, so nothing could tell good work from rejected work.
 *  - **Review comments.** The single highest-value source in the system —
 *    a person spent attention explaining precisely what was wrong with the
 *    code — and it evaporated into GitHub with nothing reading it.
 *  - **Fix runs and CI failures.** How much correction the work needed after
 *    it was called finished.
 *
 * Each becomes a categorised outcome (so trends exist across builds rather
 * than a story per build) plus candidate lessons for the curator, and updates
 * the counters that decide which lessons keep earning their place.
 */
@Injectable()
export class BuilderOutcomeService {
  private readonly logger = LoggerService.getInstance(
    BuilderOutcomeService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly feedbackRepository: BuilderPrFeedbackRepository,
    private readonly lessonRepository: BuilderLessonRepository,
    private readonly exemplarService: BuilderExemplarService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly curatorService: BuilderLessonCuratorService,
    private readonly llmCompletion: LlmCompletionService,
    /** The categoriser's instructions and, when it names one, its model. */
    private readonly prompts: PromptSharedService,
  ) {}

  /**
   * The hourly catch-up.
   *
   * Hooks on merge and settle do most of the work; this exists because a hook
   * that fails, or a PR merged while the service was down, would otherwise
   * leave an exemplar permanently stale. Idempotent by `lastOutcomeSyncAt`.
   */
  async sweep(): Promise<{ refreshed: number }> {
    const unsettled = await this.exemplarService.listUnsettled();
    let refreshed = 0;

    for (const exemplar of unsettled) {
      try {
        await this.processSession(exemplar.sessionId);
        refreshed += 1;
      } catch (error) {
        this.logger.warn(
          `Outcome sweep failed for session ${exemplar.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Fold anything the sweep harvested into the curated set while we are here.
    await this.curatorService.consolidate().catch(() => undefined);
    return { refreshed };
  }

  /**
   * Learn from one session: refresh its exemplar, categorise how it went, and
   * harvest candidate lessons from the feedback it collected.
   */
  async processSession(sessionId: string): Promise<void> {
    await this.exemplarService.refreshOutcome(sessionId);

    const exemplar = await this.exemplarService.findBySession(sessionId);
    if (!exemplar) return;

    // Nothing to categorise on a build that went cleanly: merged, no fix runs,
    // no comments. Saying so costs a model call and teaches nobody anything.
    const feedback = await this.feedbackRepository.listBySession(sessionId);
    const settled = exemplar.outcome !== BuilderExemplarOutcome.OPEN;
    const wentCleanly =
      exemplar.outcome === BuilderExemplarOutcome.MERGED &&
      !exemplar.fixRunCount &&
      !feedback.length;
    if (!settled || wentCleanly) return;

    const already = new Set(exemplar.failureTags ?? []);
    const analysis = await this.categorise(sessionId, exemplar, feedback);
    if (!analysis) return;

    const freshTags = analysis.tags.filter((tag) => !already.has(tag));
    if (freshTags.length) {
      await this.exemplarService.recordFailureTags(sessionId, freshTags);
    }

    // Candidate lessons, not active ones: the curator decides whether each is
    // new, a duplicate of something already known, or not worth a slot.
    for (const lesson of analysis.lessons.slice(0, 3)) {
      await this.knowledgeService.recordLesson({
        sessionId,
        repos: exemplar.repos ?? null,
        category: lesson.category,
        lesson: lesson.text,
      });
    }

    await this.applyLessonOutcomes(analysis);

    if (analysis.lessons.length || freshTags.length) {
      this.logger.info(
        `Session ${sessionId} (${exemplar.outcome}) produced ${analysis.lessons.length} candidate lesson(s) and ${freshTags.length} new tag(s).`,
      );
    }
  }

  /**
   * Mark a lesson against when it was in front of the agent and did not
   * prevent the thing it warns about — evidence for the curator's retirement
   * decisions. Credit for cited lessons came from the old runner's reports,
   * which issue builds do not write.
   */
  private async applyLessonOutcomes(analysis: OutcomeAnalysis): Promise<void> {
    if (analysis.contradictedLessonIds.length) {
      await this.lessonRepository.recordContradicted(
        analysis.contradictedLessonIds,
      );
    }
  }

  /**
   * One cheap model call to categorise the outcome and draft candidate
   * lessons.
   *
   * A model rather than rules because the input is prose written by people —
   * "this needs a null check for a deleted tenant" has to become
   * `review_correctness` plus a reusable lesson, and no keyword table does
   * that. Returns null rather than throwing: the flywheel losing one build's
   * analysis is a missed improvement, not a failure.
   */
  private async categorise(
    sessionId: string,
    exemplar: { outcome: string; title: string; repos?: string[] | null },
    feedback: {
      kind: BuilderPrFeedbackKind;
      author?: string | null;
      body?: string | null;
      path?: string | null;
    }[],
  ): Promise<OutcomeAnalysis | null> {
    const activeLessons = await this.lessonRepository.listActiveForRepos(
      exemplar.repos ?? undefined,
    );

    try {
      const [template, target] = await Promise.all([
        loadPromptTemplate(this.prompts, BUILDER_OUTCOME_SYSTEM.code),
        promptModelOr(
          this.prompts,
          BUILDER_OUTCOME_SYSTEM.code,
          this.configService.builder.mechanicalModel,
        ),
      ]);
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.OUTCOME_CATEGORISE,

        task: LlmTask.BUILDER_OUTCOME_CATEGORISE,

        maxTokens: BUILDER_MAX_TOKENS,

        // The prompt's model when the Skills Store names one, else the mechanical model.
        ...target,

        system: renderPrompt(BUILDER_OUTCOME_SYSTEM, template, {}),

        usageMetadata: {
          builderSessionId: sessionId,
          feedback: feedback.length,
        },

        prompt: [
          `## The build\n${exemplar.title} (${exemplar.repos?.join(', ') ?? 'unknown repos'})`,
          `Outcome: ${exemplar.outcome}`,
          '',
          '## What people and CI said',
          feedback.length
            ? feedback
                .map(
                  (item) =>
                    `- (${item.kind}${item.path ? `, ${item.path}` : ''}) ${
                      item.body ?? ''
                    }`,
                )
                .join('\n')
            : '(nothing recorded)',
          '',
          '## Lessons this build already had access to',
          activeLessons.length
            ? activeLessons
                .map((lesson) => `- [${lesson.id}] ${lesson.lesson}`)
                .join('\n')
            : '(none)',
          '',
          'Return the JSON object and nothing else.',
        ].join('\n'),
      });

      const text = result.text;
      return parseAnalysis(text, new Set(activeLessons.map((l) => l.id)));
    } catch (error) {
      this.logger.warn(
        `Could not categorise session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface OutcomeAnalysis {
  tags: BuilderFailureTag[];
  lessons: { category: BuilderLessonCategory; text: string }[];
  contradictedLessonIds: string[];
}

const TAGS = new Set<string>(Object.values(BuilderFailureTag));
const CATEGORIES = new Set<string>(Object.values(BuilderLessonCategory));

/**
 * Parse the analysis, keeping only values we recognise.
 *
 * `contradictedLessonIds` in particular is filtered against the ids actually
 * offered: an invented id would silently penalise nothing, or worse, the wrong
 * lesson.
 */
export function parseAnalysis(
  text: string,
  knownLessonIds: Set<string>,
): OutcomeAnalysis | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  for (const raw of [...blocks, text]) {
    const start = raw.indexOf('{');
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1));
      return {
        tags: (Array.isArray(parsed.tags) ? parsed.tags : [])
          .map((tag: unknown) => String(tag))
          .filter((tag: string) => TAGS.has(tag)) as BuilderFailureTag[],
        lessons: (Array.isArray(parsed.lessons) ? parsed.lessons : [])
          .map((entry: any) => ({
            category: CATEGORIES.has(String(entry?.category))
              ? (String(entry.category) as BuilderLessonCategory)
              : BuilderLessonCategory.GOTCHA,
            text: String(entry?.lesson ?? entry?.text ?? '').trim(),
          }))
          .filter((entry: { text: string }) => entry.text.length > 10),
        contradictedLessonIds: (Array.isArray(parsed.contradictedLessonIds)
          ? parsed.contradictedLessonIds
          : []
        )
          .map((id: unknown) => String(id))
          .filter((id: string) => knownLessonIds.has(id)),
      };
    } catch {
      continue;
    }
  }
  return null;
}
