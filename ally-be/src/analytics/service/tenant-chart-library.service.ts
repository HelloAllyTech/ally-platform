import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';
import {
  TENANT_CHART_LIBRARY,
  TenantChartEntry,
} from '../constants/tenant-chart-library.constants';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { LearnerUsageStatus } from '../dto/tenant-analytics.dto';
import {
  TenantChartDataResponseDto,
  TenantChartLibraryResponseDto,
} from '../dto/tenant-chart-library.dto';
import { TenantCapabilitiesRepository } from '../repository/tenant-capabilities.repository';
import {
  ChartAvailability,
  TenantCapabilities,
  isChartVisibleToTenant,
  resolveChartAvailability,
} from '../util/tenant-chart-library.util';
import { TenantAnalyticsService } from './tenant-analytics.service';

/** Controls a chart handler may read. Absent = the chart's own default. */
export interface TenantChartParams {
  range?: AnalyticsRange;
  search?: string;
  limit?: number;
  offset?: number;
}

type ChartHandler = (
  tenantId: string,
  params: TenantChartParams,
) => Promise<unknown>;

const DEFAULT_CHART_RANGE: AnalyticsRange = '90d';
/** The learner-usage page limit: the most learners a status count reads. */
const STATUS_COUNT_LEARNER_CAP = 200;
const TOP_LEARNERS_LIMIT = 6;
const ATTENTION_LEARNERS_LIMIT = 5;

export interface LearnerStatusCountsData {
  total: number;
  /** True when the organisation has more learners than were counted. */
  truncated: boolean;
  counts: Record<LearnerUsageStatus, number>;
}

export interface TopLearnersData {
  rows: Array<{ id: number; name: string; practiceMinutes: number }>;
}

export interface AttentionLearnersData {
  /** All learners who qualify, of which `rows` shows the longest quiet. */
  total: number;
  rows: Array<{
    id: number;
    name: string;
    status: LearnerUsageStatus;
    daysSinceLastActivity: number | null;
  }>;
}

@Injectable()
export class TenantChartLibraryService {
  private readonly logger = LoggerService.getInstance(
    TenantChartLibraryService.name,
  );

  /**
   * One handler per live chart id. Charts backed by an existing tenant
   * endpoint reuse its service method; new charts add a handler here and flip
   * `live` in the registry.
   */
  private readonly handlers: Record<string, ChartHandler>;

  constructor(
    private readonly capabilitiesRepo: TenantCapabilitiesRepository,
    private readonly tenantAnalytics: TenantAnalyticsService,
  ) {
    this.handlers = {
      // Headline numbers: the summary block of organization-metrics.
      'TSQ-001': async (tenantId, p) =>
        (
          await this.tenantAnalytics.getOrganizationMetrics(
            tenantId,
            p.range ?? DEFAULT_CHART_RANGE,
          )
        ).summary,
      // Usage over time: the per-bucket active-learner trend.
      'TSQ-002': async (tenantId, p) => {
        const m = await this.tenantAnalytics.getOrganizationMetrics(
          tenantId,
          p.range ?? DEFAULT_CHART_RANGE,
        );
        return {
          bucket: m.bucket,
          activeUsers: m.activeUsersTrend,
          simulationsCompleted: m.simulationsCompletedTrend,
          newLearners: m.newLearnersOnboardedTrend,
        };
      },
      // Learner status: how many learners are active, at risk, dormant or
      // never started, from the same status the learner table uses.
      'TSQ-007': (tenantId, p) => this.learnerStatusCounts(tenantId, p),
      // Top learners by practice minutes in the period.
      'TSQ-008': (tenantId, p) => this.topLearners(tenantId, p),
      // Learners who practised before and then went quiet, most overdue first.
      'TSQ-023': (tenantId, p) => this.learnersNeedingAttention(tenantId, p),
      // Most-used simulations.
      'TSQ-003': async (tenantId, p) =>
        (
          await this.tenantAnalytics.getOrganizationMetrics(
            tenantId,
            p.range ?? DEFAULT_CHART_RANGE,
          )
        ).mostUsedSimulations,
      // Learner table.
      'TSQ-009': (tenantId, p) =>
        this.tenantAnalytics.getLearnerUsage(tenantId, {
          range: p.range ?? DEFAULT_CHART_RANGE,
          search: p.search,
          limit: p.limit,
          offset: p.offset,
        }),
      // Course table (all-time, no range).
      'TSQ-013': (tenantId, p) =>
        this.tenantAnalytics.getCourseUsage(tenantId, {
          search: p.search,
          limit: p.limit,
          offset: p.offset,
        }),
    };
  }

  /** Whether the new Statistics page is switched on for the tenant. */
  async isEnabled(tenantId: string): Promise<boolean> {
    const keys = await this.capabilitiesRepo.getTenantKeys(tenantId);
    return keys?.statisticsDashboardEnabled === true;
  }

  /**
   * The charts this tenant may add, each with whether it can fill them.
   * When the page is off for the tenant: `enabled: false` and no charts, so
   * the client keeps the existing page.
   */
  async getLibrary(tenantId: string): Promise<TenantChartLibraryResponseDto> {
    const keys = await this.capabilitiesRepo.getTenantKeys(tenantId);
    if (!keys?.statisticsDashboardEnabled) {
      return { enabled: false, charts: [] };
    }
    const capabilities = await withReportingQuerySlot(() =>
      this.capabilitiesRepo.getCapabilities(tenantId, keys.code),
    );
    const charts = TENANT_CHART_LIBRARY.filter(
      (entry) => entry.live && isChartVisibleToTenant(entry, tenantId),
    ).map((entry) => {
      const availability = resolveChartAvailability(entry, capabilities);
      return {
        id: entry.id,
        title: entry.title,
        question: entry.question,
        group: entry.group,
        shape: entry.shape,
        chart: entry.chart,
        size: entry.size,
        state: availability.state,
        reason: availability.reason,
      };
    });
    return { enabled: true, charts };
  }

  async getCapabilities(tenantId: string): Promise<TenantCapabilities> {
    const keys = await this.capabilitiesRepo.getTenantKeys(tenantId);
    if (!keys) throw new NotFoundException('Tenant not found');
    return withReportingQuerySlot(() =>
      this.capabilitiesRepo.getCapabilities(tenantId, keys.code),
    );
  }

  /**
   * Runs one chart's query for the caller's tenant. Refuses when the page is
   * off for the tenant, the id is unknown or not live, the chart is not visible
   * to the tenant, or the tenant cannot fill it.
   */
  async getChartData(
    tenantId: string,
    chartId: string,
    params: TenantChartParams,
  ): Promise<TenantChartDataResponseDto> {
    const keys = await this.capabilitiesRepo.getTenantKeys(tenantId);
    if (!keys?.statisticsDashboardEnabled) {
      throw new ForbiddenException('Statistics page is not enabled');
    }
    const entry = this.findLiveEntry(chartId, tenantId);
    const handler = this.handlers[entry.id];
    if (!handler) throw new NotFoundException('Unknown chart');

    let availability: ChartAvailability = { state: 'available', reason: null };
    if (entry.needs.length > 0) {
      const capabilities = await withReportingQuerySlot(() =>
        this.capabilitiesRepo.getCapabilities(tenantId, keys.code),
      );
      availability = resolveChartAvailability(entry, capabilities);
    }
    if (availability.state === 'unavailable') {
      throw new ForbiddenException(availability.reason ?? 'Chart unavailable');
    }

    const data = await handler(tenantId, params);
    return { id: entry.id, state: availability.state, data };
  }

  /**
   * Counts learners by status. Reads at most {@link STATUS_COUNT_LEARNER_CAP}
   * learners (the learner-usage page limit) and says so when there are more,
   * rather than silently undercounting.
   */
  private async learnerStatusCounts(
    tenantId: string,
    p: TenantChartParams,
  ): Promise<LearnerStatusCountsData> {
    const usage = await this.tenantAnalytics.getLearnerUsage(tenantId, {
      range: p.range ?? DEFAULT_CHART_RANGE,
      limit: STATUS_COUNT_LEARNER_CAP,
      offset: 0,
    });
    const counts: Record<LearnerUsageStatus, number> = {
      active: 0,
      at_risk: 0,
      dormant: 0,
      never_started: 0,
    };
    usage.data.forEach((row) => {
      counts[row.status] += 1;
    });
    return {
      total: usage.count,
      truncated: usage.count > usage.data.length,
      counts,
    };
  }

  private async topLearners(
    tenantId: string,
    p: TenantChartParams,
  ): Promise<TopLearnersData> {
    const usage = await this.tenantAnalytics.getLearnerUsage(tenantId, {
      range: p.range ?? DEFAULT_CHART_RANGE,
      sortBy: 'totalPracticeMinutes',
      order: 'DESC',
      limit: TOP_LEARNERS_LIMIT,
      offset: 0,
    });
    return {
      rows: usage.data
        .filter((row) => row.totalPracticeMinutes > 0)
        .map((row) => ({
          id: row.id,
          name: row.name,
          practiceMinutes: row.totalPracticeMinutes,
        })),
    };
  }

  /**
   * Learners with a status of at risk or dormant (they have practised, then
   * stopped), longest quiet first. `never_started` is a different problem and
   * is shown by the status chart.
   */
  private async learnersNeedingAttention(
    tenantId: string,
    p: TenantChartParams,
  ): Promise<AttentionLearnersData> {
    const usage = await this.tenantAnalytics.getLearnerUsage(tenantId, {
      range: p.range ?? DEFAULT_CHART_RANGE,
      status: ['at_risk', 'dormant'],
      sortBy: 'lastActivityAt',
      order: 'ASC',
      limit: ATTENTION_LEARNERS_LIMIT,
      offset: 0,
    });
    return {
      total: usage.count,
      rows: usage.data.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        daysSinceLastActivity: row.daysSinceLastActivity,
      })),
    };
  }

  private findLiveEntry(chartId: string, tenantId: string): TenantChartEntry {
    const entry = TENANT_CHART_LIBRARY.find((c) => c.id === chartId);
    if (!entry || !entry.live || !isChartVisibleToTenant(entry, tenantId)) {
      throw new NotFoundException('Unknown chart');
    }
    return entry;
  }
}
