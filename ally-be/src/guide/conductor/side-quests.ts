import { GuideThreadPacing } from '../entity/guide-thread.entity';
import { GuideMode } from '../enum/guide.enum';
import { GuidePolicy } from '../release/guide-release.bundle';
import { CourseSpine } from './course-spine';
import { FirstWinPlan, GuidanceDial } from './pacing';

/**
 * Side quests (plans/ally-guide/plan.md §4.6): short, ungraded practice the
 * Conductor makes room for — never gating, never XP, never in a hard moment.
 * This decides whether a slot is open, which kind fits the moment, and the
 * hidden difficulty; Ally decides whether to use the slot.
 */

export type SideQuestKind =
  | 'quick_check'
  | 'micro_dilemma'
  | 'rehearse_line'
  | 'teach_back'
  | 'predict_beat'
  | 'reflection'
  | 'spaced_recall';

export const SIDE_QUEST_KINDS: SideQuestKind[] = [
  'quick_check',
  'micro_dilemma',
  'rehearse_line',
  'teach_back',
  'predict_beat',
  'reflection',
  'spaced_recall',
];

/** What the pacing state remembers about side quests in a thread. */
export interface SideQuestPacing {
  /** spine.completed when the last one was offered. */
  atCompleted?: number;
  /** learnerTurns when the last one was offered. */
  atTurn?: number;
  answered?: number;
  correct?: number;
}

export interface SideQuestSlot {
  open: boolean;
  suggested: SideQuestKind | null;
  /** Why, in a few words, for the situation report and the trace. */
  reason: string;
}

/** Turns between two side quests even when the cadence allows one. */
export const SIDE_QUEST_MIN_TURN_GAP = 3;
/** Days away after which a return earns spaced recall (plan §4.6). */
export const SPACED_RECALL_AFTER_DAYS = 2;

const closed = (reason: string): SideQuestSlot => ({
  open: false,
  suggested: null,
  reason,
});

export function planSideQuest(input: {
  spine: CourseSpine;
  pacing: GuideThreadPacing;
  guidance: GuidanceDial;
  sideQuestsOn: boolean;
  mode: GuideMode;
  releaseWindowOpen: boolean;
  quizOpen: boolean;
  firstWin: FirstWinPlan;
  policy: GuidePolicy;
  /** Days since the learner was last here, when this turn is a return. */
  returnedAfterDays?: number | null;
}): SideQuestSlot {
  const { spine, pacing } = input;
  if (!input.sideQuestsOn) return closed('switched off by the learner');
  if (input.mode !== GuideMode.NORMAL) return closed('not in a hard moment');
  if (input.releaseWindowOpen) return closed('release window');
  if (input.quizOpen) return closed('a quiz is open');
  const backAfterBreak =
    (input.returnedAfterDays ?? 0) > SPACED_RECALL_AFTER_DAYS;
  if (!spine.enrolled) return closed('nothing to practise');
  // A finished course still invites spaced recall on a return — the
  // finale's look back (plan §4.6 "and in the endgame").
  if (spine.finished && !backAfterBreak) {
    return closed('nothing to practise');
  }
  const state = (pacing.sideQuest ?? {}) as SideQuestPacing;
  const turn = pacing.learnerTurns ?? 0;
  if (state.atTurn != null && turn - state.atTurn < SIDE_QUEST_MIN_TURN_GAP) {
    return closed('one was offered a moment ago');
  }

  // A first win comes first (plan §4.5): the warm-up is a side quest.
  if (input.firstWin.kind === 'warm_up') {
    return {
      open: true,
      suggested:
        input.firstWin.reason === 'boss_first'
          ? 'rehearse_line'
          : 'micro_dilemma',
      reason: 'first win',
    };
  }

  if (
    (input.returnedAfterDays ?? 0) > SPACED_RECALL_AFTER_DAYS &&
    spine.completed >= 3
  ) {
    return {
      open: true,
      suggested: 'spaced_recall',
      reason: 'back after a break',
    };
  }
  if (spine.finished) return closed('nothing to practise');

  const cadence = input.policy.sideQuestCadence[input.guidance];
  if (cadence == null) return closed('the learner leads (only if they ask)');
  const since = spine.completed - (state.atCompleted ?? 0);
  if (since < cadence) {
    return closed(`one per ${cadence} activities`);
  }

  const next = spine.current;
  const last = [...spine.items]
    .reverse()
    .find((item) => item.state === 'completed');
  let suggested: SideQuestKind = 'quick_check';
  let reason = 'cadence';
  if (next?.boss) {
    suggested = 'rehearse_line';
    reason = 'a practice conversation is next';
  } else if (
    last &&
    next &&
    last.sectionIndex !== next.sectionIndex &&
    spine.completed >= 2
  ) {
    suggested = (pacing.fadeLevel ?? 1) <= 0.6 ? 'teach_back' : 'reflection';
    reason = 'a chapter just ended';
  } else if (
    last &&
    (last.type === 'ARTICLE' || last.type === 'VIDEO') &&
    next?.type === 'QUIZ'
  ) {
    suggested = 'quick_check';
    reason = 'reading done before a quiz';
  } else if (last?.boss) {
    suggested = 'reflection';
    reason = 'after a practice conversation';
  }
  return { open: true, suggested, reason };
}

/**
 * Hidden difficulty (plan §4.6, Stacks: Adaptive Difficulty — when to hide
 * system adjustments): side quests only, never graded items. Asking for
 * more challenge always stretches.
 */
export function sideQuestDifficulty(
  pacing: GuideThreadPacing,
  challenge: 'normal' | 'more' | undefined,
): 'gentle' | 'standard' | 'stretch' {
  if (challenge === 'more') return 'stretch';
  const state = (pacing.sideQuest ?? {}) as SideQuestPacing;
  const answered = state.answered ?? 0;
  if (answered < 3) return 'standard';
  const rate = (state.correct ?? 0) / answered;
  if (rate >= 0.8) return 'stretch';
  if (rate <= 0.4) return 'gentle';
  return 'standard';
}
