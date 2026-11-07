import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import {
  DebriefSettings,
  DebriefStep,
} from '../constants/debrief-release.constants';

/**
 * The production budget (plan §10.1): every eligible session adds to the
 * month's pool, a run may spend the lower of the ceiling and twice its fair
 * share of what is left, never less than the floor that covers the minimum
 * path, and nothing once the month's hard cap is spent.
 */
export interface PoolState {
  /** Eligible sessions so far this month, this one included. */
  sessionsThisMonth: number;
  /** What debrief runs have spent this month (production only). */
  spentThisMonthUsd: number;
  /** 0..1, how far through the month we are. */
  monthElapsed: number;
}

export function effectiveRunCeiling(
  settings: DebriefSettings,
  pool: PoolState,
): number {
  if (pool.spentThisMonthUsd >= settings.monthlyCapUsd) return 0;
  const added = pool.sessionsThisMonth * settings.poolPerSessionUsd;
  const left = Math.min(
    added - pool.spentThisMonthUsd,
    settings.monthlyCapUsd - pool.spentThisMonthUsd,
  );
  const elapsed = Math.min(Math.max(pool.monthElapsed, 1 / 30), 1);
  // Sessions still to come this month, projected from the pace so far.
  const projectedRemaining = Math.max(
    1,
    (pool.sessionsThisMonth / elapsed) * (1 - elapsed),
  );
  const fairShare = Math.max(0, left) / projectedRemaining;
  const ceiling = Math.min(settings.runCeilingUsd, 2 * fairShare);
  const capLeft = settings.monthlyCapUsd - pool.spentThisMonthUsd;
  return Math.min(Math.max(ceiling, settings.runFloorUsd), capLeft);
}

/** Expected answer size per step, in tokens: the cost estimate's output half. */
const OUTPUT_TOKENS: Record<DebriefStep, number> = {
  [DebriefStep.SAFETY_READER]: 600,
  [DebriefStep.ANALYST]: 3000,
  [DebriefStep.PROGRESS_READER]: 600,
  [DebriefStep.GUIDANCE_LOOKUP]: 0,
  [DebriefStep.WRITER]: 2500,
  [DebriefStep.CHECKS]: 0,
  [DebriefStep.EVALUATOR]: 2000,
  [DebriefStep.REVISER]: 2500,
};

/** Thinking models bill reasoning as output; allow for it rather than under-reserve. */
const THINKING_ALLOWANCE = 2;

/**
 * Reserve-then-spend: the cost a step is expected to have, from the size of
 * what it will be sent. Over-estimates on purpose — a reservation that is too
 * small lets a run overspend its ceiling, one that is too large only takes the
 * cheaper path a little early. An unpriced model reserves Infinity, so it
 * never runs (plan §8.9).
 */
export function estimateStepCostUsd(
  step: DebriefStep,
  model: string | null | undefined,
  inputChars: number,
): number {
  if (!model || OUTPUT_TOKENS[step] === 0) return 0;
  const promptTokens = Math.ceil(inputChars / 3);
  const { costUsd, priced } = computeCostUsd(
    model,
    promptTokens,
    OUTPUT_TOKENS[step] * THINKING_ALLOWANCE,
  );
  return priced ? costUsd : Number.POSITIVE_INFINITY;
}

/**
 * The fallback ladder (plan §10.3), in order. A run records the deepest rung
 * it reached; 0 means it ran the recipe as written.
 */
export enum FallbackRung {
  NONE = 0,
  SKIP_SECOND_REVISION = 1,
  SKIP_PROGRESS = 2,
  ONE_GUIDANCE_LOOKUP = 3,
  SKIP_FIRST_REVISION = 4,
  WRITER_AND_CHECKS_ONLY = 5,
  PERSON_FINISHES = 6,
}
