import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import {
  PM_PIPELINE,
  PM_UNPRICED_MODEL_USD,
} from '../constants/pm-agent-pipeline.constants';

/** One open reservation: what a paid step may spend at most. */
export interface PmReservation {
  id: number;
  scope: 'lane' | 'critic';
  lane: string;
  maxUsd: number;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Upper bound of one model call's cost: the whole prompt (≈3 chars per token, plus the tool
 * schemas' overhead) at the input rate and the full `maxTokens` at the output rate. A model
 * the pricing table does not know is priced at a deliberately high rate, so an unknown model
 * reserves more, never less.
 */
export function estimateCallMaxUsd(
  model: string,
  inputChars: number,
  maxOutputTokens: number,
): number {
  const inputTokens = Math.ceil(inputChars / 3) + 800;
  const priced = computeCostUsd(model, inputTokens, maxOutputTokens);
  if (priced.priced) return round4(priced.costUsd);
  return round4(
    (inputTokens / 1_000_000) * PM_UNPRICED_MODEL_USD.input +
      (maxOutputTokens / 1_000_000) * PM_UNPRICED_MODEL_USD.output,
  );
}

/** Actual cost of a finished call, priced the way the budget read-out prices llm_usage. */
export function actualCallUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const priced = computeCostUsd(
    model,
    Math.max(0, inputTokens - cachedTokens),
    outputTokens,
    { cacheReadTokens: cachedTokens },
  );
  if (priced.priced) return round4(priced.costUsd);
  return round4(
    (inputTokens / 1_000_000) * PM_UNPRICED_MODEL_USD.input +
      (outputTokens / 1_000_000) * PM_UNPRICED_MODEL_USD.output,
  );
}

/**
 * The reserve-before-spend ledger of ONE run (plan §10).
 *
 * The run's cap was reserved against the month when the run started (pm_agent_runs.reservedUsd,
 * counted by the budget read-out until the run finishes). Inside the run, every paid step
 * reserves its maximum cost here first; a step that cannot reserve is skipped, so the run can
 * never overspend its cap whatever the model does. Settling moves the reservation to spent
 * (the actual figure, which may be lower); releasing returns it.
 *
 * Three nested caps:
 *  - the run cap;
 *  - the critic's share, held back from the lanes so a greedy lane cannot leave the critic
 *    unable to run (and its candidates unable to reach the feed);
 *  - a per-lane cap, so one lane cannot starve the others.
 */
export class PmRunLedger {
  private nextId = 1;
  private readonly open = new Map<number, PmReservation>();
  private spentUsd = 0;
  private criticSpentUsd = 0;
  private readonly laneSpent = new Map<string, number>();
  private laneCapUsd = Number.POSITIVE_INFINITY;

  constructor(
    readonly runCapUsd: number,
    private readonly criticShare: number = PM_PIPELINE.CRITIC_SHARE,
  ) {}

  /** The critic's held-back share of the run cap. */
  get criticBudgetUsd(): number {
    return round4(this.runCapUsd * this.criticShare);
  }

  /** What the lanes may spend between them. */
  get laneBudgetUsd(): number {
    return round4(this.runCapUsd - this.criticBudgetUsd);
  }

  /** Divide the lane budget over `laneCount` lanes (later lanes may use what earlier left). */
  setLaneCount(laneCount: number): void {
    const n = Math.max(1, laneCount);
    const share = n === 1 ? 1 : Math.max(1 / n, PM_PIPELINE.LANE_MAX_SHARE);
    this.laneCapUsd = round4(this.laneBudgetUsd * Math.min(1, share));
  }

  get spent(): number {
    return round4(this.spentUsd);
  }

  get reserved(): number {
    let sum = 0;
    for (const r of this.open.values()) sum += r.maxUsd;
    return round4(sum);
  }

  /** Run budget not yet spent or reserved. */
  get remainingUsd(): number {
    return round4(Math.max(0, this.runCapUsd - this.spentUsd - this.reserved));
  }

  /** What lanes can still reserve (the critic's unspent share excluded). */
  get laneRemainingUsd(): number {
    const criticHeld = Math.max(0, this.criticBudgetUsd - this.criticSpentUsd);
    const criticOpen = [...this.open.values()]
      .filter((r) => r.scope === 'critic')
      .reduce((sum, r) => sum + r.maxUsd, 0);
    return round4(
      Math.max(0, this.remainingUsd - Math.max(0, criticHeld - criticOpen)),
    );
  }

  laneSpentUsd(lane: string): number {
    return round4(this.laneSpent.get(lane) ?? 0);
  }

  /** Reserve `maxUsd` for one paid step, or null when any cap would be exceeded. */
  reserve(
    scope: 'lane' | 'critic',
    lane: string,
    maxUsd: number,
  ): PmReservation | null {
    const amount = round4(Math.max(0, maxUsd));
    if (scope === 'critic') {
      if (amount > this.remainingUsd) return null;
    } else {
      if (amount > this.laneRemainingUsd) return null;
      const laneOpen = [...this.open.values()]
        .filter((r) => r.scope === 'lane' && r.lane === lane)
        .reduce((sum, r) => sum + r.maxUsd, 0);
      if (this.laneSpentUsd(lane) + laneOpen + amount > this.laneCapUsd) {
        return null;
      }
    }
    const reservation: PmReservation = {
      id: this.nextId++,
      scope,
      lane,
      maxUsd: amount,
    };
    this.open.set(reservation.id, reservation);
    return reservation;
  }

  /** The step ran: record what it actually cost and free the rest of the reservation. */
  settle(reservation: PmReservation, actualUsd: number): void {
    if (!this.open.delete(reservation.id)) return;
    const cost = Math.max(0, actualUsd);
    this.spentUsd += cost;
    if (reservation.scope === 'critic') this.criticSpentUsd += cost;
    else
      this.laneSpent.set(
        reservation.lane,
        (this.laneSpent.get(reservation.lane) ?? 0) + cost,
      );
  }

  /** The step did not run (or failed before the provider billed): give it all back. */
  release(reservation: PmReservation): void {
    this.open.delete(reservation.id);
  }
}
