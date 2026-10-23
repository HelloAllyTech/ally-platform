import { GuideAtmosphere } from '../contract/generated/guide-contract';
import { GuideThreadPacing } from '../entity/guide-thread.entity';
import { GuideMode } from '../enum/guide.enum';
import { GuidePolicy } from '../release/guide-release.bundle';
import { CourseSpine, GuideTension, SpineItem } from './course-spine';

/**
 * The pacing director (plans/ally-guide/plan.md §4.4, §4.5): deterministic
 * rules for how actively Ally guides back to the course, when it stays
 * quiet, and what counts as the learner's first win. Pure functions over the
 * thread's pacing state, so every rule is testable without a database and a
 * model never decides when to push.
 */

/** The learner's guidance dial (plan §5.7). */
export type GuidanceDial = 'lead' | 'walk' | 'drive';

/**
 * 0 silent, dock hidden · 1 dock only · 2 one short verbal bridge ·
 * 3 Ally may present the next item.
 */
export type SteerLevel = 0 | 1 | 2 | 3;

export interface SteerDecision {
  level: SteerLevel;
  /** Why, in a few words, for the trace and the situation report. */
  reason: string;
  dockVisible: boolean;
  mayPresentNext: boolean;
}

export interface SteerInput {
  mode: GuideMode;
  pacing: GuideThreadPacing;
  spine: CourseSpine;
  policy: Pick<GuidePolicy, 'steer' | 'releaseWindowMaxTurns'>;
  now: number;
  /** A card is open in the Shelf or Theatre. */
  itemOpen?: boolean;
  /** An item was just completed and its debrief is done. */
  justCompleted?: boolean;
  /** The learner pressed Continue / Start, or said they are ready. */
  learnerReady?: boolean;
}

const QUIET_MODES = new Set([
  GuideMode.CARE,
  GuideMode.CRISIS,
  GuideMode.CRISIS_FOLLOWUP,
]);

export function releaseWindowOpen(
  pacing: GuideThreadPacing,
  maxTurns: number,
): boolean {
  const window = pacing.releaseWindow;
  if (!window) return false;
  return (pacing.learnerTurns ?? 0) - window.openedAtTurn < maxTurns;
}

export function decideSteer(input: SteerInput): SteerDecision {
  const { mode, pacing, spine, policy } = input;
  const turns = pacing.learnerTurns ?? 0;
  const offSpine = pacing.offSpineTurns ?? 0;
  const silent = (reason: string): SteerDecision => ({
    level: 0,
    reason,
    dockVisible: false,
    mayPresentNext: false,
  });
  const present = (reason: string): SteerDecision => ({
    level: 3,
    reason,
    dockVisible: true,
    mayPresentNext: true,
  });

  if (!spine.current) {
    return silent(spine.finished ? 'course finished' : 'nothing unlocked');
  }
  if (mode === GuideMode.CRISIS) return silent('crisis');
  // The learner leads: asking to go on is honoured even in CARE or the week
  // after a crisis, which only stop Ally from pushing (plan §6.2).
  if (input.learnerReady) return present('learner asked to continue');
  if (QUIET_MODES.has(mode)) return silent(`mode ${mode.toLowerCase()}`);
  if (input.itemOpen) return silent('an item is open');
  if (releaseWindowOpen(pacing, policy.releaseWindowMaxTurns)) {
    return silent('release window after a high-tension item');
  }
  if (
    pacing.declinedAtTurn != null &&
    turns - pacing.declinedAtTurn < policy.steer.declineCooldownTurns
  ) {
    return silent('learner said not now');
  }
  if (input.justCompleted) return present('item just completed');
  if (offSpine >= policy.steer.l3OffSpineTurns) {
    return present(`${offSpine} turns off the course`);
  }

  const minutesIdle = pacing.lastProgressAt
    ? (input.now - Date.parse(pacing.lastProgressAt)) / 60_000
    : 0;
  const wantsBridge =
    offSpine >= policy.steer.l2OffSpineTurns ||
    (offSpine > 0 && minutesIdle >= policy.steer.l2MinutesNoProgress);
  const bridgedRecently =
    pacing.lastVerbalSteerTurn != null &&
    turns - pacing.lastVerbalSteerTurn < policy.steer.verbalMinTurnsBetween;
  if (wantsBridge && !bridgedRecently) {
    return {
      level: 2,
      reason:
        offSpine >= policy.steer.l2OffSpineTurns
          ? `${offSpine} turns off the course`
          : `${Math.floor(minutesIdle)} minutes without progress`,
      dockVisible: true,
      mayPresentNext: false,
    };
  }
  return {
    level: 1,
    reason: 'default',
    dockVisible: true,
    mayPresentNext: false,
  };
}

// ── State transitions (each returns a new object; callers persist it) ──

/** A learner message. `onSpine` when it opened, anchored to or continued an item. */
export function afterLearnerTurn(
  pacing: GuideThreadPacing,
  onSpine: boolean,
): GuideThreadPacing {
  return {
    ...pacing,
    learnerTurns: (pacing.learnerTurns ?? 0) + 1,
    offSpineTurns: onSpine ? 0 : (pacing.offSpineTurns ?? 0) + 1,
  };
}

/** An item was opened (progress, not completion). */
export function afterItemOpened(
  pacing: GuideThreadPacing,
  at: Date,
): GuideThreadPacing {
  return { ...pacing, offSpineTurns: 0, lastProgressAt: at.toISOString() };
}

/**
 * An item was completed. A high-tension one opens the release window; the
 * first completion is the learner's first win.
 */
export function afterItemCompleted(
  pacing: GuideThreadPacing,
  item: Pick<SpineItem, 'id' | 'tension'>,
  at: Date,
): GuideThreadPacing {
  return {
    ...pacing,
    offSpineTurns: 0,
    lastProgressAt: at.toISOString(),
    firstWinAt: pacing.firstWinAt ?? at.toISOString(),
    releaseWindow:
      item.tension === 'high'
        ? { itemId: item.id, openedAtTurn: pacing.learnerTurns ?? 0 }
        : (pacing.releaseWindow ?? null),
  };
}

/** The learner reflected on the hard item: the window can close. */
export function afterReflection(pacing: GuideThreadPacing): GuideThreadPacing {
  return { ...pacing, releaseWindow: null };
}

export function afterVerbalSteer(pacing: GuideThreadPacing): GuideThreadPacing {
  return { ...pacing, lastVerbalSteerTurn: pacing.learnerTurns ?? 0 };
}

export function afterDecline(pacing: GuideThreadPacing): GuideThreadPacing {
  return { ...pacing, declinedAtTurn: pacing.learnerTurns ?? 0 };
}

/** One step toward talking less, never below the floor. */
export function afterCompetenceSignal(
  pacing: GuideThreadPacing,
  fade: GuidePolicy['fade'],
): GuideThreadPacing {
  const current = pacing.fadeLevel ?? fade.start.lay;
  return {
    ...pacing,
    fadeLevel: Math.max(fade.floor, round1(current - fade.step)),
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

// ── First win (plan §4.5) ──

export type FirstWinPlan =
  | { kind: 'done' }
  /** The next item is short enough to be the first win. */
  | { kind: 'item'; itemId: string }
  /** The next item is long: offer a quick dilemma or rehearsal first. */
  | {
      kind: 'warm_up';
      itemId: string;
      reason: 'long_first_item' | 'boss_first';
    };

export function planFirstWin(
  spine: CourseSpine,
  pacing: GuideThreadPacing,
): FirstWinPlan {
  // A learner who already finished something (here or in classic) has won.
  if (pacing.firstWinAt || spine.completed > 0 || !spine.current) {
    return { kind: 'done' };
  }
  const item = spine.current;
  if (item.boss) {
    return { kind: 'warm_up', itemId: item.id, reason: 'boss_first' };
  }
  if (item.quickWin) {
    return { kind: 'item', itemId: item.id };
  }
  return { kind: 'warm_up', itemId: item.id, reason: 'long_first_item' };
}

// ── What the learner sees and how much Ally says ──

export interface ProseBudget {
  maxWords: number;
  /** Voice only: replies are spoken, so they are short by sentence count. */
  maxSentences: number | null;
}

/** Fewer words as competence shows, never below the "I'll drive" budget. */
export function proseBudget(
  dial: GuidanceDial,
  channel: 'text' | 'voice',
  fadeLevel: number | undefined,
  policy: Pick<GuidePolicy, 'prose' | 'fade'>,
): ProseBudget {
  const base = policy.prose.maxWords[dial];
  const fade = Math.min(1, Math.max(policy.fade.floor, fadeLevel ?? 1));
  const maxWords = Math.max(
    policy.prose.maxWords.drive,
    Math.round(base * fade),
  );
  return {
    maxWords: Math.min(base, maxWords),
    maxSentences: channel === 'voice' ? policy.prose.voiceMaxSentences : null,
  };
}

/**
 * The interface's tone (plan §5.9): still in a crisis; hushed in care, in a
 * release window, or while the current chapter carries trigger warnings;
 * bright otherwise.
 */
export function atmosphereOf(input: {
  mode: GuideMode;
  releaseWindowOpen: boolean;
  spine: CourseSpine | null;
}): GuideAtmosphere {
  if (input.mode === GuideMode.CRISIS) return 'still';
  if (
    input.mode === GuideMode.CARE ||
    input.mode === GuideMode.CRISIS_FOLLOWUP ||
    input.releaseWindowOpen
  ) {
    return 'hushed';
  }
  const current = input.spine?.current;
  if (
    current &&
    input.spine!.items.some(
      (item) =>
        item.sectionId === current.sectionId && item.triggerWarnings.length > 0,
    )
  ) {
    return 'hushed';
  }
  return 'bright';
}

/** The celebration a completion may have (plan §4.7), capped by tone. */
export function celebrationFor(input: {
  mode: GuideMode;
  atmosphere: GuideAtmosphere;
  item: Pick<SpineItem, 'boss' | 'triggerWarnings'> & { tension: GuideTension };
  courseFinished: boolean;
}): 'none' | 'quiet' | 'warm' | 'festive' {
  if (
    input.mode === GuideMode.CRISIS ||
    input.mode === GuideMode.CRISIS_FOLLOWUP
  ) {
    return 'none';
  }
  if (input.atmosphere !== 'bright') return 'quiet';
  if (input.courseFinished) return 'festive';
  if (input.item.boss && input.item.triggerWarnings.length === 0) {
    return 'festive';
  }
  return input.item.tension === 'low' ? 'quiet' : 'warm';
}
