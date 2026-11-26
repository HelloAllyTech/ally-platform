import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { MANUAL_WEEKLY_LIMITS } from '../constants/manual-agent.constants';

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const UNPRICED = MANUAL_WEEKLY_LIMITS.UNPRICED_USD_PER_1M;

/**
 * Upper bound of one model call: the whole prompt (≈3 chars a token, plus overhead for the tool
 * schemas) at the input rate and the full `maxTokens` at the output rate. A model the pricing table
 * does not know is priced high, so an unknown model reserves more, never less. Same rule as the PM
 * agent's ledger (src/pm-agent/util/run-ledger.ts).
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
    (inputTokens / 1_000_000) * UNPRICED.input +
      (maxOutputTokens / 1_000_000) * UNPRICED.output,
  );
}

/** What a finished call cost, priced the way the budget read-out prices llm_usage. */
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
    (inputTokens / 1_000_000) * UNPRICED.input +
      (outputTokens / 1_000_000) * UNPRICED.output,
  );
}

export interface ManualReservation {
  id: number;
  maxUsd: number;
}

/** What the loop runner needs from a ledger. Chat turns run without one. */
export interface ManualSpendGate {
  reserve(maxUsd: number): ManualReservation | null;
  settle(reservation: ManualReservation, actualUsd: number): void;
  release(reservation: ManualReservation): void;
}

/**
 * Reserve-before-spend for ONE weekly run. Every model call reserves its worst case first; a call
 * that cannot reserve is not made, so the run can never pass its cap whatever the model does.
 * Settling moves the reservation to spent (the actual, usually lower); releasing returns it.
 */
export class ManualRunLedger implements ManualSpendGate {
  private nextId = 1;
  private readonly open = new Map<number, ManualReservation>();
  private spentUsd = 0;

  constructor(readonly capUsd: number) {}

  get spent(): number {
    return round4(this.spentUsd);
  }

  get reserved(): number {
    let sum = 0;
    for (const r of this.open.values()) sum += r.maxUsd;
    return round4(sum);
  }

  get remainingUsd(): number {
    return round4(Math.max(0, this.capUsd - this.spentUsd - this.reserved));
  }

  reserve(maxUsd: number): ManualReservation | null {
    const amount = round4(Math.max(0, maxUsd));
    if (amount > this.remainingUsd) return null;
    const reservation = { id: this.nextId++, maxUsd: amount };
    this.open.set(reservation.id, reservation);
    return reservation;
  }

  settle(reservation: ManualReservation, actualUsd: number): void {
    if (!this.open.delete(reservation.id)) return;
    this.spentUsd += Math.max(0, actualUsd);
  }

  release(reservation: ManualReservation): void {
    this.open.delete(reservation.id);
  }
}
