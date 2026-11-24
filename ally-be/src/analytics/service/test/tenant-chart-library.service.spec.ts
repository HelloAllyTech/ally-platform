import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantCapabilitiesRepository } from '../../repository/tenant-capabilities.repository';
import { TENANT_CHART_LIBRARY } from '../../constants/tenant-chart-library.constants';
import { TenantScopeSummaryRepository } from '../../repository/tenant-scope-summary.repository';
import { TenantScopeOptionsRepository } from '../../repository/tenant-scope-options.repository';
import { TenantChartQueryRepository } from '../../repository/tenant-chart-query.repository';
import { TenantBehaviourRepository } from '../../repository/tenant-behaviour.repository';
import { FoundationalSkillsTransferRepository } from '../../repository/foundational-skills-transfer.repository';
import { TenantOutcomesRepository } from '../../repository/tenant-outcomes.repository';
import { TenantPracticeRepository } from '../../repository/tenant-practice.repository';
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
  let practice: jest.Mocked<TenantPracticeRepository>;
  let chartQuery: jest.Mocked<TenantChartQueryRepository>;
  let scopeOptions: jest.Mocked<TenantScopeOptionsRepository>;
  let summary: jest.Mocked<TenantScopeSummaryRepository>;
  let behaviour: jest.Mocked<TenantBehaviourRepository>;
  let transfer: jest.Mocked<FoundationalSkillsTransferRepository>;
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
      getLearnerTrendCounts: jest.fn(),
      getReviewCoverage: jest.fn(),
    } as unknown as jest.Mocked<TenantOutcomesRepository>;
    practice = {
      getPracticeHeatmap: jest.fn(),
      getSessionLengths: jest.fn(),
      getActivationCounts: jest.fn(),
      getRegularityCounts: jest.fn(),
      getQuizPassRates: jest.fn(),
      getItemFormatDropoff: jest.fn(),
      getSkillChange: jest.fn(),
    } as unknown as jest.Mocked<TenantPracticeRepository>;
    chartQuery = {
      ranked: jest.fn(),
      distribution: jest.fn(),
      stars: jest.fn(),
    } as unknown as jest.Mocked<TenantChartQueryRepository>;
    scopeOptions = {
      list: jest.fn(),
      describe: jest.fn(),
    } as unknown as jest.Mocked<TenantScopeOptionsRepository>;
    summary = {
      getCourseFacts: jest.fn(),
      getTimeToFinish: jest.fn(),
      getPracticeRhythm: jest.fn(),
      getLearnerCourses: jest.fn(),
      getCourseParticipation: jest.fn(),
      getCoursePerformance: jest.fn(),
      getModuleFunnel: jest.fn(),
      getModuleTime: jest.fn(),
      getRoleplayAttempts: jest.fn(),
      getSkillTrend: jest.fn(),
    } as unknown as jest.Mocked<TenantScopeSummaryRepository>;
    behaviour = {
      getHelpfulBehaviours: jest.fn(),
      getUnhelpfulTrend: jest.fn(),
      getScoreByAttempt: jest.fn(),
    } as unknown as jest.Mocked<TenantBehaviourRepository>;
    transfer = {
      getCutScenarios: jest.fn(),
    } as unknown as jest.Mocked<FoundationalSkillsTransferRepository>;
    service = new TenantChartLibraryService(
      repo,
      analytics,
      outcomes,
      practice,
      chartQuery,
      scopeOptions,
      summary,
      behaviour,
      transfer,
    );
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
        'TSQ-005',
        'TSQ-006',
        'TSQ-007',
        'TSQ-008',
        'TSQ-009',
        'TSQ-011',
        'TSQ-012',
        'TSQ-013',
        'TSQ-014',
        'TSQ-015',
        'TSQ-016',
        'TSQ-017',
        'TSQ-018',
        'TSQ-019',
        'TSQ-020',
        'TSQ-021',
        'TSQ-022',
        'TSQ-023',
        'TSQ-024',
        'TSQ-026',
        'TSQ-027',
        'TSQ-038',
        'TSQ-039',
        'TSQ-041',
        'TSQ-042',
        'TSQ-043',
        'TSQ-045',
        'TSQ-046',
        'TSQ-049',
        'TSQ-050',
        'TSQ-051',
        'TSQ-053',
        'TSQ-055',
        'TSQ-063',
        'TSQ-064',
        'TSQ-065',
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
      // TSQ-036 (skills by course) is planned: the id exists, nothing is offered.
      await expect(
        service.getChartData(TENANT, 'TSQ-036', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      // TSQ-029 (seats) is blocked on a seat model.
      await expect(
        service.getChartData(TENANT, 'TSQ-029', {}),
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
      chartQuery.distribution.mockResolvedValue(dist);
      const out = await service.getChartData(TENANT, 'TSQ-020', {});
      expect(out.data).toEqual(dist);
      expect(chartQuery.distribution).toHaveBeenCalledWith(
        { source: 'sessions', result: 'distribution' },
        expect.objectContaining({ tenantId: TENANT, tenantCode: 'internal1' }),
      );
    });

    it('TSQ-020 can be drawn for one course or simulation', async () => {
      ready();
      chartQuery.distribution.mockResolvedValue({
        bins: Array(10).fill(0),
        sessions: 0,
        median: null,
      });
      scopeOptions.describe.mockResolvedValue('Course A');
      const courseId = '8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11';
      const out = await service.getChartData(TENANT, 'TSQ-020', {
        courseId,
        scenarioId: 7,
      });
      // The name comes back with the chart, for the card header.
      expect(out.scope).toEqual({
        kind: 'course',
        id: courseId,
        label: 'Course A',
      });
      // Every filter that was set comes back with its name, for the card's filter row.
      expect(out.filters?.map((f) => f.kind)).toEqual(['course', 'simulation']);
      expect(chartQuery.distribution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scope: { courseId, scenarioId: 7 },
        }),
      );
    });

    it('refuses a scope for a chart that would ignore it', async () => {
      ready();
      // TSQ-024 lists the course scope in the registry but has no spec yet.
      await expect(
        service.getChartData(TENANT, 'TSQ-024', { courseId: 'x' }),
      ).rejects.toThrow('cannot be drawn for one course');
    });

    it('refuses a course, simulation or learner from another organisation', async () => {
      ready();
      scopeOptions.describe.mockResolvedValue(null);
      await expect(
        service.getChartData(TENANT, 'TSQ-020', { scenarioId: 99 }),
      ).rejects.toThrow('Unknown simulation');
      expect(chartQuery.distribution).not.toHaveBeenCalled();
    });

    it('offers a scope in the library only where the chart supports it', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      const by = Object.fromEntries(lib.charts.map((c) => [c.id, c.scopes]));
      expect(by['TSQ-020']).toEqual(['organisation', 'course', 'simulation']);
      expect(by['TSQ-024']).toEqual(['organisation', 'learner']);
      expect(by['TSQ-009']).toEqual(['organisation']);
    });

    it('sends the views with the library, as plain copies', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      expect(lib.views?.map((v) => v.id)).toEqual([
        'organisation',
        'course',
        'learner',
      ]);
      const course = lib.views?.find((v) => v.id === 'course');
      expect(course?.subject).toBe('course');
      expect(
        course?.sections.find((s) => s.key === 'allCourses')?.subject,
      ).toBe(false);
      // Changing a response must not change the shared configuration.
      course?.defaultLayout.push('TSQ-999');
      const again = await service.getLibrary(TENANT);
      expect(
        again.views?.find((v) => v.id === 'course')?.defaultLayout,
      ).not.toContain('TSQ-999');
    });

    it('sends the cards pinned to For you until a person pins their own', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      expect(lib.defaultPins).toEqual(['TSQ-001', 'TSQ-007']);
    });

    it('sends no views while the page is off for the tenant', async () => {
      repo.getTenantKeys.mockResolvedValue({
        code: 'internal1',
        statisticsDashboardEnabled: false,
      });
      expect(await service.getLibrary(TENANT)).toEqual({
        enabled: false,
        charts: [],
      });
    });

    it('says which tab each chart belongs on', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      const home = Object.fromEntries(lib.charts.map((c) => [c.id, c.home]));
      expect(home['TSQ-001']).toBe('organisation');
      expect(home['TSQ-008']).toBe('learner');
      expect(home['TSQ-045']).toBe('course');
    });

    it('describes each card filter, required only where there is no all-organisation view', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      const filters = Object.fromEntries(
        lib.charts.map((c) => [c.id, c.filters]),
      );
      expect(filters['TSQ-009']).toEqual([]);
      expect(filters['TSQ-020']).toEqual([
        { key: 'course', required: false },
        { key: 'simulation', required: false },
      ]);
      expect(filters['TSQ-045']).toEqual([{ key: 'course', required: true }]);
    });

    it('never declares a filter the chart does not honour', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps());
      const lib = await service.getLibrary(TENANT);
      lib.charts.forEach((c) => {
        const entry = TENANT_CHART_LIBRARY.find((e) => e.id === c.id);
        expect(c.scopes).toEqual(entry?.scopes);
      });
    });

    it('refuses a scope the chart does not list', async () => {
      ready();
      // TSQ-022 lists organisation and course, not learner.
      await expect(
        service.getChartData(TENANT, 'TSQ-022', { learnerId: 9 }),
      ).rejects.toThrow('cannot be drawn for one learner');
      expect(chartQuery.ranked).not.toHaveBeenCalled();
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

    it('TSQ-022 asks for the lowest average first, with a minimum of sessions', async () => {
      ready();
      chartQuery.ranked.mockResolvedValue([
        { key: '1', label: 'A', value: 54, sessions: 5 },
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-022', {});
      expect(out.data).toEqual({
        rows: [{ scenarioId: 1, title: 'A', averageScore: 54, sessions: 5 }],
      });
      expect(chartQuery.ranked).toHaveBeenCalledWith(
        expect.objectContaining({
          measure: 'averageScore',
          dimension: 'scenario',
          order: 'asc',
          minSessions: 3,
          limit: 8,
        }),
        expect.anything(),
      );
    });

    it('TSQ-026 returns rating counts and no comments', async () => {
      ready();
      const ratings = { stars: [11, 5, 55, 36, 135], count: 242, average: 4.2 };
      chartQuery.stars.mockResolvedValue(ratings);
      const out = await service.getChartData(TENANT, 'TSQ-026', {});
      expect(out.data).toEqual(ratings);
    });

    it('TSQ-026 can be drawn for one simulation', async () => {
      ready();
      scopeOptions.describe.mockResolvedValue('Sim A');
      chartQuery.stars.mockResolvedValue({
        stars: [0, 0, 0, 0, 1],
        count: 1,
        average: 5,
      });
      const out = await service.getChartData(TENANT, 'TSQ-026', {
        scenarioId: 4,
      });
      expect(out.scope).toEqual({
        kind: 'simulation',
        id: '4',
        label: 'Sim A',
      });
      expect(chartQuery.stars).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({ scenarioId: 4 }),
        }),
      );
    });

    it('TSQ-003 lists simulations by completed sessions, in the page shape', async () => {
      ready();
      chartQuery.ranked.mockResolvedValue([
        { key: '8', label: 'Confidentiality', value: 16, sessions: 16 },
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-003', {});
      expect(out.data).toEqual([
        { scenarioId: 8, title: 'Confidentiality', sessionCount: 16 },
      ]);
      expect(chartQuery.ranked).toHaveBeenCalledWith(
        expect.objectContaining({
          measure: 'sessions',
          basis: 'completed',
          order: 'desc',
          limit: 5,
        }),
        expect.anything(),
      );
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
      chartQuery.stars.mockResolvedValue({
        stars: [0, 0, 0, 0, 0],
        count: 0,
        average: null,
      });
      await service.getChartData(TENANT, 'TSQ-026', { range: 'all' });
      const window = chartQuery.stars.mock.calls[0][0];
      expect(window.start.getTime()).toBe(0);
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

  describe('practice and course-progress charts', () => {
    const ready = () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(
        caps({
          sessions90: 400,
          weeksWithActivity90: 12,
          courseEnrolments: 30,
          scoredQuizItems: 50,
          skillScoredCuts: 40,
          skillScoredLearners: 14,
        }),
      );
    };

    it('TSQ-005 groups sessions by weekday and time of day in the caller time zone', async () => {
      ready();
      const cells = Array.from({ length: 7 }, () => Array(8).fill(0));
      practice.getPracticeHeatmap.mockResolvedValue({ cells, sessions: 0 });
      const out = await service.getChartData(TENANT, 'TSQ-005', {
        timezone: 'Asia/Kolkata',
      });
      expect(out.data).toEqual({
        cells,
        sessions: 0,
        timezone: 'Asia/Kolkata',
      });
      expect(practice.getPracticeHeatmap).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        expect.any(Date),
        expect.any(Date),
        'Asia/Kolkata',
      );
    });

    it('TSQ-005 uses UTC when no time zone is given', async () => {
      ready();
      practice.getPracticeHeatmap.mockResolvedValue({ cells: [], sessions: 0 });
      const out = await service.getChartData(TENANT, 'TSQ-005', {});
      expect((out.data as { timezone: string }).timezone).toBe('UTC');
    });

    it('TSQ-005 falls back to UTC, and says so, when the time zone is not recognised', async () => {
      ready();
      practice.getPracticeHeatmap
        .mockRejectedValueOnce(
          new Error('time zone "Nope/Zone" not recognized'),
        )
        .mockResolvedValueOnce({ cells: [], sessions: 0 });
      const out = await service.getChartData(TENANT, 'TSQ-005', {
        timezone: 'Nope/Zone',
      });
      expect((out.data as { timezone: string }).timezone).toBe('UTC');
      expect(practice.getPracticeHeatmap).toHaveBeenCalledTimes(2);
    });

    it('TSQ-005 does not hide a real failure when UTC itself fails', async () => {
      ready();
      practice.getPracticeHeatmap.mockRejectedValue(new Error('db down'));
      await expect(service.getChartData(TENANT, 'TSQ-005', {})).rejects.toThrow(
        'db down',
      );
    });

    it('TSQ-006 returns the length bands with their bounds', async () => {
      ready();
      practice.getSessionLengths.mockResolvedValue({
        bins: [5, 4, 3, 2, 1, 1, 0],
        sessions: 16,
        medianMinutes: 4,
      });
      const out = await service.getChartData(TENANT, 'TSQ-006', {});
      expect(out.data).toEqual({
        bins: [5, 4, 3, 2, 1, 1, 0],
        sessions: 16,
        medianMinutes: 4,
        boundsMinutes: [2, 5, 10, 15, 20, 30],
      });
    });

    it('TSQ-011 returns the four activation stages in order', async () => {
      ready();
      practice.getActivationCounts.mockResolvedValue({
        registered: 29,
        started: 16,
        practisedThreeTimes: 15,
        activeRecently: 4,
      });
      const out = await service.getChartData(TENANT, 'TSQ-011', {});
      expect(out.data).toEqual({
        stages: [
          { key: 'registered', count: 29 },
          { key: 'started', count: 16 },
          { key: 'practisedThreeTimes', count: 15 },
          { key: 'activeRecently', count: 4 },
        ],
      });
    });

    it('TSQ-012 adds the total to the regularity counts', async () => {
      ready();
      practice.getRegularityCounts.mockResolvedValue({
        regular: 0,
        occasional: 9,
        bursty: 5,
        weeks: 13,
      });
      const out = await service.getChartData(TENANT, 'TSQ-012', {});
      expect(out.data).toEqual({
        regular: 0,
        occasional: 9,
        bursty: 5,
        weeks: 13,
        total: 14,
      });
    });

    it('TSQ-018 adds the share finished for each kind of item', async () => {
      ready();
      practice.getItemFormatDropoff.mockResolvedValue([
        { type: 'ROLEPLAY', reached: 115, completed: 106 },
        { type: 'GAME', reached: 0, completed: 0 },
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-018', {});
      expect(out.data).toEqual({
        rows: [
          {
            type: 'ROLEPLAY',
            reached: 115,
            completed: 106,
            completedPercent: 92,
          },
          { type: 'GAME', reached: 0, completed: 0, completedPercent: 0 },
        ],
      });
    });

    it('TSQ-019 asks for quizzes with at least three attempts, lowest pass rate first', async () => {
      ready();
      practice.getQuizPassRates.mockResolvedValue([
        { title: 'Quiz A', attempts: 13, passRatePercent: 31 },
      ]);
      const out = await service.getChartData(TENANT, 'TSQ-019', {});
      expect(out.data).toEqual({
        rows: [{ title: 'Quiz A', attempts: 13, passRatePercent: 31 }],
      });
      expect(practice.getQuizPassRates).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        expect.any(Date),
        expect.any(Date),
        3,
        8,
        expect.any(Object),
      );
    });

    it('TSQ-024 returns each skill first against latest', async () => {
      ready();
      const rows = [{ skill: 'verbal', first: 3, latest: 3.9, learners: 14 }];
      practice.getSkillChange.mockResolvedValue(rows);
      const out = await service.getChartData(TENANT, 'TSQ-024', {});
      expect(out.data).toEqual({ rows });
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

  describe('course and learner charts', () => {
    const COURSE = '8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11';
    const ready = () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(
        caps({ courseEnrolments: 20, courseCompletions: 12 }),
      );
    };

    it('a course chart asked for without a course is refused', async () => {
      ready();
      await expect(service.getChartData(TENANT, 'TSQ-045', {})).rejects.toThrow(
        'Choose a course',
      );
      expect(summary.getModuleFunnel).not.toHaveBeenCalled();
    });

    it('the all-courses and organisation-wide cards need no filter', async () => {
      ready();
      repo.getCapabilities.mockResolvedValue(
        caps({
          courseCompletions: 20,
          courseEnrolments: 20,
          scoredSessions90: 20,
          skillScoredCuts: 50,
        }),
      );
      summary.getTimeToFinish.mockResolvedValue({
        bins: [],
        boundsDays: [],
        completed: 0,
        medianDays: null,
      });
      summary.getRoleplayAttempts.mockResolvedValue({ rows: [] });
      summary.getPracticeRhythm.mockResolvedValue({ measures: [] });
      summary.getSkillTrend.mockResolvedValue({ skills: [] });
      await service.getChartData(TENANT, 'TSQ-043', {});
      await service.getChartData(TENANT, 'TSQ-053', {});
      await service.getChartData(TENANT, 'TSQ-063', {});
      await service.getChartData(TENANT, 'TSQ-065', {});
      expect(summary.getTimeToFinish).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        undefined,
      );
      expect(summary.getRoleplayAttempts).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        undefined,
      );
      expect(summary.getPracticeRhythm.mock.calls[0][2]).toBeUndefined();
      expect(summary.getSkillTrend).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        undefined,
      );
    });

    it('TSQ-043 reads one course', async () => {
      ready();
      scopeOptions.describe.mockResolvedValue('Course A');
      summary.getTimeToFinish.mockResolvedValue({
        bins: [0, 1, 2, 0, 0, 0],
        boundsDays: [1, 3, 7, 14, 30],
        completed: 3,
        medianDays: 4,
      });
      const out = await service.getChartData(TENANT, 'TSQ-043', {
        courseId: COURSE,
      });
      expect((out.data as { completed: number }).completed).toBe(3);
    });

    it('TSQ-063 uses the window for one learner', async () => {
      enabled();
      scopeOptions.describe.mockResolvedValue('Asha');
      summary.getPracticeRhythm.mockResolvedValue({ measures: [] });
      await service.getChartData(TENANT, 'TSQ-063', {
        learnerId: 4,
        range: 'all',
      });
      const call = summary.getPracticeRhythm.mock.calls[0];
      expect(call[2]).toBe(4);
      expect((call[3] as Date).getTime()).toBe(0);
    });

    it('TSQ-038 counts courses by status', async () => {
      ready();
      analytics.getCourseUsage.mockResolvedValue({
        count: 3,
        data: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'DRAFT' }],
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-038', {});
      const values = Object.fromEntries(
        (
          out.data as { measures: { key: string; value: number }[] }
        ).measures.map((m) => [m.key, m.value]),
      );
      expect(values).toEqual({ courses: 3, live: 2, draft: 1, archived: 0 });
    });

    it('TSQ-042 reads every course, or one when a course is chosen', async () => {
      ready();
      scopeOptions.describe.mockResolvedValue('Course A');
      summary.getCoursePerformance.mockResolvedValue({
        weeks: [],
        enrolled: 0,
        completed: 0,
      });
      await service.getChartData(TENANT, 'TSQ-042', {});
      expect(summary.getCoursePerformance).toHaveBeenLastCalledWith(
        TENANT,
        'internal1',
        undefined,
      );
      await service.getChartData(TENANT, 'TSQ-042', { courseId: COURSE });
      expect(summary.getCoursePerformance).toHaveBeenLastCalledWith(
        TENANT,
        'internal1',
        COURSE,
      );
    });

    it('module and roleplay charts need a course', async () => {
      ready();
      repo.getCapabilities.mockResolvedValue(
        caps({ courseEnrolments: 20, scoredSessions90: 20 }),
      );
      for (const id of ['TSQ-045', 'TSQ-046']) {
        await expect(service.getChartData(TENANT, id, {})).rejects.toThrow(
          'Choose a course',
        );
      }
      expect(summary.getModuleFunnel).not.toHaveBeenCalled();
    });

    it('module charts read the chosen course', async () => {
      ready();
      repo.getCapabilities.mockResolvedValue(
        caps({ courseEnrolments: 20, scoredSessions90: 20 }),
      );
      scopeOptions.describe.mockResolvedValue('Course A');
      summary.getModuleFunnel.mockResolvedValue({ rows: [] });
      summary.getModuleTime.mockResolvedValue({ rows: [] });
      summary.getRoleplayAttempts.mockResolvedValue({ rows: [] });
      for (const id of ['TSQ-045', 'TSQ-046', 'TSQ-053']) {
        await service.getChartData(TENANT, id, { courseId: COURSE });
      }
      expect(summary.getModuleFunnel).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        COURSE,
      );
      expect(summary.getRoleplayAttempts).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        COURSE,
      );
    });

    it('TSQ-065 reads one learner when one is chosen', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ skillScoredCuts: 50 }));
      scopeOptions.describe.mockResolvedValue('Asha');
      summary.getSkillTrend.mockResolvedValue({ skills: [] });
      await service.getChartData(TENANT, 'TSQ-065', { learnerId: 4 });
      expect(summary.getSkillTrend).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        4,
      );
    });

    it('behaviour charts read the course or learner they are asked for', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ skillScoredCuts: 50 }));
      scopeOptions.describe.mockResolvedValue('Course A');
      behaviour.getHelpfulBehaviours.mockResolvedValue({
        learners: 0,
        rows: [],
      });
      behaviour.getUnhelpfulTrend.mockResolvedValue({ points: [] });
      await service.getChartData(TENANT, 'TSQ-050', { courseId: COURSE });
      await service.getChartData(TENANT, 'TSQ-051', { learnerId: 4 });
      expect(behaviour.getHelpfulBehaviours).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        { courseId: COURSE },
      );
      expect(behaviour.getUnhelpfulTrend).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        { courseId: undefined, learnerId: 4 },
      );
    });

    it('TSQ-055 reads the organisation, and TSQ-049 says nothing under its floor', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(
        caps({
          skillScoredCuts: 50,
          scoredSessions90: 50,
          learnersWithRepeatScoredSessions: 9,
        }),
      );
      behaviour.getScoreByAttempt.mockResolvedValue({ steps: [] });
      transfer.getCutScenarios.mockResolvedValue([]);
      await service.getChartData(TENANT, 'TSQ-055', {});
      const res = await service.getChartData(TENANT, 'TSQ-049', {});
      expect(behaviour.getScoreByAttempt).toHaveBeenCalledWith(
        TENANT,
        'internal1',
      );
      expect(transfer.getCutScenarios).toHaveBeenCalledWith(
        expect.any(String),
        TENANT,
      );
      expect(res.data).toMatchObject({
        learners: 0,
        familiar: null,
        unfamiliar: null,
      });
    });

    it('quiz pass rates narrow to one course', async () => {
      ready();
      repo.getCapabilities.mockResolvedValue(caps({ scoredQuizItems: 30 }));
      scopeOptions.describe.mockResolvedValue('Course A');
      practice.getQuizPassRates.mockResolvedValue([]);
      await service.getChartData(TENANT, 'TSQ-019', { courseId: COURSE });
      expect(practice.getQuizPassRates).toHaveBeenCalledWith(
        TENANT,
        'internal1',
        expect.any(Date),
        expect.any(Date),
        expect.any(Number),
        expect.any(Number),
        expect.objectContaining({ courseId: COURSE }),
      );
    });

    it('the skills chart no longer claims a course scope it cannot honour', async () => {
      enabled();
      repo.getCapabilities.mockResolvedValue(caps({ skillScoredCuts: 50 }));
      const lib = await service.getLibrary(TENANT);
      const skills = lib.charts.find((c) => c.id === 'TSQ-024');
      expect(skills?.scopes).toEqual(['organisation', 'learner']);
    });
  });

  describe('getScopeOptions', () => {
    it("describes one option by id, and answers empty for one that is not the organisation's", async () => {
      enabled();
      scopeOptions.describe.mockResolvedValueOnce('Asha');
      expect(
        await service.getScopeOptions(TENANT, 'learner', undefined, 50, '4'),
      ).toEqual([{ id: '4', label: 'Asha' }]);
      expect(scopeOptions.describe).toHaveBeenCalledWith(
        'learner',
        4,
        TENANT,
        'internal1',
      );
      scopeOptions.describe.mockResolvedValueOnce(null);
      expect(
        await service.getScopeOptions(TENANT, 'learner', undefined, 50, '99'),
      ).toEqual([]);
      expect(
        await service.getScopeOptions(TENANT, 'learner', undefined, 50, 'abc'),
      ).toEqual([]);
      expect(scopeOptions.list).not.toHaveBeenCalled();
    });

    it('refuses when the page is off for the tenant', async () => {
      repo.getTenantKeys.mockResolvedValue({
        code: 'internal1',
        statisticsDashboardEnabled: false,
      });
      await expect(
        service.getScopeOptions(TENANT, 'course', undefined),
      ).rejects.toThrow('not enabled');
      expect(scopeOptions.list).not.toHaveBeenCalled();
    });

    it('lists for the caller tenant with both id spellings', async () => {
      enabled();
      scopeOptions.list.mockResolvedValue([{ id: '1', label: 'Course A' }]);
      const out = await service.getScopeOptions(TENANT, 'course', 'cou', 20);
      expect(out).toEqual([{ id: '1', label: 'Course A' }]);
      expect(scopeOptions.list).toHaveBeenCalledWith(
        'course',
        TENANT,
        'internal1',
        'cou',
        20,
      );
    });
  });
});
