import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollment } from '../../entity/track-enrollment.entity';
import { TrackItemProgress } from '../../entity/track-item-progress.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import {
  RoleplayAttemptFailureReason,
  TrackItemCompletionCriteria,
  TrackItemCompletionLogic,
  TrackItemType,
} from '../../type/track.type';
import { TRACK_EVENTS, TrackProgressService } from '../track-progress.service';

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

const { SCORE, DURATION, SCORE_AND_DURATION, PARTICIPATION } =
  TrackItemCompletionLogic;
const { INSUFFICIENT_SCORE, INSUFFICIENT_DURATION } =
  RoleplayAttemptFailureReason;

/**
 * Per-item completion logic for a roleplay in a course: which of minimum
 * score and minimum duration gate it, the platform-default fallback for
 * duration, the failure reasons kept for the learner, and PARTICIPATION
 * completing on launch.
 */
describe('TrackProgressService — roleplay completionLogic', () => {
  const SECTION_ID = 'sec-1';
  const ITEM_ID = 'item-1';
  const NEXT_ITEM_ID = 'item-2';
  const PROGRESS_ID = 'tip-1';
  const NEXT_PROGRESS_ID = 'tip-2';

  const trackItemProgressRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemRepository = { findOne: jest.fn() };
  const txProgressRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const txEnrollmentRepo = { findOne: jest.fn(), update: jest.fn() };
  const txItemRepo = { findOne: jest.fn(), find: jest.fn() };
  const txSectionRepo = { find: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === TrackItemProgress) return txProgressRepo;
      if (entity === TrackEnrollment) return txEnrollmentRepo;
      if (entity === TrackItem) return txItemRepo;
      if (entity === TrackSection) return txSectionRepo;
      throw new Error('Unexpected entity requested in transaction');
    }),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    getRepository: jest.fn(),
  };
  // The env var is validated as a string, so it arrives as one.
  const configService = {
    simulationPath: { simulationPathItemMinDurationForCompletion: '180' },
  };
  const eventEmitter = { emit: jest.fn() };

  const service = new TrackProgressService(
    dataSource as any,
    configService as any,
    eventEmitter as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
  );

  const arrange = (completionCriteria: TrackItemCompletionCriteria) => {
    const item = {
      id: ITEM_ID,
      trackId: 'track-1',
      trackSectionId: SECTION_ID,
      order: 1,
      type: TrackItemType.ROLEPLAY,
      completionCriteria,
    };
    const next = {
      ...item,
      id: NEXT_ITEM_ID,
      order: 2,
      completionCriteria: {},
    };
    const progress = {
      id: PROGRESS_ID,
      trackItemId: ITEM_ID,
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.UNLOCKED,
      attemptCount: 0,
      meta: {},
    };
    const nextProgress = {
      ...progress,
      id: NEXT_PROGRESS_ID,
      trackItemId: NEXT_ITEM_ID,
      status: SessionItemStatus.LOCKED,
    };
    trackItemProgressRepository.findOne.mockResolvedValue(progress);
    trackItemRepository.findOne.mockResolvedValue(item);
    txProgressRepo.findOne.mockResolvedValue(progress);
    txProgressRepo.find.mockResolvedValue([progress, nextProgress]);
    txEnrollmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      userId: 7,
      tenantId: 'tenant-1',
      completedItems: 0,
    });
    txItemRepo.findOne.mockResolvedValue(item);
    txItemRepo.find.mockResolvedValue([item, next]);
    txSectionRepo.find.mockResolvedValue([{ id: SECTION_ID, order: 1 }]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => unknown) => cb(manager),
    );
    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === TrackItemProgress) return txProgressRepo;
      if (entity === TrackEnrollment) return txEnrollmentRepo;
      if (entity === TrackItem) return txItemRepo;
      if (entity === TrackSection) return txSectionRepo;
      throw new Error('Unexpected entity requested in transaction');
    });
  });

  const end = (score: number | undefined, seconds: number) =>
    service.handleRoleplayEnd({
      trackItemProgressId: PROGRESS_ID,
      score,
      callDuration: seconds * 1000,
    });

  /** The meta written on the attempt-count update, if any. */
  const storedAttempt = () =>
    trackItemProgressRepository.update.mock.calls[0]?.[1]?.meta
      ?.lastRoleplayAttempt;

  const emittedAttempt = () =>
    eventEmitter.emit.mock.calls.find(
      ([name]) => name === TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED,
    )?.[1];

  describe('SCORE', () => {
    beforeEach(() =>
      arrange({ completionLogic: SCORE, minScore: 60, minDurationSeconds: 90 }),
    );

    it('completes a short call that clears the score', async () => {
      expect((await end(70, 5)).completed).toBe(true);
    });

    it('fails on score alone and says so', async () => {
      expect((await end(40, 300)).completed).toBe(false);
      expect(storedAttempt()).toMatchObject({
        failureReasons: [INSUFFICIENT_SCORE],
        score: 40,
        requiredScore: 60,
        requiredDurationSeconds: null,
      });
      expect(emittedAttempt()).toMatchObject({
        outcome: 'below_score',
        failureReasons: [INSUFFICIENT_SCORE],
      });
    });
  });

  describe('DURATION', () => {
    beforeEach(() =>
      arrange({
        completionLogic: DURATION,
        minScore: 60,
        minDurationSeconds: 90,
      }),
    );

    it('completes a long-enough call whatever the score', async () => {
      expect((await end(-30, 95)).completed).toBe(true);
    });

    it('fails a call under 90s and says it was too short', async () => {
      expect((await end(99, 80)).completed).toBe(false);
      expect(storedAttempt()).toMatchObject({
        failureReasons: [INSUFFICIENT_DURATION],
        durationSeconds: 80,
        requiredDurationSeconds: 90,
        requiredScore: null,
      });
      expect(emittedAttempt()).toMatchObject({ outcome: 'too_short' });
    });

    it('falls back to the platform default when the item sets no duration', async () => {
      arrange({ completionLogic: DURATION });
      expect((await end(0, 170)).completed).toBe(false);
      expect(storedAttempt()).toMatchObject({ requiredDurationSeconds: 180 });

      jest.clearAllMocks();
      arrange({ completionLogic: DURATION });
      expect((await end(0, 181)).completed).toBe(true);
    });

    it('reads an explicit 0 as no minimum', async () => {
      arrange({ completionLogic: DURATION, minDurationSeconds: 0 });
      expect((await end(0, 1)).completed).toBe(true);
    });
  });

  describe('SCORE_AND_DURATION', () => {
    beforeEach(() =>
      arrange({
        completionLogic: SCORE_AND_DURATION,
        minScore: 60,
        minDurationSeconds: 90,
      }),
    );

    it('completes only when both are cleared', async () => {
      expect((await end(60, 90)).completed).toBe(true);
    });

    it('reports both reasons when both are missed', async () => {
      expect((await end(10, 30)).completed).toBe(false);
      expect(storedAttempt()?.failureReasons).toEqual([
        INSUFFICIENT_DURATION,
        INSUFFICIENT_SCORE,
      ]);
      expect(emittedAttempt()).toMatchObject({
        outcome: 'too_short',
        failureReasons: [INSUFFICIENT_DURATION, INSUFFICIENT_SCORE],
      });
    });

    it('treats an item with no completionLogic exactly the same (legacy rows)', async () => {
      arrange({ minScore: 60 });
      expect((await end(70, 100)).completed).toBe(false); // < 180s default
      expect(storedAttempt()?.failureReasons).toEqual([INSUFFICIENT_DURATION]);
    });
  });

  describe('PARTICIPATION', () => {
    beforeEach(() =>
      arrange({
        completionLogic: PARTICIPATION,
        minScore: 60,
        minDurationSeconds: 90,
      }),
    );

    it('completes on launch', async () => {
      const result = await service.handleRoleplayLaunch(PROGRESS_ID);
      expect(result.completed).toBe(true);
      expect(result.unlockedItemIds).toEqual([NEXT_ITEM_ID]);
      expect(txProgressRepo.update).toHaveBeenCalledWith(
        PROGRESS_ID,
        expect.objectContaining({ status: SessionItemStatus.COMPLETED }),
      );
    });

    it('completes at the end too, however short or low-scoring', async () => {
      expect((await end(-80, 2)).completed).toBe(true);
    });
  });

  describe('handleRoleplayLaunch on gated items', () => {
    it.each([SCORE, DURATION, SCORE_AND_DURATION, undefined])(
      'does nothing for %s',
      async (completionLogic) => {
        arrange({ completionLogic });
        const result = await service.handleRoleplayLaunch(PROGRESS_ID);
        expect(result.completed).toBe(false);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );
  });

  it('clears the stored failure once a later attempt completes', async () => {
    arrange({ completionLogic: SCORE, minScore: 60 });
    await end(70, 10);
    const completedMeta = txProgressRepo.update.mock.calls.find(
      ([id]) => id === PROGRESS_ID,
    )?.[1]?.meta;
    expect(completedMeta).toHaveProperty('lastRoleplayAttempt', undefined);
    expect(JSON.parse(JSON.stringify(completedMeta))).not.toHaveProperty(
      'lastRoleplayAttempt',
    );
  });
});
