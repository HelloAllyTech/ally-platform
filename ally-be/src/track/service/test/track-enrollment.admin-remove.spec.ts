import { NotFoundException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { TrackEnrollment } from '../../entity/track-enrollment.entity';
import { TrackItemProgress } from '../../entity/track-item-progress.entity';
import { TrackAccessDenialReason, TrackStatus } from '../../type/track.type';

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
 * The trainer's "remove from course" action and the list it acts on. The list
 * has to say whether each course would still reach the learner without the
 * enrolment, because a learner kept in a course only by the enrolment grace is
 * the case this exists to fix.
 */
describe('TrackEnrollmentService — trainer removes a learner from a course', () => {
  const TENANT_ID = 'tenant-1';
  const OTHER_TENANT_ID = 'tenant-2';
  const USER_ID = 42;
  const ENROLLMENT_ID = '0b6f3a1e-9a51-4a2b-8f3e-2d3c4b5a6f70';
  const TRACK_ID = '7b0c3c52-2f7a-4c2a-9a55-0e4d6f1d2a11';

  const progressRepo = { softDelete: jest.fn() };
  const enrollmentRepo = { softDelete: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === TrackItemProgress ? progressRepo : enrollmentRepo,
    ),
  };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const trackTenantRepository = { findOne: jest.fn() };
  const trackEnrollmentRepository = { findOne: jest.fn() };
  const cohortVisibilityService = { canAccess: jest.fn() };

  const service = new TrackEnrollmentService(
    dataSource as any,
    {} as any, // trackRepository
    trackTenantRepository as any,
    trackEnrollmentRepository as any,
    {} as any, // trackItemProgressRepository
    {} as any, // trackJournalEntryRepository
    {} as any, // trackQuizAttemptRepository
    {} as any, // trackAnnotationAttemptRepository
    {} as any, // trackSharedService
    {} as any, // trackProgressService
    {} as any, // caseSessionService
    {} as any, // scenarioSharedService
    {} as any, // trackLocalizationService
    cohortVisibilityService as any,
  );

  const row = (overrides: Record<string, unknown> = {}) => ({
    trackEnrollmentId: ENROLLMENT_ID,
    trackId: TRACK_ID,
    trackTitle: 'Active listening',
    trackStatus: TrackStatus.ACTIVE,
    totalItems: 8,
    completedItems: 3,
    enrolledAt: new Date('2026-10-01T00:00:00Z'),
    completedAt: null,
    lastActivityAt: new Date('2026-10-20T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(TENANT_ID);
    trackTenantRepository.findOne.mockResolvedValue({ id: 'mapping' });
    cohortVisibilityService.canAccess.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listLearnerEnrollmentsForAdmin', () => {
    it("scopes the query to the learner and the caller's organisation", async () => {
      dataSource.query.mockResolvedValue([]);

      await service.listLearnerEnrollmentsForAdmin(USER_ID);

      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('te."deletedAt" IS NULL');
      expect(params).toEqual([USER_ID, TENANT_ID]);
    });

    it('reports no denial for a course still open to the learner', async () => {
      dataSource.query.mockResolvedValue([row()]);

      const [result] = await service.listLearnerEnrollmentsForAdmin(USER_ID);

      expect(result.accessDenial).toBeNull();
      expect(result.completedItems).toBe(3);
      expect(result.totalItems).toBe(8);
    });

    it('flags a course the learner sees only because they are enrolled', async () => {
      dataSource.query.mockResolvedValue([row()]);
      cohortVisibilityService.canAccess.mockResolvedValue(false);

      const [result] = await service.listLearnerEnrollmentsForAdmin(USER_ID);

      expect(result.accessDenial).toBe(TrackAccessDenialReason.NOT_IN_GROUP);
      // The enrolment must not count as access here, or every row reads open.
      expect(cohortVisibilityService.canAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: TRACK_ID,
          userId: USER_ID,
          alreadyStarted: false,
        }),
      );
    });

    it('flags a course no longer assigned to the organisation', async () => {
      dataSource.query.mockResolvedValue([row()]);
      trackTenantRepository.findOne.mockResolvedValue(null);

      const [result] = await service.listLearnerEnrollmentsForAdmin(USER_ID);

      expect(result.accessDenial).toBe(
        TrackAccessDenialReason.NOT_IN_ORGANIZATION,
      );
    });

    it('flags an archived course without checking group access', async () => {
      dataSource.query.mockResolvedValue([
        row({ trackStatus: TrackStatus.ARCHIVED }),
      ]);

      const [result] = await service.listLearnerEnrollmentsForAdmin(USER_ID);

      expect(result.accessDenial).toBe(TrackAccessDenialReason.NOT_AVAILABLE);
      expect(cohortVisibilityService.canAccess).not.toHaveBeenCalled();
    });

    it('refuses without an organisation in the auth context', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(
        service.listLearnerEnrollmentsForAdmin(USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('removeLearnerEnrollmentForAdmin', () => {
    it('soft-deletes the enrolment and its progress together', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: ENROLLMENT_ID,
        trackId: TRACK_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
      });

      await expect(
        service.removeLearnerEnrollmentForAdmin(USER_ID, ENROLLMENT_ID),
      ).resolves.toEqual({ success: true });

      expect(trackEnrollmentRepository.findOne).toHaveBeenCalledWith({
        where: { id: ENROLLMENT_ID, userId: USER_ID },
      });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.getRepository).toHaveBeenCalledWith(TrackItemProgress);
      expect(manager.getRepository).toHaveBeenCalledWith(TrackEnrollment);
      expect(progressRepo.softDelete).toHaveBeenCalledWith({
        trackEnrollmentId: ENROLLMENT_ID,
      });
      expect(enrollmentRepo.softDelete).toHaveBeenCalledWith(ENROLLMENT_ID);
    });

    it("answers 404 for another organisation's enrolment and changes nothing", async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: ENROLLMENT_ID,
        trackId: TRACK_ID,
        userId: USER_ID,
        tenantId: OTHER_TENANT_ID,
      });

      await expect(
        service.removeLearnerEnrollmentForAdmin(USER_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for an enrolment that is gone or belongs to someone else', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeLearnerEnrollmentForAdmin(USER_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
