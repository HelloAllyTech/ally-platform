import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { TrackProgressService } from '../track-progress.service';
import {
  RoleplayAttemptFailureReason,
  TrackBlockerReason,
  TrackItemCompletionCriteria,
  TrackItemType,
} from '../../type/track.type';
import { resolveRoleplayGate } from '../../util/roleplay-gate.util';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

const { COMPLETED, UNLOCKED, LOCKED } = SessionItemStatus;

/**
 * The learner track detail: only the first locked item carries `blockedBy`,
 * naming the first unfinished item and why it is unfinished.
 */
describe('TrackEnrollmentService — blockedBy on the learner track detail', () => {
  const quizAttempts = { findLatestByProgressId: jest.fn() };
  const progressRepo = { findByEnrollmentId: jest.fn() };
  const enrollmentRepo = { findByTrackAndUser: jest.fn() };
  const sharedService = { getTrackWithStructure: jest.fn() };
  const identity = (x: unknown) => x;

  const service = new TrackEnrollmentService(
    {} as any,
    {} as any,
    {} as any,
    enrollmentRepo as any,
    progressRepo as any,
    {} as any,
    quizAttempts as any,
    { findLatestByProgressId: jest.fn() } as any,
    sharedService as any,
    {
      getRoleplayGate: (criteria: TrackItemCompletionCriteria) =>
        resolveRoleplayGate(criteria, 0),
    } as any,
    {} as any,
    {} as any,
    {
      resolveLearnerLanguage: jest.fn().mockResolvedValue('en'),
      resolvePublished: jest.fn().mockResolvedValue(null),
      listLearnerLanguages: jest.fn().mockResolvedValue([]),
      localizeTrack: identity,
      localizeSection: identity,
      localizeItem: identity,
    } as any,
    {} as any,
  );
  jest.spyOn(service as any, 'requireUserId').mockReturnValue(1);
  jest
    .spyOn(service as any, 'assertTrackAvailable')
    .mockResolvedValue(undefined);

  const item = (id: string, type: TrackItemType, extra = {}) => ({
    id,
    type,
    title: `Item ${id}`,
    order: Number(id),
    completionCriteria: null,
    ...extra,
  });

  const load = async (
    items: ReturnType<typeof item>[],
    progress: Record<string, object>,
    enrolled = true,
  ) => {
    sharedService.getTrackWithStructure.mockResolvedValue({
      id: 't-1',
      sections: [
        { id: 's-1', order: 1, items: items.slice(0, 2) },
        { id: 's-2', order: 2, items: items.slice(2) },
      ],
    });
    enrollmentRepo.findByTrackAndUser.mockResolvedValue(
      enrolled ? { id: 'enr-1' } : null,
    );
    progressRepo.findByEnrollmentId.mockResolvedValue(
      Object.entries(progress).map(([trackItemId, row]) => ({
        id: `p-${trackItemId}`,
        trackItemId,
        meta: {},
        ...row,
      })),
    );
    const detail = await service.getTrackDetailForLearner('t-1');
    return detail.sections.flatMap((s: any) => s.items) as any[];
  };

  it('explains a missed roleplay on the next item, across sections', async () => {
    const items = await load(
      [
        item('1', TrackItemType.ARTICLE),
        item('2', TrackItemType.ROLEPLAY, {
          completionCriteria: { minScore: 70 },
        }),
        item('3', TrackItemType.VIDEO),
      ],
      {
        '1': { status: COMPLETED },
        '2': {
          status: UNLOCKED,
          meta: {
            lastRoleplayAttempt: {
              failureReasons: [RoleplayAttemptFailureReason.INSUFFICIENT_SCORE],
              score: 52,
              durationSeconds: 300,
              requiredScore: 70,
              requiredDurationSeconds: null,
              endedAt: '2026-11-19T00:00:00.000Z',
            },
          },
        },
        '3': { status: LOCKED },
      },
    );
    expect(items.map((i) => i.blockedBy?.itemId ?? null)).toEqual([
      null,
      null,
      '2',
    ]);
    expect(items[2].blockedBy.reasons).toEqual([
      { code: TrackBlockerReason.BELOW_SCORE, actual: 52, required: 70 },
    ]);
  });

  it('looks up the latest quiz attempt only when a quiz blocks', async () => {
    quizAttempts.findLatestByProgressId.mockResolvedValue({
      passed: false,
      scorePct: 60,
    });
    const items = await load(
      [
        item('1', TrackItemType.QUIZ, {
          content: { settings: { passScore: 80 } },
        }),
        item('2', TrackItemType.VIDEO),
      ],
      { '1': { status: UNLOCKED, attemptCount: 1 }, '2': { status: LOCKED } },
    );
    expect(quizAttempts.findLatestByProgressId).toHaveBeenCalledWith('p-1');
    expect(items[1].blockedBy.reasons[0]).toEqual({
      code: TrackBlockerReason.BELOW_SCORE,
      actual: 60,
      required: 80,
    });
  });

  it('sets nothing when every item is complete', async () => {
    const items = await load(
      [item('1', TrackItemType.VIDEO), item('2', TrackItemType.VIDEO)],
      { '1': { status: COMPLETED }, '2': { status: COMPLETED } },
    );
    expect(items.every((i) => i.blockedBy === null)).toBe(true);
  });

  it('leaves blockedBy off for a learner who is not enrolled', async () => {
    const items = await load(
      [item('1', TrackItemType.VIDEO), item('2', TrackItemType.VIDEO)],
      {},
      false,
    );
    expect(items.every((i) => i.blockedBy === undefined)).toBe(true);
  });
});

describe('TrackProgressService — missed case attempts', () => {
  const repo = { find: jest.fn(), update: jest.fn() };
  const service = new TrackProgressService(
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    repo as any,
    {} as any,
  );

  it('records the attempt on every unfinished row of that case session', async () => {
    repo.find.mockResolvedValue([
      { id: 'p-1', meta: { maxWatchedPct: 3 } },
      { id: 'p-2', meta: null },
    ]);
    await service.handleCaseSessionAttemptMissed({
      caseSessionId: 'cs-1',
      failureReasons: [RoleplayAttemptFailureReason.INSUFFICIENT_SCORE],
      score: 40,
      durationSeconds: 200,
      requiredScore: 60,
      requiredDurationSeconds: null,
    });
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenCalledWith('p-1', {
      meta: {
        maxWatchedPct: 3,
        lastCaseAttempt: expect.objectContaining({
          score: 40,
          requiredScore: 60,
        }),
      },
    });
  });

  it('never throws into the case flow', async () => {
    repo.find.mockRejectedValue(new Error('db down'));
    await expect(
      service.handleCaseSessionAttemptMissed({
        caseSessionId: 'cs-1',
        failureReasons: [],
        score: null,
        durationSeconds: 0,
        requiredScore: null,
        requiredDurationSeconds: null,
      }),
    ).resolves.toBeUndefined();
  });
});
