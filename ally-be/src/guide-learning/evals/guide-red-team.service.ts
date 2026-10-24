import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  AgentEvalCaseSource,
  AgentEvalCaseStatus,
} from 'src/llm-agent/harness/enum/eval.enum';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { GUIDE_AI_TASKS } from 'src/guide/constants/guide-ai-tasks.constants';
import { evaluatorPolicy } from 'src/guide/release/guide-release.bundle';
import { GuideModelService } from 'src/guide/runtime/guide-model.service';
import {
  GUIDE_LEARNING_COST_KEY,
  JUDGE_TIMEOUT_MS,
  RED_TEAM_CASES_PER_CATEGORY,
  SUITE_KEYS,
} from '../constants/guide-learning.constants';
import {
  BudgetSpentError,
  GuideJudgeService,
} from '../evaluator/guide-judge.service';
import {
  RED_TEAM_OUTPUT_SCHEMA,
  RED_TEAM_PROMPT_VERSION,
  RED_TEAM_SYSTEM_PROMPT,
  buildRedTeamMessage,
} from '../prompts/red-team.prompt';
import { RED_TEAM_CATEGORIES, RedTeamCategory } from './categories';
import { GuideEvalCaseService } from './guide-eval-case.service';

export const RED_TEAM_TASK = 'ally-guide-red-team';

interface GeneratedCase {
  title: string;
  message: string;
  history: Array<{ role: 'learner' | 'ally'; text: string }>;
  forbiddenPhrases: string[];
}

export function parseRedTeamCases(text: string): GeneratedCase[] {
  const raw = JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, ''));
  const list: unknown[] = Array.isArray(raw?.cases) ? raw.cases : [];
  return list
    .map((entry) => entry as Record<string, any>)
    .filter((c) => typeof c?.message === 'string' && c.message.trim())
    .map((c) => ({
      title: String(c.title ?? '').slice(0, 120) || 'Red-team case',
      message: String(c.message).slice(0, 2000),
      history: (Array.isArray(c.history) ? c.history : [])
        .filter(
          (h: any) =>
            (h?.role === 'learner' || h?.role === 'ally') &&
            typeof h.text === 'string',
        )
        .slice(-3)
        .map((h: any) => ({
          role: h.role,
          text: String(h.text).slice(0, 600),
        })),
      forbiddenPhrases: (Array.isArray(c.forbiddenPhrases)
        ? c.forbiddenPhrases
        : []
      )
        .map((p: unknown) => String(p).trim())
        .filter((p: string) => p.length >= 3)
        .slice(0, 8),
    }));
}

/**
 * The red-team generator (plans/ally-guide/plan.md §7.13): weekly, a model
 * writes adversarial learner messages for each hard category against a real
 * course, including noisy and code-mixed ones (Stacks: Synthetic Datasets for
 * Red Teaming Agent Systems). Every case lands PROPOSED: nothing a model
 * wrote decides a gate until a person has read it and accepted it.
 *
 * Shares the evaluator's daily budget; stops at it.
 */
@Injectable()
export class GuideRedTeamService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(GuideRedTeamService.name);

  constructor(
    private readonly models: GuideModelService,
    private readonly judges: GuideJudgeService,
    private readonly cases: GuideEvalCaseService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('weekly', RED_TEAM_TASK, () =>
      this.generate({}).then(() => undefined),
    );
  }

  /** The course Ally is used on most in the last 30 days. */
  async busiestTrack(): Promise<string | null> {
    const [row]: Array<{ trackId: string }> = await this.dataSource.query(
      `SELECT "trackId" FROM "guide_threads"
        WHERE "updatedAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
    );
    return row?.trackId ?? null;
  }

  private async outline(trackId: string) {
    const [track]: Array<{ title: string }> = await this.dataSource.query(
      `SELECT "title" FROM "tracks" WHERE "id" = $1`,
      [trackId],
    );
    if (!track) throw new BadRequestException('Course not found');
    const items: Array<{ title: string; type: string }> =
      await this.dataSource.query(
        `SELECT ti."title", ti."type" FROM "track_items" ti
           JOIN "track_sections" ts ON ts."id" = ti."trackSectionId"
          WHERE ti."trackId" = $1
          ORDER BY ts."order", ti."order"`,
        [trackId],
      );
    return {
      title: track.title,
      lines: items.map((item) => `${item.title} (${item.type.toLowerCase()})`),
    };
  }

  async generate(input: {
    trackId?: string;
    categories?: string[];
    perCategory?: number;
  }): Promise<{
    trackId: string | null;
    created: number;
    duplicates: number;
    byCategory: Record<string, number>;
    stoppedBy: string | null;
  }> {
    const trackId = input.trackId ?? (await this.busiestTrack());
    const report = {
      trackId,
      created: 0,
      duplicates: 0,
      byCategory: {} as Record<string, number>,
      stoppedBy: null as string | null,
    };
    if (!trackId) {
      report.stoppedBy = 'no course has Ally conversations yet';
      return report;
    }
    const outline = await this.outline(trackId);
    const bundle = await this.judges.evaluatorBundle();
    const policy = evaluatorPolicy(bundle.policy);
    const categories: RedTeamCategory[] = input.categories?.length
      ? RED_TEAM_CATEGORIES.filter((c) => input.categories!.includes(c.id))
      : RED_TEAM_CATEGORIES;
    const count = Math.max(
      1,
      Math.min(input.perCategory ?? RED_TEAM_CASES_PER_CATEGORY, 10),
    );
    for (const category of categories) {
      try {
        await this.judges.assertBudget(policy.dailyBudgetUsd);
      } catch (error) {
        if (error instanceof BudgetSpentError) {
          report.stoppedBy = error.message;
          break;
        }
        throw error;
      }
      try {
        const { result } = await this.models.complete({
          role: 'red_team',
          bundle,
          task: LlmTask.GUIDE_RED_TEAM,
          aiTaskId: GUIDE_AI_TASKS.RED_TEAM,
          attribution: { costAgentKey: GUIDE_LEARNING_COST_KEY },
          request: {
            system: [{ text: RED_TEAM_SYSTEM_PROMPT, cache: true }],
            messages: [
              {
                role: 'user',
                content: buildRedTeamMessage({
                  category: category.id,
                  brief: category.brief,
                  count,
                  courseTitle: outline.title,
                  outline: outline.lines,
                }),
              },
            ],
            maxTokens: 4_000,
            outputSchema: RED_TEAM_OUTPUT_SCHEMA as unknown as Record<
              string,
              unknown
            >,
            timeoutMs: JUDGE_TIMEOUT_MS * 2,
          },
        });
        const text = result.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        for (const generated of parseRedTeamCases(text).slice(0, count)) {
          const { created } = await this.cases.insert({
            suiteKey: SUITE_KEYS.RED_TEAM,
            source: AgentEvalCaseSource.RED_TEAM,
            status: AgentEvalCaseStatus.PROPOSED,
            category: category.id,
            safety: category.safety,
            title: generated.title,
            input: {
              trackId,
              progress: 1,
              mode: category.setup?.mode ?? 'NORMAL',
              guidance: 'walk',
              channel: 'text',
              history: generated.history,
              message: generated.message,
              ...(category.setup?.quizOpen ? { quizOpen: true } : {}),
            },
            expectations: {
              ...category.expectations,
              ...(generated.forbiddenPhrases.length
                ? { forbiddenPhrases: generated.forbiddenPhrases }
                : {}),
            },
            notes: `red team prompt v${RED_TEAM_PROMPT_VERSION}`,
          });
          if (created) {
            report.created++;
            report.byCategory[category.id] =
              (report.byCategory[category.id] ?? 0) + 1;
          } else {
            report.duplicates++;
          }
        }
      } catch (error) {
        this.logger.warn(
          `Red team ${category.id} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.logger.info(
      `Ally red team: ${report.created} proposed cases on ${trackId}` +
        (report.stoppedBy ? ` (stopped: ${report.stoppedBy})` : ''),
    );
    return report;
  }
}
