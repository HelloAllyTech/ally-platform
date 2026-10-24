import { GuideEpochSnapshot } from '../entity/guide-thread.entity';
import { GuideBudgetTier, GuidePolicy } from '../release/guide-release.bundle';

/**
 * Budget tiers (plans/ally-guide/plan.md §11 H-1…H-3, Appendix A). Ally
 * never stops for budget; it moves to a cheaper model — at the next epoch,
 * so a conversation never switches model mid-flow.
 */
export function budgetTier(input: {
  threadUsd: number;
  learnerDayUsd: number;
  limits: GuidePolicy['limits'];
}): GuideBudgetTier {
  if (input.threadUsd >= input.limits.threadLiteCapUsd) return 'lite';
  if (
    input.threadUsd >= input.limits.threadSoftCapUsd ||
    input.learnerDayUsd >= input.limits.learnerDailyUsdCap
  ) {
    return 'degraded';
  }
  return 'premium';
}

export type EpochReason =
  | 'first conversation'
  | 'return after a break'
  | 'safety rollback'
  | 'budget tier changed'
  | 'course or organisation changed'
  /** The epoch's history passed `historySummariseAboveTokens` (plan §7.6). */
  | 'conversation summarised';

/**
 * A provider-neutral estimate of what a replayed history costs in input
 * tokens: about four characters a token over the serialised messages. It
 * only has to say when an epoch has grown long, not price it — the ledger
 * prices every call from the provider's own counts.
 */
export function estimateTokens(messages: unknown[]): number {
  if (!messages.length) return 0;
  return Math.ceil(JSON.stringify(messages).length / 4);
}

export type EpochDecision =
  | { continue: true }
  | { continue: false; reason: EpochReason };

/**
 * Whether this turn continues the current epoch (plan §1 "Epoch", §7.4,
 * §7.6). An epoch freezes the release, the model and the system spans, which
 * is what keeps the prompt cache warm and every earlier thinking block
 * valid; anything that would change them starts a new one instead.
 *
 * A normal GA promotion does not end an epoch — the thread moves at its next
 * one. A safety (emergency) rollback does, at the next turn. So does a
 * history past the policy's summarisation threshold: the next epoch opens
 * with a summary in place of the replayed exchanges, which never edits the
 * transcript — only what the model is given.
 */
export function decideEpoch(input: {
  snapshot: GuideEpochSnapshot | null | undefined;
  now: Date;
  lastLearnerActivityAt: Date | null | undefined;
  idleMinutes: number;
  /** The agent's latest emergency rollback (audit id), if any. */
  emergencyRollbackId: string | null;
  tier: GuideBudgetTier;
  /** The spans as they would be built now, with the pinned release. */
  spanHashes: { persona: string; org: string; course: string };
  /** The epoch's replayed history so far, estimated (`estimateTokens`). */
  historyTokens?: number;
  /** Policy `historySummariseAboveTokens`: past it, summarise and start afresh. */
  summariseAboveTokens?: number;
}): EpochDecision {
  const snapshot = input.snapshot;
  if (!snapshot?.startedAt || !snapshot.releaseId) {
    return { continue: false, reason: 'first conversation' };
  }
  if (
    input.lastLearnerActivityAt &&
    input.now.getTime() - input.lastLearnerActivityAt.getTime() >=
      input.idleMinutes * 60_000
  ) {
    return { continue: false, reason: 'return after a break' };
  }
  if (
    input.emergencyRollbackId &&
    input.emergencyRollbackId !== (snapshot.emergencyRollbackId ?? null)
  ) {
    return { continue: false, reason: 'safety rollback' };
  }
  if (snapshot.tier && snapshot.tier !== input.tier) {
    return { continue: false, reason: 'budget tier changed' };
  }
  const hashes = snapshot.layerHashes ?? {};
  if (
    hashes.persona !== input.spanHashes.persona ||
    hashes.org !== input.spanHashes.org ||
    hashes.course !== input.spanHashes.course
  ) {
    return { continue: false, reason: 'course or organisation changed' };
  }
  if (
    input.historyTokens != null &&
    input.summariseAboveTokens != null &&
    input.historyTokens > input.summariseAboveTokens
  ) {
    return { continue: false, reason: 'conversation summarised' };
  }
  return { continue: true };
}
