import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from '../../type/track.type';
import { TrackProgressService } from '../track-progress.service';

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

/**
 * Assessment-mode roleplays: one attempt per learner, refused at start once
 * used, recorded at end whatever the outcome, and given back only by a
 * trainer in the learner's organisation.
 */
describe('TrackProgressService — roleplay assessment mode', () => {
  const PROGRESS_ID = 'tip-1';
  const ITEM_ID = 'item-1';
  const SCENARIO_ID = 42;
  const USER_ID = 7;
  const TENANT_ID = 'tenant-1';

  const trackItemProgressRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemRepository = { findOne: jest.fn() };
  const tenantRepo = { findOne: jest.fn() };
  const enrollmentRepo = { findOne: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    getRepository: jest.fn(),
    transaction: jest.fn(),
  };
  const configService = {
    simulationPath: { simulationPathItemMinDurationForCompletion: 0 },
  };

  const service = new TrackProgressService(
    dataSource as any,
    configService as any,
    { emit: jest.fn() } as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
  );

  const item = (assessmentMode: boolean, minScore?: number) => ({
    id: ITEM_ID,
    trackId: 'track-1',
    type: TrackItemType.ROLEPLAY,
    scenarioId: SCENARIO_ID,
    completionCriteria: { assessmentMode, minScore },
  });

  const progress = (meta: Record<string, unknown> = {}) => ({
    id: PROGRESS_ID,
    trackItemId: ITEM_ID,
    trackEnrollmentId: 'enr-1',
    userId: USER_ID,
    status: SessionItemStatus.UNLOCKED,
    attemptCount: 0,
    meta,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.getRepository.mockImplementation((entity: { name: string }) =>
      entity.name === 'TrackTenant' ? tenantRepo : enrollmentRepo,
    );
    tenantRepo.findOne.mockResolvedValue({ id: 'tt-1' });
  });

  describe('validateRoleplayStart', () => {
    const start = () =>
      service.validateRoleplayStart(PROGRESS_ID, SCENARIO_ID, {
        userId: USER_ID,
        tenantId: TENANT_ID,
      });

    it('only counts sessions stamped as a valid attempt when they ended', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 0, pending: 0 }]);

      await start();
      const sql: string = dataSource.query.mock.calls[0][0];
      expect(sql).toMatch(/"assessmentAttemptValid" IS TRUE/);
      expect(sql).toMatch(/"eventStatus" <> 'ABANDONED'/);
    });

    it('briefly refuses a restart while the last attempt is still being judged', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 0, pending: 1 }]);

      await expect(start()).rejects.toThrow(/still being saved/);
    });

    describe('a post-assessment', () => {
      const postItem = {
        ...item(true),
        completionCriteria: {
          assessmentMode: true,
          assessmentPhase: 'POST',
          assessmentPairKey: '6f1d0b0e-8f0a-4c3b-9a55-0d6c2f0e9a11',
        },
      };

      it('waits for its pre-assessment to be submitted', async () => {
        trackItemProgressRepository.findOne.mockResolvedValue(progress());
        trackItemRepository.findOne.mockResolvedValue(postItem);
        dataSource.query
          .mockResolvedValueOnce([{ live: 0, ended: 0, pending: 0 }])
          .mockResolvedValueOnce([
            { title: 'Baseline call', submittedAt: null },
          ]);

        await expect(start()).rejects.toThrow(
          /Complete the pre-assessment "Baseline call" first/,
        );
      });

      it('starts once the pre-assessment is submitted', async () => {
        trackItemProgressRepository.findOne.mockResolvedValue(progress());
        trackItemRepository.findOne.mockResolvedValue(postItem);
        dataSource.query
          .mockResolvedValueOnce([{ live: 0, ended: 0, pending: 0 }])
          .mockResolvedValueOnce([
            { title: 'Baseline call', submittedAt: '2026-11-01T00:00:00Z' },
          ]);

        await expect(start()).resolves.toBeUndefined();
      });

      it('starts when its pre-assessment is gone', async () => {
        trackItemProgressRepository.findOne.mockResolvedValue(progress());
        trackItemRepository.findOne.mockResolvedValue(postItem);
        dataSource.query
          .mockResolvedValueOnce([{ live: 0, ended: 0, pending: 0 }])
          .mockResolvedValueOnce([]);

        await expect(start()).resolves.toBeUndefined();
      });
    });

    it('allows the first attempt', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 0 }]);

      await expect(start()).resolves.toBeUndefined();
      expect(dataSource.query.mock.calls[0][1]).toEqual([PROGRESS_ID, null]);
    });

    it('refuses a second attempt once one has ended', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 1 }]);

      await expect(start()).rejects.toThrow(/already submitted/);
    });

    it('refuses a parallel start while the attempt is live', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 1, ended: 0 }]);

      await expect(start()).rejects.toThrow(/already in progress/);
    });

    it('also refuses a replay of a passed assessment', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue({
        ...progress(),
        status: SessionItemStatus.COMPLETED,
      });
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 1 }]);

      await expect(start()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only counts sessions after a trainer reopen', async () => {
      const reopenedAt = '2026-10-27T10:00:00.000Z';
      trackItemProgressRepository.findOne.mockResolvedValue(
        progress({ assessmentReopenedAt: reopenedAt }),
      );
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 0 }]);

      await expect(start()).resolves.toBeUndefined();
      expect(dataSource.query.mock.calls[0][1]).toEqual([
        PROGRESS_ID,
        reopenedAt,
      ]);
    });

    it('does not gate a practice roleplay', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(false));

      await expect(start()).resolves.toBeUndefined();
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('handleRoleplayEnd', () => {
    it('records a failed attempt as submitted, with its score', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true, 50));

      const result = await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        score: 20,
        callDuration: 60_000,
      });

      expect(result.completed).toBe(false);
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update.attemptCount).toBe(1);
      expect(update.score).toBe(20);
      expect(typeof update.meta.assessmentSubmittedAt).toBe('string');
    });

    it('re-stamps a passed assessment a trainer reopened, without un-completing it', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue({
        ...progress({ assessmentReopenedAt: '2026-10-27T10:00:00.000Z' }),
        status: SessionItemStatus.COMPLETED,
        score: 80,
      });
      trackItemRepository.findOne.mockResolvedValue(item(true, 50));

      const result = await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        score: 30,
        callDuration: 60_000,
      });

      expect(result.completed).toBe(true);
      expect(result.assessmentAttemptValid).toBe(true);
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update).toEqual({
        attemptCount: 1,
        meta: {
          assessmentReopenedAt: '2026-10-27T10:00:00.000Z',
          assessmentSubmittedAt: expect.any(String),
          assessmentSubmission: expect.objectContaining({ score: 30 }),
        },
      });
      expect(update).not.toHaveProperty('score');
    });

    it('does not submit an assessment the learner never spoke in', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true, 50));

      const result = await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        score: undefined,
        callDuration: 0,
        learnerTookPart: false,
      });

      expect(result.completed).toBe(false);
      expect(result.assessmentAttemptValid).toBeNull();
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      // Not submitted and nothing to explain: it never costs the attempt.
      expect(update).toEqual({ attemptCount: 1 });
    });

    it('discards an attempt below the minimum turns, so the learner can restart', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(
        progress({ assessmentIncompleteStarts: 1 }),
      );
      trackItemRepository.findOne.mockResolvedValue({
        ...item(true, 50),
        completionCriteria: {
          assessmentMode: true,
          minScore: 50,
          minLearnerTurns: 10,
        },
      });

      const result = await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        scenarioSessionId: 'sess-1',
        score: 90,
        callDuration: 60_000,
        learnerTurns: 4,
      });

      expect(result.assessmentAttemptValid).toBe(false);
      expect(result.completed).toBe(false);
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update).not.toHaveProperty('score');
      expect(update.meta).not.toHaveProperty('assessmentSubmittedAt');
      expect(update.meta.assessmentIncompleteStarts).toBe(2);
      expect(update.meta.lastRoleplayAttempt).toMatchObject({
        failureReasons: ['INSUFFICIENT_TURNS'],
        learnerTurns: 4,
        requiredTurns: 10,
      });
    });

    it('submits an attempt that reaches the minimum turns, judged by the rule then', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue({
        ...item(true, 50),
        completionCriteria: {
          assessmentMode: true,
          minScore: 50,
          minLearnerTurns: 10,
          minDurationSeconds: 600,
        },
      });

      const result = await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        scenarioSessionId: 'sess-1',
        score: 20,
        callDuration: 30_000,
        learnerTurns: 10,
      });

      expect(result.assessmentAttemptValid).toBe(true);
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update.score).toBe(20);
      expect(update.meta.assessmentSubmission).toEqual({
        scenarioSessionId: 'sess-1',
        learnerTurns: 10,
        requiredTurns: 10,
        score: 20,
        requiredScore: 50,
        submittedAt: expect.any(String),
      });
      // Short call, but duration never gates an assessment: only the pass mark.
      expect(update.meta.lastRoleplayAttempt.failureReasons).toEqual([
        'INSUFFICIENT_SCORE',
      ]);
    });

    it('leaves a practice roleplay unstamped', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(false, 50));

      await service.handleRoleplayEnd({
        trackItemProgressId: PROGRESS_ID,
        score: 20,
        callDuration: 60_000,
      });

      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update.attemptCount).toBe(1);
      expect(update).not.toHaveProperty('score');
      // Not submitted; only the missed-gate record for the learner is kept.
      expect(update.meta).not.toHaveProperty('assessmentSubmittedAt');
      expect(update.meta.lastRoleplayAttempt.failureReasons).toEqual([
        'INSUFFICIENT_SCORE',
      ]);
    });
  });

  describe('handleRoleplayLaunch', () => {
    it('never completes an assessment on launch, even a legacy PARTICIPATION one', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue({
        ...item(true),
        completionCriteria: {
          assessmentMode: true,
          completionLogic: 'PARTICIPATION',
        },
      });

      const result = await service.handleRoleplayLaunch(PROGRESS_ID);

      expect(result.completed).toBe(false);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('reopenRoleplayAssessment', () => {
    it("clears the submission for a learner in the trainer's organisation", async () => {
      trackItemRepository.findOne.mockResolvedValue(item(true));
      trackItemProgressRepository.findOne.mockResolvedValue(
        progress({ assessmentSubmittedAt: '2026-10-26T09:00:00.000Z' }),
      );
      enrollmentRepo.findOne.mockResolvedValue({ tenantId: TENANT_ID });

      await service.reopenRoleplayAssessment(ITEM_ID, USER_ID, TENANT_ID);

      const [id, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(id).toBe(PROGRESS_ID);
      expect(update.meta.assessmentSubmittedAt).toBeUndefined();
      expect(update.meta.assessmentIncompleteStarts).toBeUndefined();
      expect(typeof update.meta.assessmentReopenedAt).toBe('string');
    });

    it('hides learners in another organisation', async () => {
      trackItemRepository.findOne.mockResolvedValue(item(true));
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      enrollmentRepo.findOne.mockResolvedValue({ tenantId: 'other' });

      await expect(
        service.reopenRoleplayAssessment(ITEM_ID, USER_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(trackItemProgressRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a roleplay that is not an assessment', async () => {
      trackItemRepository.findOne.mockResolvedValue(item(false));

      await expect(
        service.reopenRoleplayAssessment(ITEM_ID, USER_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
