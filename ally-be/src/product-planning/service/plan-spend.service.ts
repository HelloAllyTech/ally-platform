import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  computeCostUsd,
  computeServiceCostUsd,
} from 'src/analytics/constants/llm-pricing.constants';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import {
  PLAN_SPEND_COST_SCALE,
  PLANNING_DEFAULTS,
} from '../constants/product-planning.constants';
import { PlanSpendEntry } from '../entity/plan-spend-entry.entity';
import { PlanStage } from '../enum/product-planning.enum';

/** One model call's usage, as the caller measured it. */
export interface PlanModelUsage {
  sessionId: string | null;
  stage: PlanStage | null;
  actorUserId: number | null;
  /** Specialist registry id; null for the conductor. */
  specialist?: string | null;
  /** AI task registry id. */
  taskId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Prompt-cache reads. */
  cachedTokens?: number;
  /** Prompt-cache writes (Anthropic only). */
  cacheWriteTokens?: number;
  /** Gemini: total incl. thinking, which is billed at the output rate. */
  totalTokens?: number;
  /**
   * A cost the caller already knows (the runner's per-step cost). Taken as
   * priced and used as-is instead of the pricing table.
   */
  knownCostUsd?: number;
}

export interface PlanSpendBreakdownRow {
  key: string | null;
  costUsd: number;
}

export interface PlanSpendSummary {
  totalUsd: number;
  /** True when any row was unpriced: the total is a floor, say "approximate". */
  approximate: boolean;
  byStage: PlanSpendBreakdownRow[];
  byActor: { actorUserId: number | null; costUsd: number }[];
  bySpecialist: PlanSpendBreakdownRow[];
}

export type PlanCeilingState = 'ok' | 'warn' | 'wrap_up' | 'stop';

export interface PlanCeilingCheck {
  spentUsd: number;
  ceilingUsd: number;
  /**
   * ok → under 80%. warn → 80% or more of the plan ceiling. stop → the plan
   * ceiling is reached; the turn must not start until the lead raises it.
   * wrap_up → the private Idea stage reached 80% of its wrap-up point: the
   * copilot helps the author file or park instead of stopping them (rev 5.2).
   */
  state: PlanCeilingState;
  approximate: boolean;
}

const round = (value: number): number =>
  Number(value.toFixed(PLAN_SPEND_COST_SCALE));

/**
 * The plan's spend ledger: every model call made for a plan, priced when it is
 * written, so the meter is correct at any moment (rev 5.2 §B.11).
 *
 * Writes are AWAITED. The fire-and-forget pattern used for `llm_usage` is what
 * left interview spend invisible; a meter that can lag is a meter nobody can
 * hold a ceiling against.
 */
@Injectable()
export class PlanSpendService {
  constructor(
    @InjectRepository(PlanSpendEntry)
    private readonly repository: Repository<PlanSpendEntry>,
    @InjectRepository(BuilderSettings)
    private readonly settingsRepository: Repository<BuilderSettings>,
  ) {}

  /** Price one call against the shared pricing table (or take a known cost). */
  static price(usage: PlanModelUsage): { costUsd: number; priced: boolean } {
    if (usage.knownCostUsd !== undefined) {
      return { costUsd: Math.max(0, usage.knownCostUsd), priced: true };
    }
    if (usage.provider === 'anthropic') {
      return computeCostUsd(usage.model, usage.tokensIn, usage.tokensOut, {
        cacheReadTokens: usage.cachedTokens ?? 0,
        cacheCreationTokens: usage.cacheWriteTokens ?? 0,
      });
    }
    return computeServiceCostUsd('llm', usage.provider, usage.model, {
      promptTokens: usage.tokensIn,
      completionTokens: usage.tokensOut,
      cachedTokens: usage.cachedTokens ?? 0,
      totalTokens: usage.totalTokens,
    });
  }

  async record(usage: PlanModelUsage): Promise<PlanSpendEntry> {
    const { costUsd, priced } = PlanSpendService.price(usage);
    return this.repository.save(
      this.repository.create({
        sessionId: usage.sessionId,
        stage: usage.stage,
        actorUserId: usage.actorUserId,
        specialist: usage.specialist ?? null,
        taskId: usage.taskId,
        provider: usage.provider,
        model: usage.model,
        tokensIn: Math.max(0, Math.round(usage.tokensIn)),
        tokensOut: Math.max(0, Math.round(usage.tokensOut)),
        cachedTokens: Math.max(0, Math.round(usage.cachedTokens ?? 0)),
        cacheWriteTokens: Math.max(0, Math.round(usage.cacheWriteTokens ?? 0)),
        costUsd: round(costUsd).toFixed(PLAN_SPEND_COST_SCALE),
        priced,
      }),
    );
  }

  async summarize(sessionId: string): Promise<PlanSpendSummary> {
    const rows = await this.repository.find({ where: { sessionId } });
    return PlanSpendService.summarizeRows(rows);
  }

  /** Pure, for the meter and for tests. */
  static summarizeRows(
    rows: Pick<
      PlanSpendEntry,
      'stage' | 'actorUserId' | 'specialist' | 'costUsd' | 'priced'
    >[],
  ): PlanSpendSummary {
    const byStage = new Map<string | null, number>();
    const byActor = new Map<number | null, number>();
    const bySpecialist = new Map<string | null, number>();
    let total = 0;
    let approximate = false;
    for (const row of rows) {
      const cost = Number(row.costUsd) || 0;
      total += cost;
      if (!row.priced) approximate = true;
      byStage.set(
        row.stage ?? null,
        (byStage.get(row.stage ?? null) ?? 0) + cost,
      );
      byActor.set(
        row.actorUserId ?? null,
        (byActor.get(row.actorUserId ?? null) ?? 0) + cost,
      );
      bySpecialist.set(
        row.specialist ?? null,
        (bySpecialist.get(row.specialist ?? null) ?? 0) + cost,
      );
    }
    const sorted = <K>(map: Map<K, number>) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]);
    return {
      totalUsd: round(total),
      approximate,
      byStage: sorted(byStage).map(([key, costUsd]) => ({
        key,
        costUsd: round(costUsd),
      })),
      byActor: sorted(byActor).map(([actorUserId, costUsd]) => ({
        actorUserId,
        costUsd: round(costUsd),
      })),
      bySpecialist: sorted(bySpecialist).map(([key, costUsd]) => ({
        key,
        costUsd: round(costUsd),
      })),
    };
  }

  /**
   * Where a plan stands against its ceiling, for the stage a turn is about to
   * run in. Read before a turn, never mid-call: a turn that started under the
   * ceiling finishes cleanly.
   */
  async checkCeiling(
    sessionId: string,
    stage: PlanStage,
  ): Promise<PlanCeilingCheck> {
    const [summary, settings] = await Promise.all([
      this.summarize(sessionId),
      this.settingsRepository.findOne({
        where: {},
        order: { createdAt: 'ASC' },
      }),
    ]);
    const planCeiling =
      Number(settings?.planCeilingUsd) || PLANNING_DEFAULTS.PLAN_CEILING_USD;
    const ideaCeiling =
      Number(settings?.planIdeaCeilingUsd) ||
      PLANNING_DEFAULTS.IDEA_CEILING_USD;
    return PlanSpendService.ceilingState(
      summary,
      stage,
      planCeiling,
      Math.min(ideaCeiling, planCeiling),
    );
  }

  /** Pure, for tests. */
  static ceilingState(
    summary: Pick<PlanSpendSummary, 'totalUsd' | 'approximate'>,
    stage: PlanStage,
    planCeilingUsd: number,
    ideaCeilingUsd: number,
  ): PlanCeilingCheck {
    const warnAt = PLANNING_DEFAULTS.WARN_AT_FRACTION;
    const spent = summary.totalUsd;
    if (stage === PlanStage.IDEA) {
      return {
        spentUsd: spent,
        ceilingUsd: ideaCeilingUsd,
        state: spent >= ideaCeilingUsd * warnAt ? 'wrap_up' : 'ok',
        approximate: summary.approximate,
      };
    }
    let state: PlanCeilingState = 'ok';
    if (spent >= planCeilingUsd) state = 'stop';
    else if (spent >= planCeilingUsd * warnAt) state = 'warn';
    return {
      spentUsd: spent,
      ceilingUsd: planCeilingUsd,
      state,
      approximate: summary.approximate,
    };
  }
}
