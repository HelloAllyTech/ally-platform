import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollment } from '../../entity/track-enrollment.entity';
import { TrackItemProgress } from '../../entity/track-item-progress.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import { TrackItemCompletionLogic, TrackItemType } from '../../type/track.type';
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

describe('TrackProgressService.handleRoleplayEnd — completionLogic', () => {
  const SECTION_ID = 'sec-1';
  const FIRST_ITEM_ID = 'item-1';
  const SECOND_ITEM_ID = 'item-2';
  const FIRST_PROGRESS_ID = 'tip-1';
  const SECOND_PROGRESS_ID = 'tip-2';

  const trackItemProgressRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemRepository = { findOne: jest.fn() };

  // Repos handed out inside the completeItem() transaction.
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

  const configService = {
    simulationPath: { simulationPathItemMinDurationForCompletion: 180 },
  };

  const service = new TrackProgressService(
    dataSource as any,
    configService as any,
    { emit: jest.fn() } as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
  );

  const roleplayItem = (
    id: string,
    order: number,
    completionCriteria: any = {},
  ) => ({
    id,
    trackId: 'track-1',
    trackSectionId: SECTION_ID,
    order,
    type: TrackItemType.ROLEPLAY,
    completionCriteria,
  });

  const arrange = (completionCriteria: any) => {
    const firstItem = roleplayItem(FIRST_ITEM_ID, 1, completionCriteria);
    const secondItem = roleplayItem(SECOND_ITEM_ID, 2);
    const firstProgress = {
      id: FIRST_PROGRESS_ID,
      trackItemId: FIRST_ITEM_ID,
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.UNLOCKED,
      attemptCount: 0,
      meta: {},
    };
    const secondProgress = {
      id: SECOND_PROGRESS_ID,
      trackItemId: SECOND_ITEM_ID,
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.LOCKED,
      attemptCount: 0,
      meta: {},
    };

    trackItemProgressRepository.findOne.mockResolvedValue(firstProgress);
    trackItemRepository.findOne.mockResolvedValue(firstItem);

    txProgressRepo.findOne.mockResolvedValue(firstProgress);
    txProgressRepo.find.mockResolvedValue([firstProgress, secondProgress]);
    txEnrollmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      userId: 7,
      tenantId: 'tenant-1',
      completedItems: 0,
    });
    txItemRepo.findOne.mockResolvedValue(firstItem);
    txItemRepo.find.mockResolvedValue([firstItem, secondItem]);
    txSectionRepo.find.mockResolvedValue([{ id: SECTION_ID, order: 1 }]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes on SCORE logic when score >= minScore, regardless of duration', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.SCORE,
      minScore: 70,
      minDurationSeconds: 180,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 75,
      callDuration: 30_000, // 30s < 180s
    });

    expect(result.completed).toBe(true);
    expect(result.failureReasons).toBeUndefined();
  });

  it('fails on SCORE logic when score < minScore, returning INSUFFICIENT_SCORE', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.SCORE,
      minScore: 70,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 50,
      callDuration: 300_000,
    });

    expect(result.completed).toBe(false);
    expect(result.failureReasons).toEqual(['INSUFFICIENT_SCORE']);
  });

  it('completes on DURATION logic when duration >= minDuration, regardless of score', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.DURATION,
      minScore: 70,
      minDurationSeconds: 60,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 20, // 20 < 70
      callDuration: 90_000, // 90s > 60s
    });

    expect(result.completed).toBe(true);
  });

  it('fails on DURATION logic when duration < minDuration, returning INSUFFICIENT_DURATION', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.DURATION,
      minDurationSeconds: 60,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 90,
      callDuration: 30_000, // 30s < 60s
    });

    expect(result.completed).toBe(false);
    expect(result.failureReasons).toEqual(['INSUFFICIENT_DURATION']);
  });

  it('fails on SCORE_AND_DURATION when both are missed, returning both reasons', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: 70,
      minDurationSeconds: 60,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 50,
      callDuration: 30_000,
    });

    expect(result.completed).toBe(false);
    expect(result.failureReasons).toContain('INSUFFICIENT_SCORE');
    expect(result.failureReasons).toContain('INSUFFICIENT_DURATION');
  });

  it('completes on PARTICIPATION logic regardless of score and duration', async () => {
    arrange({
      completionLogic: TrackItemCompletionLogic.PARTICIPATION,
      minScore: 70,
      minDurationSeconds: 60,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 10,
      callDuration: 5_000,
    });

    expect(result.completed).toBe(true);
  });

  it('defaults to SCORE_AND_DURATION when no logic is specified', async () => {
    arrange({
      minScore: 70,
      minDurationSeconds: 60,
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 50, // miss score
      callDuration: 90_000, // meet duration
    });

    expect(result.completed).toBe(false);
    expect(result.failureReasons).toEqual(['INSUFFICIENT_SCORE']);
  });
});
