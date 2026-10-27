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

    it('only counts sessions the learner spoke in and that ended properly', async () => {
      trackItemProgressRepository.findOne.mockResolvedValue(progress());
      trackItemRepository.findOne.mockResolvedValue(item(true));
      dataSource.query.mockResolvedValue([{ live: 0, ended: 0 }]);

      await start();
      const sql: string = dataSource.query.mock.calls[0][0];
      expect(sql).toMatch(/m\."senderId" <> -1/);
      expect(sql).toMatch(/"eventStatus" <> 'ABANDONED'/);
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
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update).toEqual({
        meta: {
          assessmentReopenedAt: '2026-10-27T10:00:00.000Z',
          assessmentSubmittedAt: expect.any(String),
        },
      });
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
      const [, update] = trackItemProgressRepository.update.mock.calls[0];
      expect(update).toEqual({ attemptCount: 1 });
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
      expect(update).toEqual({ attemptCount: 1 });
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
