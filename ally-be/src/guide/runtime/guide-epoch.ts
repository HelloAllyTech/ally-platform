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
  | 'course or organisation changed';

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
 * one. A safety (emergency) rollback does, at the next turn.
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
  return { continue: true };
}
