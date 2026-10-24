import { FirstPersonRiskMatch } from 'src/common/safety/first-person-risk.matcher';
import { GuideMode } from '../enum/guide.enum';

/**
 * The Sentinel's verdict on one learner message and the mode machine it
 * drives (plans/ally-guide/plan.md §6.2). Pure: the service gathers the
 * inputs, these functions decide.
 */

export type SentinelRisk = 'none' | 'care' | 'crisis';
export type SentinelAbout = 'self' | 'client' | 'course' | 'other' | 'unclear';
export type SentinelOverlay = 'none' | 'real_case' | 'real_case_urgent' | 'pii';

/** What the classifier returns (structured output, closed schema). */
export interface SentinelClassification {
  risk: SentinelRisk;
  about: SentinelAbout;
  overlay: SentinelOverlay;
  confidence: number;
  /** The deciding words, verbatim. Learner text: product trace only. */
  evidence: string;
}

export interface SentinelVerdict extends SentinelClassification {
  /**
   * keyword — layer 1 matched; classifier — layer 2 answered in time;
   * timeout / error — layer 2 did not, so only layer 1 stands.
   */
  source: 'keyword' | 'classifier' | 'timeout' | 'error';
  latencyMs: number;
  model?: string;
}

export const CLEAR_VERDICT: SentinelClassification = {
  risk: 'none',
  about: 'unclear',
  overlay: 'none',
  confidence: 0,
  evidence: '',
};

export function keywordVerdict(
  match: FirstPersonRiskMatch,
  latencyMs: number,
): SentinelVerdict {
  return {
    risk: 'crisis',
    about: 'self',
    overlay: 'none',
    confidence: 1,
    evidence: match.phrase,
    source: 'keyword',
    latencyMs,
  };
}

/**
 * Whether the verdict is about the learner's own state. "unclear" counts:
 * the classifier is told to say "self" when crisis-level words are
 * ambiguous, and a missed crisis costs more than a recoverable false alarm.
 */
const aboutLearner = (verdict: SentinelClassification) =>
  verdict.about === 'self' || verdict.about === 'unclear';

export function isLearnerCrisis(verdict: SentinelClassification): boolean {
  return verdict.risk === 'crisis' && aboutLearner(verdict);
}

/**
 * CARE pauses the course for the rest of the session, so a hesitant "care"
 * is not enough to enter it; a crisis has no such floor — a false alarm
 * costs one tap, a miss far more.
 */
export const CARE_MIN_CONFIDENCE = 0.6;

export function isLearnerDistress(verdict: SentinelClassification): boolean {
  return (
    verdict.risk === 'care' &&
    verdict.about === 'self' &&
    verdict.confidence >= CARE_MIN_CONFIDENCE
  );
}

export interface ModeChange {
  mode: GuideMode;
  changed: boolean;
  reason: string;
}

/**
 * The mode after one learner message.
 *  - A crisis about the learner wins from anywhere.
 *  - In CRISIS, the learner writing again without crisis words moves to CARE
 *    (the model may speak again, gently); "I'm safe right now" does the same
 *    through {@link afterSafeTap}.
 *  - Distress about the learner moves NORMAL to CARE; CARE and the week
 *    after a crisis are already quiet and stay as they are.
 */
export function nextMode(
  current: GuideMode,
  verdict: SentinelClassification,
): ModeChange {
  const to = (mode: GuideMode, reason: string): ModeChange => ({
    mode,
    changed: mode !== current,
    reason,
  });
  if (isLearnerCrisis(verdict))
    return to(GuideMode.CRISIS, 'crisis about the learner');
  if (current === GuideMode.CRISIS) {
    return to(GuideMode.CARE, 'learner wrote again without crisis words');
  }
  if (isLearnerDistress(verdict) && current === GuideMode.NORMAL) {
    return to(GuideMode.CARE, 'distress about the learner');
  }
  return to(current, 'unchanged');
}

/** "I'm safe right now" on the crisis card. */
export function afterSafeTap(current: GuideMode): ModeChange {
  return current === GuideMode.CRISIS
    ? {
        mode: GuideMode.CARE,
        changed: true,
        reason: 'learner said they are safe',
      }
    : { mode: current, changed: false, reason: 'unchanged' };
}

/**
 * The mode a new session opens in. CARE is sticky for one session only; a
 * crisis — in any of the learner's courses — keeps every session in the week
 * after it quiet (CRISIS_FOLLOWUP), and the first of them opens with a fixed
 * check-in.
 */
export function sessionStartMode(input: {
  current: GuideMode;
  lastCrisisAt: Date | null;
  now: Date;
  followupDays: number;
}): ModeChange & { checkIn: boolean } {
  const withinFollowup =
    input.lastCrisisAt !== null &&
    input.now.getTime() - input.lastCrisisAt.getTime() <
      input.followupDays * 24 * 60 * 60 * 1000;
  if (withinFollowup) {
    return {
      mode: GuideMode.CRISIS_FOLLOWUP,
      changed: input.current !== GuideMode.CRISIS_FOLLOWUP,
      reason: 'within the week after a crisis',
      checkIn: true,
    };
  }
  if (input.current === GuideMode.NORMAL) {
    return {
      mode: GuideMode.NORMAL,
      changed: false,
      reason: 'unchanged',
      checkIn: false,
    };
  }
  return {
    mode: GuideMode.NORMAL,
    changed: true,
    reason: 'new session',
    checkIn: false,
  };
}
