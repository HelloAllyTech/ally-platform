import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantCapabilitiesRepository } from '../../repository/tenant-capabilities.repository';
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
  let service: TenantChartLibraryService;

  beforeEach(() => {
    repo = {
      getTenantKeys: jest.fn(),
      getCapabilities: jest.fn(),
    } as unknown as jest.Mocked<TenantCapabilitiesRepository>;
    analytics = {
      getOrganizationMetrics: jest.fn(),
      getLearnerUsage: jest.fn(),
      getCourseUsage: jest.fn(),
    } as unknown as jest.Mocked<TenantAnalyticsService>;
    service = new TenantChartLibraryService(repo, analytics);
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
        'TSQ-023',
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
      // TSQ-010 (days since last activity) is reserved but has no handler yet.
      await expect(
        service.getChartData(TENANT, 'TSQ-010', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the headline numbers from organization-metrics, defaulting to 90 days', async () => {
      enabled();
      const summary = { simulationsCompleted: 12 };
      analytics.getOrganizationMetrics.mockResolvedValue({
        summary,
      } as never);
      const out = await service.getChartData(TENANT, 'TSQ-001', {});
      expect(analytics.getOrganizationMetrics).toHaveBeenCalledWith(
        TENANT,
        '90d',
      );
      expect(out).toEqual({ id: 'TSQ-001', state: 'available', data: summary });
      // A chart that needs nothing does not pay for the capabilities query.
      expect(repo.getCapabilities).not.toHaveBeenCalled();
    });

    it('honours an explicit range', async () => {
      enabled();
      analytics.getOrganizationMetrics.mockResolvedValue({
        summary: {},
      } as never);
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

  describe('getCapabilities', () => {
    it('404s an unknown tenant', async () => {
      repo.getTenantKeys.mockResolvedValue(null);
      await expect(service.getCapabilities(TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
