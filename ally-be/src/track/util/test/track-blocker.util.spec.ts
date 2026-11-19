import { SessionItemStatus } from 'src/common/type/common.type';
import { QuizAttemptStatus } from '../../type/quiz.type';
import {
  RoleplayAttemptFailureReason,
  TrackBlockerAction,
  TrackBlockerReason,
  TrackItemType,
} from '../../type/track.type';
import {
  findBlockerPosition,
  resolveTrackBlocker,
  TrackBlockerInputs,
} from '../track-blocker.util';

const { INSUFFICIENT_SCORE, INSUFFICIENT_DURATION } =
  RoleplayAttemptFailureReason;
const NOW = new Date('2026-11-19T12:00:00.000Z');

const blocker = (
  type: TrackItemType,
  extra: Partial<TrackBlockerInputs> & {
    content?: unknown;
    criteria?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    attemptCount?: number;
  } = {},
) =>
  resolveTrackBlocker({
    item: {
      id: 'blocker-1',
      title: 'First call',
      type,
      content: extra.content,
      completionCriteria: extra.criteria ?? null,
    } as any,
    progress: {
      id: 'p-1',
      status: SessionItemStatus.UNLOCKED,
      attemptCount: extra.attemptCount ?? 0,
      meta: extra.meta ?? {},
    } as any,
    lastRoleplayAttempt: extra.lastRoleplayAttempt,
    latestAttempt: extra.latestAttempt,
    now: NOW,
  });

const attempt = (
  failureReasons: RoleplayAttemptFailureReason[],
  score: number | null = 52,
) => ({
  failureReasons,
  score,
  durationSeconds: 100.4,
  requiredScore: 70,
  requiredDurationSeconds: 180,
  endedAt: NOW.toISOString(),
});

describe('resolveTrackBlocker', () => {
  it('names the item and its type', () => {
    expect(blocker(TrackItemType.GAME)).toEqual({
      itemId: 'blocker-1',
      title: 'First call',
      type: TrackItemType.GAME,
      reasons: [{ code: TrackBlockerReason.NOT_FINISHED }],
      action: TrackBlockerAction.OPEN,
    });
  });

  describe('ROLEPLAY', () => {
    it('is NOT_FINISHED with no missed attempt', () => {
      expect(blocker(TrackItemType.ROLEPLAY)).toMatchObject({
        reasons: [{ code: TrackBlockerReason.NOT_FINISHED }],
        action: TrackBlockerAction.OPEN,
      });
    });

    it('reports a score miss with both numbers', () => {
      expect(
        blocker(TrackItemType.ROLEPLAY, {
          lastRoleplayAttempt: attempt([INSUFFICIENT_SCORE]),
        }),
      ).toMatchObject({
        reasons: [
          { code: TrackBlockerReason.BELOW_SCORE, actual: 52, required: 70 },
        ],
        action: TrackBlockerAction.RETRY,
      });
    });

    it('reports a duration miss in whole seconds', () => {
      expect(
        blocker(TrackItemType.ROLEPLAY, {
          lastRoleplayAttempt: attempt([INSUFFICIENT_DURATION]),
        }).reasons,
      ).toEqual([
        { code: TrackBlockerReason.TOO_SHORT, actual: 100, required: 180 },
      ]);
    });

    it('reports both misses, score first', () => {
      expect(
        blocker(TrackItemType.ROLEPLAY, {
          lastRoleplayAttempt: attempt([
            INSUFFICIENT_DURATION,
            INSUFFICIENT_SCORE,
          ]),
        }).reasons.map((r) => r.code),
      ).toEqual([TrackBlockerReason.BELOW_SCORE, TrackBlockerReason.TOO_SHORT]);
    });

    it('says NOT_SCORED when the attempt came back with no score', () => {
      expect(
        blocker(TrackItemType.ROLEPLAY, {
          lastRoleplayAttempt: attempt([INSUFFICIENT_SCORE], null),
        }).reasons,
      ).toEqual([{ code: TrackBlockerReason.NOT_SCORED }]);
    });

    it('offers no retry on a submitted assessment', () => {
      expect(
        blocker(TrackItemType.ROLEPLAY, {
          criteria: { assessmentMode: true },
          meta: { assessmentSubmittedAt: NOW.toISOString() },
          lastRoleplayAttempt: attempt([INSUFFICIENT_SCORE]),
        }),
      ).toMatchObject({
        reasons: [{ code: TrackBlockerReason.ASSESSMENT_FAILED }],
        action: TrackBlockerAction.NONE,
      });
    });
  });

  it('CASE reads the stored case attempt', () => {
    expect(
      blocker(TrackItemType.CASE, {
        meta: { lastCaseAttempt: attempt([INSUFFICIENT_SCORE]) },
      }),
    ).toMatchObject({
      reasons: [
        { code: TrackBlockerReason.BELOW_SCORE, actual: 52, required: 70 },
      ],
      action: TrackBlockerAction.RETRY,
    });
  });

  describe('QUIZ', () => {
    const content = { settings: { passScore: 80, maxAttempts: 2 } };

    it('reports a failed attempt against the pass mark', () => {
      expect(
        blocker(TrackItemType.QUIZ, {
          content,
          attemptCount: 1,
          latestAttempt: { passed: false, scorePct: 60 },
        }),
      ).toMatchObject({
        reasons: [
          { code: TrackBlockerReason.BELOW_SCORE, actual: 60, required: 80 },
        ],
        action: TrackBlockerAction.RETRY,
      });
    });

    it('is OUT_OF_ATTEMPTS once maxAttempts are used', () => {
      expect(
        blocker(TrackItemType.QUIZ, {
          content,
          attemptCount: 2,
          latestAttempt: { passed: false, scorePct: 60 },
        }),
      ).toMatchObject({
        reasons: [{ code: TrackBlockerReason.OUT_OF_ATTEMPTS }],
        action: TrackBlockerAction.NONE,
      });
    });

    it('waits while answers are being marked', () => {
      expect(
        blocker(TrackItemType.QUIZ, {
          content,
          latestAttempt: {
            passed: null,
            status: QuizAttemptStatus.PENDING_GRADING,
          },
        }),
      ).toMatchObject({
        reasons: [{ code: TrackBlockerReason.GRADING_PENDING }],
        action: TrackBlockerAction.NONE,
      });
    });

    it('is NOT_FINISHED with no attempt', () => {
      expect(blocker(TrackItemType.QUIZ, { content }).reasons[0].code).toBe(
        TrackBlockerReason.NOT_FINISHED,
      );
    });
  });

  it('ANNOTATED_ARTIFACT reports a failed attempt', () => {
    expect(
      blocker(TrackItemType.ANNOTATED_ARTIFACT, {
        content: { settings: { passScore: 75 } },
        latestAttempt: { passed: false, scorePct: 50 },
      }).reasons,
    ).toEqual([
      { code: TrackBlockerReason.BELOW_SCORE, actual: 50, required: 75 },
    ]);
  });

  describe('BRANCHING_SCENARIO', () => {
    it('is OUT_OF_ATTEMPTS until the next round opens', () => {
      const result = blocker(TrackItemType.BRANCHING_SCENARIO, {
        content: { settings: { passScore: 70, maxAttempts: 1 } },
        meta: { branchingRoundRuns: [{ at: NOW.toISOString(), score: 40 }] },
      });
      expect(result).toMatchObject({
        reasons: [{ code: TrackBlockerReason.OUT_OF_ATTEMPTS }],
        action: TrackBlockerAction.NONE,
      });
      expect(new Date(result.retryAt!).getTime()).toBeGreaterThan(
        NOW.getTime(),
      );
    });

    it('reports the best run below the pass mark', () => {
      expect(
        blocker(TrackItemType.BRANCHING_SCENARIO, {
          content: { settings: { passScore: 70 } },
          meta: { branchingBestScore: 55 },
        }),
      ).toMatchObject({
        reasons: [
          { code: TrackBlockerReason.BELOW_SCORE, actual: 55, required: 70 },
        ],
        action: TrackBlockerAction.RETRY,
      });
    });
  });

  it('VIDEO reports how much was watched', () => {
    expect(
      blocker(TrackItemType.VIDEO, { meta: { maxWatchedPct: 40.7 } }),
    ).toMatchObject({
      reasons: [
        { code: TrackBlockerReason.WATCH_MORE, actual: 40, required: 90 },
      ],
      action: TrackBlockerAction.OPEN,
    });
  });

  it('ARTICLE asks to keep reading inside the read time', () => {
    expect(
      blocker(TrackItemType.ARTICLE, {
        criteria: { minReadSeconds: 120 },
        meta: {
          articleFirstOpenedAt: new Date(NOW.getTime() - 30_000).toISOString(),
        },
      }).reasons,
    ).toEqual([{ code: TrackBlockerReason.KEEP_READING }]);
  });

  it('ARTICLE past its read time is just NOT_FINISHED', () => {
    expect(
      blocker(TrackItemType.ARTICLE, {
        criteria: { minReadSeconds: 10 },
        meta: {
          articleFirstOpenedAt: new Date(NOW.getTime() - 30_000).toISOString(),
        },
      }).reasons,
    ).toEqual([{ code: TrackBlockerReason.NOT_FINISHED }]);
  });
});

describe('findBlockerPosition', () => {
  const { COMPLETED, UNLOCKED, LOCKED } = SessionItemStatus;
  const items = (...statuses: SessionItemStatus[]) =>
    statuses.map((status) => ({ status }));

  it('puts the explanation on the item after the first unfinished one', () => {
    expect(
      findBlockerPosition(items(COMPLETED, UNLOCKED, LOCKED, LOCKED)),
    ).toEqual({ blockerIndex: 1, targetIndex: 2 });
  });

  it('is null when everything is complete', () => {
    expect(findBlockerPosition(items(COMPLETED, COMPLETED))).toBeNull();
  });

  it('is null when the blocker is the last item', () => {
    expect(findBlockerPosition(items(COMPLETED, UNLOCKED))).toBeNull();
  });

  it('is null when the next item is not locked', () => {
    expect(findBlockerPosition(items(UNLOCKED, UNLOCKED))).toBeNull();
  });
});
