import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { GUIDE_AI_TASKS } from 'src/guide/constants/guide-ai-tasks.constants';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_BUNDLE,
  GuideReleaseBundle,
} from 'src/guide/release/guide-release.bundle';
import { GuideModelService } from 'src/guide/runtime/guide-model.service';
import {
  BUDGETED_ROLES,
  GUIDE_LEARNING_COST_KEY,
  JUDGE_MAX_TOKENS,
  JUDGE_RESERVE_USD,
  JUDGE_TIMEOUT_MS,
} from '../constants/guide-learning.constants';
import {
  EVALUATOR_SYSTEM_PROMPT,
  JudgeWindowInput,
  buildJudgeMessage,
} from '../prompts/evaluator.prompt';
import {
  Judgement,
  RUBRIC_OUTPUT_SCHEMA,
  modelFamily,
  parseJudgement,
} from './rubric';

export type JudgeRole = 'evaluator_critic' | 'evaluator_verifier';

export class BudgetSpentError extends Error {
  constructor(spent: number, budget: number) {
    super(
      `The learning loop's daily budget is spent ($${spent.toFixed(2)} of $${budget})`,
    );
  }
}

/**
 * The evaluator's two judges and the learning loop's daily budget
 * (plans/ally-guide/plan.md §7.13, Appendix A `evaluator.dailyBudgetUsd`).
 *
 * Routes come from the GA release's `modelRouting`, falling back to the
 * code defaults for a GA seeded before these roles existed — so swapping the
 * critic's model is a release, like any other role. Every call is charged to
 * the ledger under `ally_guide_learning`, never to a learner or tenant.
 */
@Injectable()
export class GuideJudgeService {
  constructor(
    private readonly models: GuideModelService,
    private readonly releases: AgentReleaseService,
    private readonly dataSource: DataSource,
  ) {}

  /** The GA bundle, with the learning loop's routes filled in where it has none. */
  async evaluatorBundle(): Promise<GuideReleaseBundle> {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    const bundle = (ga?.bundle ??
      GUIDE_DEFAULT_BUNDLE) as unknown as GuideReleaseBundle;
    return {
      ...bundle,
      modelRouting: {
        ...GUIDE_DEFAULT_BUNDLE.modelRouting,
        ...bundle.modelRouting,
      },
    };
  }

  /** What the budgeted roles have spent since 00:00 UTC. */
  async spentToday(): Promise<number> {
    const rows: Array<{ usd: string | null }> = await this.dataSource.query(
      `SELECT COALESCE(sum("usd"), 0) AS usd FROM "agent_cost_ledger"
        WHERE "agentKey" = $1 AND "role" = ANY($2::text[])
          AND "createdAt" >= date_trunc('day', now())`,
      [GUIDE_LEARNING_COST_KEY, [...BUDGETED_ROLES]],
    );
    return Number(rows?.[0]?.usd ?? 0);
  }

  /** Throws BudgetSpentError when less than a call's reserve is left. */
  async assertBudget(budgetUsd: number): Promise<number> {
    const spent = await this.spentToday();
    if (spent + JUDGE_RESERVE_USD > budgetUsd) {
      throw new BudgetSpentError(spent, budgetUsd);
    }
    return budgetUsd - spent;
  }

  /** Whether the two judges would be different model families. */
  familiesDiffer(bundle: GuideReleaseBundle): boolean {
    const critic = this.models.route(bundle, 'evaluator_critic');
    const verifier = this.models.route(bundle, 'evaluator_verifier');
    return (
      modelFamily(critic.provider, critic.model) !==
      modelFamily(verifier.provider, verifier.model)
    );
  }

  async judge(
    role: JudgeRole,
    window: JudgeWindowInput,
    bundle: GuideReleaseBundle,
    ids: { threadId?: string | null; turnId?: string | null },
  ): Promise<{ judgement: Judgement; usd: number }> {
    const { result, route, usd } = await this.models.complete({
      role,
      bundle,
      task:
        role === 'evaluator_critic'
          ? LlmTask.GUIDE_EVALUATOR_CRITIC
          : LlmTask.GUIDE_EVALUATOR_VERIFIER,
      aiTaskId:
        role === 'evaluator_critic'
          ? GUIDE_AI_TASKS.EVALUATOR_CRITIC
          : GUIDE_AI_TASKS.EVALUATOR_VERIFIER,
      attribution: {
        threadId: ids.threadId ?? null,
        turnId: ids.turnId ?? null,
        costAgentKey: GUIDE_LEARNING_COST_KEY,
      },
      request: {
        system: [{ text: EVALUATOR_SYSTEM_PROMPT, cache: true }],
        messages: [{ role: 'user', content: buildJudgeMessage(window) }],
        maxTokens: JUDGE_MAX_TOKENS,
        outputSchema: RUBRIC_OUTPUT_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        timeoutMs: JUDGE_TIMEOUT_MS,
      },
    });
    if (result.stopReason !== 'end_turn') {
      throw new Error(`${role} stopped with ${result.stopReason}`);
    }
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    return {
      judgement: parseJudgement(text, {
        model: route.model,
        provider: route.provider,
      }),
      usd,
    };
  }
}
