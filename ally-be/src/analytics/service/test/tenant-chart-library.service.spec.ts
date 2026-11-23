import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantCapabilitiesRepository } from '../../repository/tenant-capabilities.repository';
import { TenantOutcomesRepository } from '../../repository/tenant-outcomes.repository';
import { TenantCapabilities } from '../../util/tenant-chart-library.util';
import { TenantAnalyticsService } from '../tenant-analytics.service';
import { TenantChartLibraryService } from '../tenant-chart-library.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

const caps = (over: Partial<TenantCapabilities> = {}): TenantCapabilities => ({
  learners: 0,
  activeLearners90: 0,
  sessions90: 0,
  scoredSessions90: 0,
  learnersWithRepeatScoredSessions: 0,
  ratings: 0,
  weeksWithActivity90: 0,
  courseEnrolments: 0,
  courseCompletions: 0,
  scoredQuizItems: 0,
  reviews: 0,
  cohorts: 0,
  skillScoredCuts: 0,
  skillScoredLearners: 0,
  ...over,
});

describe('TenantChartLibraryService', () => {
  let repo: jest.Mocked<TenantCapabilitiesRepository>;
  let analytics: jest.Mocked<TenantAnalyticsService>;
  let outcomes: jest.Mocked<TenantOutcomesRepository>;
  let service: TenantChartLibraryService;

  beforeEach(() => {
    repo = {
      getTenantKeys: jest.fn(),
      getCapabilities: jest.fn(),
    } as unknown as jest.Mocked<TenantCapabilitiesRepository>;
    analytics = {
      getOrganizationMetrics: jest.fn(),
      getPreviousPeriodCounts: jest.fn(),
      getLearnerUsage: jest.fn(),
      getCourseUsage: jest.fn(),
    } as unknown as jest.Mocked<TenantAnalyticsService>;
    outcomes = {
      getScoreDistribution: jest.fn(),
      getLearnerTrendCounts: jest.fn(),
      getScenarioScores: jest.fn(),
      getRatingCounts: jest.fn(),
      getReviewCoverage: jest.fn(),
    } as unknown as jest.Mocked<TenantOutcomesRepository>;
    service = new TenantChartLibraryService(repo, analytics, outcomes);
  });

  const enabled = () =>
    repo.getTenantKeys.mockResolvedValue({
      code: 'internal1',
      statisticsDashboardEnabled: true,
    });

  describe('getLibrary', () => {
    it('is off by default: enabled false, no charts, no data queried', async () => {
      repo.getTenantKeys.mockResolvedValue({
        code: 'x',
        statisticsDashboardEnabled: false,
      });
      await expect(service.getLibrary(TENANT)).resolves.toEqual({
        enabled: false,
        charts: [],
      });
      expect(repo.getCapabilities).not.toHaveBeenCalled();
    });

    it('is off for an unknown tenant', async () => {
      repo.getTenantKeys.mockResolvedValue(null);
      await expect(service.getLibrary(TENANT)).resolves.toEqual({
        enabled: false,
        charts: [],
      });
    });

    it('lists only live charts, each with availability', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ courseEnrolments: 0 }));
      const lib = await service.getLibrary(TENANT);
      expect(lib.enabled).toBe(true);
      expect(lib.charts.map((c) => c.id)).toEqual([
        'TSQ-001',
        'TSQ-002',
        'TSQ-003',
        'TSQ-007',
        'TSQ-008',
        'TSQ-009',
        'TSQ-013',
        'TSQ-014',
        'TSQ-015',
        'TSQ-016',
        'TSQ-017',
        'TSQ-020',
        'TSQ-021',
        'TSQ-022',
        'TSQ-023',
        'TSQ-026',
        'TSQ-027',
      ]);
      const byId = Object.fromEntries(lib.charts.map((c) => [c.id, c]));
      expect(byId['TSQ-001'].state).toBe('available');
      expect(byId['TSQ-013'].state).toBe('unavailable');
      expect(byId['TSQ-013'].reason).toContain('course enrolment');
    });

    it('marks usage over time sparse with a few weeks of activity', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ weeksWithActivity90: 2 }));
      const lib = await service.getLibrary(TENANT);
      expect(lib.charts.find((c) => c.id === 'TSQ-002')?.state).toBe('sparse');
    });

    it('passes the tenant code so both tenant spellings match', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      await service.getLibrary(TENANT);
      expect(repo.getCapabilities).toHaveBeenCalledWith(TENANT, 'internal1');
    });
  });

  describe('getChartData', () => {
    it('refuses when the page is off for the tenant', async () => {
      repo.getTenantKeys.mockResolvedValue({
        code: 'x',
        statisticsDashboardEnabled: false,
      });
      await expect(
        service.getChartData(TENANT, 'TSQ-001', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(analytics.getOrganizationMetrics).not.toHaveBeenCalled();
    });

    it('404s an unknown id and a planned (not live) chart', async () => {
      enabled();
      await expect(
        service.getChartData(TENANT, 'TSQ-999', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      // TSQ-005 (weekday and hour) is planned: the id exists, nothing is offered.
      await expect(
        service.getChartData(TENANT, 'TSQ-005', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      // TSQ-028 (seats) is blocked on a seat model.
      await expect(
        service.getChartData(TENANT, 'TSQ-028', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the headline numbers from organization-metrics, defaulting to 90 days', async () => {
      enabled();
      const summary = { simulationsCompleted: 12 };
      const previous = { activeUsers: 3, simulationsCompleted: 9 };
      analytics.getOrganizationMetrics.mockResolvedValue({
        summary,
      } as never);
      analytics.getPreviousPeriodCounts.mockResolvedValue(previous);
      const out = await service.getChartData(TENANT, 'TSQ-001', {});
      expect(analytics.getOrganizationMetrics).toHaveBeenCalledWith(
        TENANT,
        '90d',
      );
      expect(analytics.getPreviousPeriodCounts).toHaveBeenCalledWith(
        TENANT,
        '90d',
      );
      expect(out).toEqual({
        id: 'TSQ-001',
        state: 'available',
        data: { ...summary, previous },
      });
      // A chart that needs nothing does not pay for the capabilities query.
      expect(repo.getCapabilities).not.toHaveBeenCalled();
    });

    it('honours an explicit range', async () => {
      enabled();
      analytics.getOrganizationMetrics.mockResolvedValue({
        summary: {},
      } as never);
      analytics.getPreviousPeriodCounts.mockResolvedValue(null);
      await service.getChartData(TENANT, 'TSQ-001', { range: '30d' });
      expect(analytics.getOrganizationMetrics).toHaveBeenCalledWith(
        TENANT,
        '30d',
      );
    });

    it('refuses a chart the tenant cannot fill, without running its query', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ courseEnrolments: 0 }));
      await expect(
        service.getChartData(TENANT, 'TSQ-013', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(analytics.getCourseUsage).not.toHaveBeenCalled();
    });

    it('runs the course table once the tenant has an enrolment', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ courseEnrolments: 3 }));
      analytics.getCourseUsage.mockResolvedValue({
        data: [],
        count: 0,
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-013', {
        limit: 10,
        offset: 20,
        search: 'gate',
      });
      expect(analytics.getCourseUsage).toHaveBeenCalledWith(TENANT, {
        search: 'gate',
        limit: 10,
        offset: 20,
      });
      expect(out.state).toBe('available');
    });

    it('passes table paging to the learner table', async () => {
      enabled();
      analytics.getLearnerUsage.mockResolvedValue({
        data: [],
        count: 0,
      } as never);
      await service.getChartData(TENANT, 'TSQ-009', { limit: 5, offset: 5 });
      expect(analytics.getLearnerUsage).toHaveBeenCalledWith(TENANT, {
        range: '90d',
        search: undefined,
        limit: 5,
        offset: 5,
      });
    });
  });

  describe('learner charts', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 1,
      name: 'A',
      status: 'active',
      totalPracticeMinutes: 0,
      daysSinceLastActivity: 0,
      ...over,
    });

    it('TSQ-007 counts learners by status and says when it was cut short', async () => {
      enabled();
      analytics.getLearnerUsage.mockResolvedValue({
        count: 5,
        data: [
          row({ status: 'active' }),
          row({ status: 'active' }),
          row({ status: 'at_risk' }),
          row({ status: 'dormant' }),
          row({ status: 'never_started' }),
        ],
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-007', {});
      expect(out.data).toEqual({
        total: 5,
        truncated: false,
        counts: { active: 2, at_risk: 1, dormant: 1, never_started: 1 },
      });
      expect(analytics.getLearnerUsage).toHaveBeenCalledWith(TENANT, {
        range: '90d',
        limit: 200,
        offset: 0,
      });
    });

    it('TSQ-007 flags truncation when there are more learners than were read', async () => {
      enabled();
      analytics.getLearnerUsage.mockResolvedValue({
        count: 250,
        data: [row({})],
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-007', {});
      expect((out.data as { truncated: boolean }).truncated).toBe(true);
    });

    it('TSQ-008 ranks by practice minutes and drops learners with none', async () => {
      enabled();
      analytics.getLearnerUsage.mockResolvedValue({
        count: 3,
        data: [
          row({ id: 1, name: 'Priya', totalPracticeMinutes: 90 }),
          row({ id: 2, name: 'Arjun', totalPracticeMinutes: 40 }),
          row({ id: 3, name: 'Zero', totalPracticeMinutes: 0 }),
        ],
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-008', {
        range: '30d',
      });
      expect(out.data).toEqual({
        rows: [
          { id: 1, name: 'Priya', practiceMinutes: 90 },
          { id: 2, name: 'Arjun', practiceMinutes: 40 },
        ],
      });
      expect(analytics.getLearnerUsage).toHaveBeenCalledWith(TENANT, {
        range: '30d',
        sortBy: 'totalPracticeMinutes',
        order: 'DESC',
        limit: 6,
        offset: 0,
      });
    });

    it('TSQ-023 lists at-risk and dormant learners, longest quiet first', async () => {
      enabled();
      analytics.getLearnerUsage.mockResolvedValue({
        count: 11,
        data: [
          row({
            id: 9,
            name: 'Quiet',
            status: 'dormant',
            daysSinceLastActivity: 41,
          }),
        ],
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-023', {});
      expect(out.data).toEqual({
        total: 11,
        rows: [
          {
            id: 9,
            name: 'Quiet',
            status: 'dormant',
            daysSinceLastActivity: 41,
          },
        ],
      });
      expect(analytics.getLearnerUsage).toHaveBeenCalledWith(TENANT, {
        range: '90d',
        status: ['at_risk', 'dormant'],
        sortBy: 'lastActivityAt',
        order: 'ASC',
        limit: 5,
        offset: 0,
      });
    });
  });

  describe('course and activity charts', () => {
    const course = (over: Record<string, unknown>) => ({
      id: 'c1',
      title: 'Course',
      learnersAssigned: 4,
      learnersStarted: 0,
      learnersAtLeast50: 0,
      learnersCompleted100: 0,
      inProgressStalled: 0,
      ...over,
    });
    const withCourses = (rows: unknown[], count = rows.length) => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ courseEnrolments: 9 }));
      analytics.getCourseUsage.mockResolvedValue({
        data: rows,
        count,
      } as never);
    };

    it('TSQ-014 splits courses into in use and idle', async () => {
      withCourses([
        course({ id: 'a', learnersStarted: 2 }),
        course({ id: 'b' }),
        course({ id: 'c' }),
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-014', {});
      expect(out.data).toEqual({
        total: 3,
        inUse: 1,
        idle: 2,
        truncated: false,
      });
    });

    it('TSQ-015 ranks courses by stalled learners and drops zeros', async () => {
      withCourses([
        course({ id: 'a', title: 'A', inProgressStalled: 1 }),
        course({ id: 'b', title: 'B', inProgressStalled: 5 }),
        course({ id: 'c', title: 'C', inProgressStalled: 0 }),
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-015', {});
      expect(out.data).toEqual({
        truncated: false,
        rows: [
          { id: 'b', title: 'B', count: 5 },
          { id: 'a', title: 'A', count: 1 },
        ],
      });
    });

    it('TSQ-016 ranks courses by learners assigned but not started', async () => {
      withCourses([
        course({ id: 'a', learnersAssigned: 10, learnersStarted: 4 }),
        course({ id: 'b', learnersAssigned: 3, learnersStarted: 3 }),
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-016', {});
      expect(out.data).toEqual({
        truncated: false,
        rows: [{ id: 'a', title: 'Course', count: 6 }],
      });
    });

    it('TSQ-017 sums the stages across courses and flags truncation', async () => {
      withCourses(
        [
          course({
            learnersAssigned: 10,
            learnersStarted: 8,
            learnersAtLeast50: 5,
            learnersCompleted100: 2,
          }),
          course({
            learnersAssigned: 6,
            learnersStarted: 3,
            learnersAtLeast50: 1,
            learnersCompleted100: 1,
          }),
        ],
        250,
      );
      const out = await service.getChartData(TENANT, 'TSQ-017', {});
      expect(out.data).toEqual({
        truncated: true,
        stages: [
          { key: 'assigned', count: 16 },
          { key: 'started', count: 11 },
          { key: 'halfway', count: 6 },
          { key: 'completed', count: 3 },
        ],
      });
    });
  });

  describe('outcome and feedback charts', () => {
    const ready = () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(
        caps({
          scoredSessions90: 40,
          learnersWithRepeatScoredSessions: 9,
          ratings: 30,
          reviews: 4,
        }),
      );
    };

    it('TSQ-020 returns the score bins and the median', async () => {
      ready();
      const dist = {
        bins: [0, 0, 0, 0, 3, 1, 13, 132, 171, 0],
        sessions: 320,
        median: 80,
      };
      outcomes.getScoreDistribution.mockResolvedValue(dist);
      const out = await service.getChartData(TENANT, 'TSQ-020', {});
      expect(out.data).toEqual(dist);
      expect(outcomes.getScoreDistribution).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('TSQ-021 adds the total and the threshold to the trend counts', async () => {
      ready();
      outcomes.getLearnerTrendCounts.mockResolvedValue({
        improving: 8,
        holding: 5,
        declining: 0,
      });
      const out = await service.getChartData(TENANT, 'TSQ-021', {});
      expect(out.data).toEqual({
        improving: 8,
        holding: 5,
        declining: 0,
        total: 13,
        threshold: 5,
      });
    });

    it('TSQ-022 passes the minimum sessions and limit, lowest first', async () => {
      ready();
      outcomes.getScenarioScores.mockResolvedValue([
        { scenarioId: 1, title: 'A', averageScore: 54, sessions: 5 },
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-022', {});
      expect(out.data).toEqual({
        rows: [{ scenarioId: 1, title: 'A', averageScore: 54, sessions: 5 }],
      });
      expect(outcomes.getScenarioScores).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        expect.any(Date),
        expect.any(Date),
        3,
        8,
      );
    });

    it('TSQ-026 returns rating counts and no comments', async () => {
      ready();
      const ratings = { stars: [11, 5, 55, 36, 135], count: 242, average: 4.2 };
      outcomes.getRatingCounts.mockResolvedValue(ratings);
      const out = await service.getChartData(TENANT, 'TSQ-026', {});
      expect(out.data).toEqual(ratings);
    });

    it('TSQ-027 returns how many completed sessions were shared for review', async () => {
      ready();
      outcomes.getReviewCoverage.mockResolvedValue({
        completedSessions: 371,
        reviewedSessions: 12,
      });
      const out = await service.getChartData(TENANT, 'TSQ-027', {});
      expect(out.data).toEqual({
        completedSessions: 371,
        reviewedSessions: 12,
      });
    });

    it('an organisation range of all time starts at the epoch', async () => {
      ready();
      outcomes.getRatingCounts.mockResolvedValue({
        stars: [0, 0, 0, 0, 0],
        count: 0,
        average: null,
      });
      await service.getChartData(TENANT, 'TSQ-026', { range: 'all' });
      const start = outcomes.getRatingCounts.mock.calls[0][2] as Date;
      expect(start.getTime()).toBe(0);
    });

    it('refuses a chart the organisation cannot fill yet, as before', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ reviews: 0 }));
      await expect(
        service.getChartData(TENANT, 'TSQ-027', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(outcomes.getReviewCoverage).not.toHaveBeenCalled();
    });
  });

  describe('getCapabilities', () => {
    it('404s an unknown tenant', async () => {
      repo.getTenantKeys.mockResolvedValue(null);
      await expect(service.getCapabilities(TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
