import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItem } from '../entity/track-item.entity';
import { TrackItemProgress } from '../entity/track-item-progress.entity';
import { AnnotationContent } from '../type/annotation.type';
import {
  BranchingScenarioContent,
  resolveBranchingRound,
} from '../type/branching.type';
import { QuizAttemptStatus, QuizContent } from '../type/quiz.type';
import {
  LastCaseAttempt,
  LastRoleplayAttempt,
  RoleplayAttemptFailureReason,
  TrackBlocker,
  TrackBlockerAction,
  TrackBlockerReason,
  TrackBlockerReasonDetail,
  TrackItemType,
} from '../type/track.type';

/** The latest graded attempt of a QUIZ or ANNOTATED_ARTIFACT item. */
export interface LatestGradedAttempt {
  passed?: boolean | null;
  scorePct?: number | null;
  /** QUIZ only; annotations are graded inline. */
  status?: QuizAttemptStatus;
}

export interface TrackBlockerInputs {
  item: TrackItem;
  progress?: TrackItemProgress;
  /**
   * ROLEPLAY: the attempt as the learner payload reports it — already
   * re-checked against the item's current rule, so a rule loosened after the
   * attempt never reads as a miss.
   */
  lastRoleplayAttempt?: LastRoleplayAttempt | null;
  /** QUIZ / ANNOTATED_ARTIFACT: the most recent attempt, if any. */
  latestAttempt?: LatestGradedAttempt | null;
  now?: Date;
}

const DEFAULT_WATCH_PCT = 90;

const notFinished = (): Pick<TrackBlocker, 'reasons' | 'action'> => ({
  reasons: [{ code: TrackBlockerReason.NOT_FINISHED }],
  action: TrackBlockerAction.OPEN,
});

/** Score and duration misses from a roleplay or case attempt. */
const attemptReasons = (
  attempt: LastRoleplayAttempt | LastCaseAttempt,
): TrackBlockerReasonDetail[] => {
  const reasons: TrackBlockerReasonDetail[] = [];
  // Score first: it is the usual reason and the one the learner can act on.
  if (
    attempt.failureReasons.includes(
      RoleplayAttemptFailureReason.INSUFFICIENT_SCORE,
    )
  ) {
    reasons.push(
      attempt.score === null || attempt.score === undefined
        ? { code: TrackBlockerReason.NOT_SCORED }
        : {
            code: TrackBlockerReason.BELOW_SCORE,
            actual: attempt.score,
            required: attempt.requiredScore,
          },
    );
  }
  if (
    attempt.failureReasons.includes(
      RoleplayAttemptFailureReason.INSUFFICIENT_DURATION,
    )
  ) {
    reasons.push({
      code: TrackBlockerReason.TOO_SHORT,
      actual: Math.round(attempt.durationSeconds),
      required: attempt.requiredDurationSeconds,
    });
  }
  return reasons;
};

const gradedAttemptBlocker = (
  attempt: LatestGradedAttempt | null | undefined,
  progress: TrackItemProgress | undefined,
  passScore: number | null | undefined,
  maxAttempts: number | null | undefined,
): Pick<TrackBlocker, 'reasons' | 'action'> | null => {
  if (!attempt) return null;
  if (attempt.status === QuizAttemptStatus.PENDING_GRADING) {
    return {
      reasons: [{ code: TrackBlockerReason.GRADING_PENDING }],
      action: TrackBlockerAction.NONE,
    };
  }
  if (attempt.passed !== false) return null;
  const used = progress?.attemptCount ?? 0;
  if (typeof maxAttempts === 'number' && used >= maxAttempts) {
    return {
      reasons: [{ code: TrackBlockerReason.OUT_OF_ATTEMPTS }],
      action: TrackBlockerAction.NONE,
    };
  }
  return {
    reasons: [
      {
        code: TrackBlockerReason.BELOW_SCORE,
        actual: attempt.scorePct ?? null,
        required: passScore ?? null,
      },
    ],
    action: TrackBlockerAction.RETRY,
  };
};

const resolveReasons = ({
  item,
  progress,
  lastRoleplayAttempt,
  latestAttempt,
  now = new Date(),
}: TrackBlockerInputs): Pick<TrackBlocker, 'reasons' | 'action'> & {
  retryAt?: string | null;
} => {
  const meta = progress?.meta ?? {};

  switch (item.type) {
    case TrackItemType.ROLEPLAY: {
      if (
        item.completionCriteria?.assessmentMode &&
        meta.assessmentSubmittedAt
      ) {
        return {
          reasons: [{ code: TrackBlockerReason.ASSESSMENT_FAILED }],
          action: TrackBlockerAction.NONE,
        };
      }
      const reasons = lastRoleplayAttempt
        ? attemptReasons(lastRoleplayAttempt)
        : [];
      return reasons.length
        ? { reasons, action: TrackBlockerAction.RETRY }
        : notFinished();
    }

    case TrackItemType.CASE: {
      const reasons = meta.lastCaseAttempt
        ? attemptReasons(meta.lastCaseAttempt)
        : [];
      return reasons.length
        ? { reasons, action: TrackBlockerAction.RETRY }
        : notFinished();
    }

    case TrackItemType.QUIZ: {
      const settings = (item.content as QuizContent | undefined)?.settings;
      return (
        gradedAttemptBlocker(
          latestAttempt,
          progress,
          settings?.passScore,
          settings?.maxAttempts,
        ) ?? notFinished()
      );
    }

    case TrackItemType.ANNOTATED_ARTIFACT: {
      const settings = (item.content as AnnotationContent | undefined)
        ?.settings;
      return (
        gradedAttemptBlocker(
          latestAttempt,
          progress,
          settings?.passScore,
          settings?.maxAttempts,
        ) ?? notFinished()
      );
    }

    case TrackItemType.BRANCHING_SCENARIO: {
      const settings = (item.content as BranchingScenarioContent | undefined)
        ?.settings;
      const round = resolveBranchingRound(
        meta.branchingRoundRuns,
        settings?.maxAttempts ?? null,
        false,
        now,
      );
      if (round.exhausted) {
        return {
          reasons: [{ code: TrackBlockerReason.OUT_OF_ATTEMPTS }],
          action: TrackBlockerAction.NONE,
          retryAt: round.nextRoundAt,
        };
      }
      const passScore = settings?.passScore || null;
      const best = meta.branchingBestScore;
      if (passScore !== null && typeof best === 'number' && best < passScore) {
        return {
          reasons: [
            {
              code: TrackBlockerReason.BELOW_SCORE,
              actual: best,
              required: passScore,
            },
          ],
          action: TrackBlockerAction.RETRY,
        };
      }
      return notFinished();
    }

    case TrackItemType.VIDEO: {
      const required = item.completionCriteria?.watchPct ?? DEFAULT_WATCH_PCT;
      const watched = meta.maxWatchedPct ?? 0;
      if (watched > 0 && watched < required) {
        return {
          reasons: [
            {
              code: TrackBlockerReason.WATCH_MORE,
              actual: Math.floor(watched),
              required,
            },
          ],
          action: TrackBlockerAction.OPEN,
        };
      }
      return notFinished();
    }

    case TrackItemType.ARTICLE: {
      const minReadSeconds = item.completionCriteria?.minReadSeconds ?? 0;
      const openedAt = meta.articleFirstOpenedAt;
      if (
        minReadSeconds > 0 &&
        openedAt &&
        (now.getTime() - new Date(openedAt).getTime()) / 1000 < minReadSeconds
      ) {
        return {
          reasons: [{ code: TrackBlockerReason.KEEP_READING }],
          action: TrackBlockerAction.OPEN,
        };
      }
      return notFinished();
    }

    default:
      return notFinished();
  }
};

/** What the blocking item still needs, phrased for the locked item after it. */
export const resolveTrackBlocker = (
  inputs: TrackBlockerInputs,
): TrackBlocker => {
  const { reasons, action, retryAt } = resolveReasons(inputs);
  return {
    itemId: inputs.item.id,
    title: inputs.item.title,
    type: inputs.item.type,
    reasons,
    action,
    ...(retryAt ? { retryAt } : {}),
  };
};

/**
 * Where a blocker belongs under sequential progression: the first
 * non-completed item blocks, and the item right after it is the one that
 * explains it — but only when that item is actually LOCKED. Returns null when
 * every item is complete or the blocker is the last item.
 */
export const findBlockerPosition = <T extends { status: SessionItemStatus }>(
  items: T[],
): { blockerIndex: number; targetIndex: number } | null => {
  const blockerIndex = items.findIndex(
    (item) => item.status !== SessionItemStatus.COMPLETED,
  );
  if (blockerIndex < 0) return null;
  const targetIndex = blockerIndex + 1;
  if (targetIndex >= items.length) return null;
  if (items[targetIndex].status !== SessionItemStatus.LOCKED) return null;
  return { blockerIndex, targetIndex };
};
