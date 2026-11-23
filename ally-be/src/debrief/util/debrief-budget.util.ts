import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { DebriefSettings } from '../constants/debrief-release.constants';

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

/** A model's price per million tokens, as the debrief graph budgets with it. */
export interface ModelPrice {
  input_per_m: number;
  output_per_m: number;
}

/**
 * The price of every model a run may use, from the same pricing table the
 * usage dashboards bill by. An unpriced model is left out, and the graph
 * never runs a model it has no price for (plan §8.9).
 */
export function modelPrices(
  models: Iterable<string | null | undefined>,
): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const model of models) {
    if (!model || out[model]) continue;
    const input = computeCostUsd(model, 1_000_000, 0);
    if (!input.priced) continue;
    out[model] = {
      input_per_m: input.costUsd,
      output_per_m: computeCostUsd(model, 0, 1_000_000).costUsd,
    };
  }
  return out;
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
