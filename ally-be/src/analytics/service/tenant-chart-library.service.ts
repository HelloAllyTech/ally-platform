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

  private findLiveEntry(chartId: string, tenantId: string): TenantChartEntry {
    const entry = TENANT_CHART_LIBRARY.find((c) => c.id === chartId);
    if (!entry || !entry.live || !isChartVisibleToTenant(entry, tenantId)) {
      throw new NotFoundException('Unknown chart');
    }
    return entry;
  }
}
