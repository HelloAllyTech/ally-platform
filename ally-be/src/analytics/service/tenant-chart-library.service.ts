import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';
import {
  ChartScope,
  TENANT_CHART_LIBRARY,
  TenantChartEntry,
  filtersOf,
} from '../constants/tenant-chart-library.constants';
import { STATISTICS_VIEWS } from '../constants/tenant-statistics-views.constants';
import {
  SCOPE_AWARE_CHARTS,
  TENANT_CHART_SPECS,
} from '../constants/tenant-chart-specs.constants';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { LearnerUsageStatus } from '../dto/tenant-analytics.dto';
import {
  TenantChartDataResponseDto,
  TenantChartScopeDto,
  TenantChartLibraryResponseDto,
} from '../dto/tenant-chart-library.dto';
import { TenantCapabilitiesRepository } from '../repository/tenant-capabilities.repository';
import {
  RankedRow,
  TenantChartQueryRepository,
} from '../repository/tenant-chart-query.repository';
import {
  ScopeKind,
  ScopeOption,
  TenantScopeOptionsRepository,
} from '../repository/tenant-scope-options.repository';
import {
  MeasuresData,
  TenantScopeSummaryRepository,
} from '../repository/tenant-scope-summary.repository';
import { TenantOutcomesRepository } from '../repository/tenant-outcomes.repository';
import {
  SESSION_LENGTH_BOUNDS_MINUTES,
  TenantPracticeRepository,
} from '../repository/tenant-practice.repository';
import { resolveAnalyticsWindow } from '../util/analytics-window.util';
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
  /** IANA time zone for charts that group by time of day. */
  timezone?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Scope: draw the chart for one simulation, course or learner. */
  scenarioId?: number;
  courseId?: string;
  learnerId?: number;
}

type ChartHandler = (
  tenantId: string,
  params: TenantChartParams,
  /** The tenant's short code, the second spelling its varchar tenant columns may hold. */
  tenantCode: string,
) => Promise<unknown>;

const DEFAULT_CHART_RANGE: AnalyticsRange = '90d';
/** A learner's score must move this many points (of 100) to count as up or down. */
const TREND_THRESHOLD_POINTS = 5;
/** A quiz needs this many attempts before its pass rate is shown. */
const QUIZ_MIN_ATTEMPTS = 3;
const QUIZ_LIMIT = 8;
/** Used when the caller's time zone is missing or not recognised. */
const FALLBACK_TIMEZONE = 'UTC';
/** The learner-usage page limit: the most learners a status count reads. */
const STATUS_COUNT_LEARNER_CAP = 200;
const TOP_LEARNERS_LIMIT = 6;
const COURSE_READ_CAP = 200;
const COURSE_RANKING_LIMIT = 6;
const ATTENTION_LEARNERS_LIMIT = 5;

export interface LearnerStatusCountsData {
  total: number;
  /** True when the organisation has more learners than were counted. */
  truncated: boolean;
  counts: Record<LearnerUsageStatus, number>;
}

export interface PracticeHeatmapData {
  /** Seven rows, Monday first; eight columns of three hours, midnight first. */
  cells: number[][];
  sessions: number;
  /** The time zone the hours are in. */
  timezone: string;
}

export interface SessionLengthData {
  /** Counts per band; `boundsMinutes` are the upper limits of every band but the last. */
  bins: number[];
  boundsMinutes: number[];
  sessions: number;
  medianMinutes: number | null;
}

export interface ActivationData {
  stages: Array<{
    key: 'registered' | 'started' | 'practisedThreeTimes' | 'activeRecently';
    count: number;
  }>;
}

export interface RegularityData {
  regular: number;
  occasional: number;
  bursty: number;
  total: number;
  weeks: number;
}

export interface QuizPassData {
  rows: Array<{ title: string; attempts: number; passRatePercent: number }>;
}

export interface ItemFormatData {
  rows: Array<{
    type: string;
    reached: number;
    completed: number;
    completedPercent: number;
  }>;
}

export interface SkillChangeData {
  /** Weakest latest level first. */
  rows: Array<{
    skill: string;
    first: number;
    latest: number;
    learners: number;
  }>;
}

export interface ScoreDistributionData {
  /** Ten bins: 0-9, 10-19, ... 90-100. */
  bins: number[];
  sessions: number;
  median: number | null;
}

export interface LearnerTrendData {
  improving: number;
  holding: number;
  declining: number;
  /** Learners with at least two scored sessions in the period. */
  total: number;
  /** Points a score must move to count as up or down. */
  threshold: number;
}

export interface RatingsData {
  /** Index 0 is one star, index 4 is five stars. */
  stars: number[];
  count: number;
  average: number | null;
}

export interface ReviewCoverageData {
  completedSessions: number;
  reviewedSessions: number;
}

export interface CoursesInUseData {
  total: number;
  inUse: number;
  idle: number;
  truncated: boolean;
}

export interface CourseRankingData {
  truncated: boolean;
  rows: Array<{ id: string; title: string; count: number }>;
}

export interface CourseFunnelData {
  truncated: boolean;
  stages: Array<{ key: string; count: number }>;
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
    private readonly outcomesRepo: TenantOutcomesRepository,
    private readonly practiceRepo: TenantPracticeRepository,
    private readonly chartQueryRepo: TenantChartQueryRepository,
    private readonly scopeOptionsRepo: TenantScopeOptionsRepository,
    private readonly summaryRepo: TenantScopeSummaryRepository,
  ) {
    this.handlers = {
      // Headline numbers: the summary block of organization-metrics, plus the
      // previous period's counts so the tiles can show the change.
      'TSQ-001': async (tenantId, p) => {
        const range = p.range ?? DEFAULT_CHART_RANGE;
        const [metrics, previous] = await Promise.all([
          this.tenantAnalytics.getOrganizationMetrics(tenantId, range),
          this.tenantAnalytics.getPreviousPeriodCounts(tenantId, range),
        ]);
        return { ...metrics.summary, previous };
      },
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
      // Courses someone has started versus courses nobody has.
      'TSQ-014': (tenantId) => this.coursesInUse(tenantId),
      // Courses ranked by learners stalled in them.
      'TSQ-015': (tenantId) => this.coursesRankedBy(tenantId, 'stalled'),
      // Courses ranked by learners assigned but not yet started.
      'TSQ-016': (tenantId) => this.coursesRankedBy(tenantId, 'notStarted'),
      // How far enrolments get: assigned, started, halfway, completed.
      'TSQ-017': (tenantId) => this.courseFunnel(tenantId),
      // How session scores spread, in ten bins, with the median.
      'TSQ-020': (tenantId, p, code) =>
        this.runSpec('TSQ-020', tenantId, code, p),
      // Learners whose latest score is up, level or down on their first.
      'TSQ-021': (tenantId, p, code) => this.learnerTrends(tenantId, code, p),
      // Scenarios with enough scored sessions, lowest average first.
      'TSQ-022': async (tenantId, p, code) => {
        const rows = (await this.runSpec('TSQ-022', tenantId, code, p)) as {
          rows: RankedRow[];
        };
        return {
          rows: rows.rows.map((r) => ({
            scenarioId: Number(r.key),
            title: r.label,
            averageScore: r.value,
            sessions: r.sessions,
          })),
        };
      },
      // Session ratings: how many of each star, and the average. No comments.
      'TSQ-026': (tenantId, p, code) =>
        this.runSpec('TSQ-026', tenantId, code, p),
      // How many completed sessions have been shared for review.
      'TSQ-027': (tenantId, p, code) => this.reviewCoverage(tenantId, code, p),
      // When learners practise: sessions by weekday and time of day.
      'TSQ-005': (tenantId, p, code) => this.practiceHeatmap(tenantId, code, p),
      // How long completed sessions run, in bands, with the median.
      'TSQ-006': (tenantId, p, code) => this.sessionLengths(tenantId, code, p),
      // Registered, started, practised three times, active in the last 14 days.
      'TSQ-011': (tenantId, _p, code) => this.activation(tenantId, code),
      // Learners by how many of the period's weeks they practised in.
      'TSQ-012': (tenantId, p, code) => this.regularity(tenantId, code, p),
      // For each kind of course item, how many reached it and finished it.
      'TSQ-018': (tenantId, p, code) => this.itemFormats(tenantId, code, p),
      // Quizzes with a few attempts, lowest pass rate first.
      'TSQ-019': (tenantId, p, code) => this.quizPassRates(tenantId, code, p),
      // Average skill level, each learner's first slice against their latest.
      'TSQ-024': (tenantId, p, code) => this.skillChange(tenantId, code, p),
      // Facts about one course: who has taken it and how long it takes.
      'TSQ-041': (tenantId, p, code) =>
        this.summaryRepo.getCourseFacts(tenantId, code, this.requireCourse(p)),
      'TSQ-043': (tenantId, p, code) =>
        this.summaryRepo.getTimeToFinish(tenantId, code, p.courseId),
      // How many courses there are, and how many are live.
      'TSQ-038': (tenantId) => this.coursesByStatus(tenantId),
      // How many learners are on courses right now.
      'TSQ-039': (tenantId, _p, code) =>
        this.summaryRepo.getCourseParticipation(tenantId, code),
      // Enrolments begun and finished each week, for every course or one.
      'TSQ-042': (tenantId, p, code) =>
        this.summaryRepo.getCoursePerformance(tenantId, code, p.courseId),
      // Where learners drop off, and how long each module takes, in one course.
      'TSQ-045': (tenantId, p, code) =>
        this.summaryRepo.getModuleFunnel(tenantId, code, this.requireCourse(p)),
      'TSQ-046': (tenantId, p, code) =>
        this.summaryRepo.getModuleTime(tenantId, code, this.requireCourse(p)),
      // Each roleplay in a course: finishers, tries and session length.
      'TSQ-053': (tenantId, p, code) =>
        this.summaryRepo.getRoleplayAttempts(tenantId, code, p.courseId),
      // One learner's level in each skill over time.
      'TSQ-065': (tenantId, p, code) =>
        this.summaryRepo.getSkillTrend(tenantId, code, p.learnerId),
      // One learner's practice and where they are in each course.
      'TSQ-063': (tenantId, p, code) => {
        const { start, endExclusive } = this.windowFor(
          p.range ?? DEFAULT_CHART_RANGE,
        );
        return this.summaryRepo.getPracticeRhythm(
          tenantId,
          code,
          p.learnerId,
          start,
          endExclusive,
        );
      },
      'TSQ-064': async (tenantId, p, code) => ({
        rows: await this.summaryRepo.getLearnerCourses(
          tenantId,
          code,
          this.requireLearner(p),
        ),
      }),
      // Most-used simulations.
      'TSQ-003': async (tenantId, p, code) => {
        const out = (await this.runSpec('TSQ-003', tenantId, code, p)) as {
          rows: RankedRow[];
        };
        return out.rows.map((r) => ({
          scenarioId: Number(r.key),
          title: r.label,
          sessionCount: r.value,
        }));
      },
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
        scopes: [...this.supportedScopes(entry)],
        filters: filtersOf(this.supportedScopes(entry)),
        state: availability.state,
        reason: availability.reason,
      };
    });
    return { enabled: true, charts, views: STATISTICS_VIEWS.map(cloneView) };
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
    this.assertScopeAllowed(entry, params);

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

    const filters = await this.resolveFilters(tenantId, keys.code, params);
    const data = await handler(tenantId, params, keys.code);
    return filters.length
      ? {
          id: entry.id,
          state: availability.state,
          data,
          // `scope` is the first filter, kept for clients that read one.
          scope: filters[0],
          filters,
        }
      : { id: entry.id, state: availability.state, data };
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

  private async practiceHeatmap(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<PracticeHeatmapData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    const run = (timezone: string) =>
      this.practiceRepo.getPracticeHeatmap(
        tenantId,
        code,
        start,
        endExclusive,
        timezone,
      );
    const requested = p.timezone ?? FALLBACK_TIMEZONE;
    try {
      return { ...(await run(requested)), timezone: requested };
    } catch (error) {
      // An unknown time zone makes Postgres refuse the query. Fall back to UTC
      // rather than failing the chart, and say which zone the hours are in.
      if (requested === FALLBACK_TIMEZONE) throw error;
      this.logger.info(`Unknown time zone "${requested}", using UTC`);
      return { ...(await run(FALLBACK_TIMEZONE)), timezone: FALLBACK_TIMEZONE };
    }
  }

  private async sessionLengths(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<SessionLengthData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    const lengths = await this.practiceRepo.getSessionLengths(
      tenantId,
      code,
      start,
      endExclusive,
    );
    return { ...lengths, boundsMinutes: SESSION_LENGTH_BOUNDS_MINUTES };
  }

  private async activation(
    tenantId: string,
    code: string,
  ): Promise<ActivationData> {
    const counts = await this.practiceRepo.getActivationCounts(tenantId, code);
    return {
      stages: [
        { key: 'registered', count: counts.registered },
        { key: 'started', count: counts.started },
        { key: 'practisedThreeTimes', count: counts.practisedThreeTimes },
        { key: 'activeRecently', count: counts.activeRecently },
      ],
    };
  }

  private async regularity(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<RegularityData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    const counts = await this.practiceRepo.getRegularityCounts(
      tenantId,
      code,
      start,
      endExclusive,
    );
    return {
      ...counts,
      total: counts.regular + counts.occasional + counts.bursty,
    };
  }

  private async itemFormats(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<ItemFormatData> {
    const rows = await this.practiceRepo.getItemFormatDropoff(
      tenantId,
      code,
      this.selectionOf(p),
    );
    return {
      rows: rows.map((r) => ({
        ...r,
        completedPercent:
          r.reached > 0 ? Math.round((r.completed / r.reached) * 100) : 0,
      })),
    };
  }

  private async quizPassRates(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<QuizPassData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    return {
      rows: await this.practiceRepo.getQuizPassRates(
        tenantId,
        code,
        start,
        endExclusive,
        QUIZ_MIN_ATTEMPTS,
        QUIZ_LIMIT,
        this.selectionOf(p),
      ),
    };
  }

  private async skillChange(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<SkillChangeData> {
    return {
      rows: await this.practiceRepo.getSkillChange(
        tenantId,
        code,
        this.selectionOf(p),
      ),
    };
  }

  /**
   * The courses, simulations or learners a chart can be drawn for. Refused when
   * the page is off for the tenant, like the charts themselves.
   */
  async getScopeOptions(
    tenantId: string,
    kind: ScopeKind,
    search: string | undefined,
    limit = 50,
    id?: string,
  ): Promise<ScopeOption[]> {
    const keys = await this.capabilitiesRepo.getTenantKeys(tenantId);
    if (!keys?.statisticsDashboardEnabled) {
      throw new ForbiddenException('Statistics page is not enabled');
    }
    if (id !== undefined) {
      // One named option, so a remembered choice can be labelled after a reload.
      // An id that is not in this organisation (or is the wrong shape for the
      // kind) describes to nothing, and the answer is empty.
      const parsed = kind === 'course' ? id : Number(id);
      if (kind !== 'course' && !Number.isInteger(parsed)) return [];
      const label = await this.scopeOptionsRepo.describe(
        kind,
        parsed,
        tenantId,
        keys.code,
      );
      return label === null ? [] : [{ id, label }];
    }
    return this.scopeOptionsRepo.list(kind, tenantId, keys.code, search, limit);
  }

  /**
   * What a chart can really be drawn for today: the scopes its registry row
   * lists, but only when it runs from a spec (which applies the filters). A chart
   * with its own handler is organisation-wide until it is moved onto a spec, so
   * it never claims a scope it would ignore.
   */
  private supportedScopes(entry: TenantChartEntry): readonly ChartScope[] {
    return TENANT_CHART_SPECS[entry.id] || SCOPE_AWARE_CHARTS.has(entry.id)
      ? entry.scopes
      : ['organisation'];
  }

  /** The scope fields of a request, as the query layer takes them. */
  private selectionOf(p: TenantChartParams) {
    return {
      scenarioId: p.scenarioId,
      courseId: p.courseId,
      learnerId: p.learnerId,
    };
  }

  /** A course-only chart needs a course; asking without one is a mistake in the request. */
  private requireCourse(p: TenantChartParams): string {
    if (!p.courseId) {
      throw new BadRequestException('Choose a course for this chart');
    }
    return p.courseId;
  }

  private requireLearner(p: TenantChartParams): number {
    if (p.learnerId === undefined) {
      throw new BadRequestException('Choose a learner for this chart');
    }
    return p.learnerId;
  }

  /** A scope filter is only accepted for a chart that supports that scope. */
  private assertScopeAllowed(
    entry: TenantChartEntry,
    p: TenantChartParams,
  ): void {
    const wanted: Array<[unknown, ChartScope]> = [
      [p.courseId, 'course'],
      [p.scenarioId, 'simulation'],
      [p.learnerId, 'learner'],
    ];
    wanted.forEach(([value, scope]) => {
      if (value !== undefined && !this.supportedScopes(entry).includes(scope)) {
        throw new BadRequestException(
          `This chart cannot be drawn for one ${scope}`,
        );
      }
    });
  }

  /**
   * Names what the chart is drawn for, and checks it belongs to the tenant: an
   * id from another organisation finds nothing and the chart is refused.
   */
  private async resolveFilters(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<TenantChartScopeDto[]> {
    const picked: Array<[ScopeKind, string | number | undefined]> = [
      ['course', p.courseId],
      ['simulation', p.scenarioId],
      ['learner', p.learnerId],
    ];
    const out: TenantChartScopeDto[] = [];
    for (const [kind, id] of picked) {
      if (id === undefined) continue;
      const label = await this.scopeOptionsRepo.describe(
        kind,
        id,
        tenantId,
        code,
      );
      if (label === null) throw new NotFoundException(`Unknown ${kind}`);
      out.push({ kind, id: String(id), label });
    }
    return out;
  }

  /** Runs a chart defined in {@link TENANT_CHART_SPECS}. */
  private async runSpec(
    chartId: string,
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<ScoreDistributionData | RatingsData | { rows: RankedRow[] }> {
    const spec = TENANT_CHART_SPECS[chartId];
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    const window = {
      tenantId,
      tenantCode: code,
      start,
      endExclusive,
      scope: this.selectionOf(p),
    };
    if (spec.result === 'distribution') {
      return this.chartQueryRepo.distribution(spec, window);
    }
    if (spec.result === 'stars') return this.chartQueryRepo.stars(window);
    return { rows: await this.chartQueryRepo.ranked(spec, window) };
  }

  /** The `[start, endExclusive)` window for a range; `all` runs from the epoch. */
  private windowFor(range: AnalyticsRange): {
    start: Date;
    endExclusive: Date;
  } {
    if (range === 'all') {
      return {
        start: new Date(0),
        endExclusive: new Date(Date.now() + 86_400_000),
      };
    }
    const { start, endExclusive } = resolveAnalyticsWindow(
      { range },
      { defaultRange: DEFAULT_CHART_RANGE, defaultBucketFor: () => 'week' },
    );
    return { start, endExclusive };
  }

  private async learnerTrends(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<LearnerTrendData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    const counts = await this.outcomesRepo.getLearnerTrendCounts(
      tenantId,
      code,
      start,
      endExclusive,
      TREND_THRESHOLD_POINTS,
    );
    return {
      ...counts,
      total: counts.improving + counts.holding + counts.declining,
      threshold: TREND_THRESHOLD_POINTS,
    };
  }

  private async reviewCoverage(
    tenantId: string,
    code: string,
    p: TenantChartParams,
  ): Promise<ReviewCoverageData> {
    const { start, endExclusive } = this.windowFor(
      p.range ?? DEFAULT_CHART_RANGE,
    );
    return this.outcomesRepo.getReviewCoverage(
      tenantId,
      code,
      start,
      endExclusive,
    );
  }

  /** Courses by where they stand: all, live, still in draft, archived. */
  private async coursesByStatus(tenantId: string): Promise<MeasuresData> {
    const { rows } = await this.allCourses(tenantId);
    const count = (status: string) =>
      rows.filter((c) => String(c.status).toUpperCase() === status).length;
    return {
      measures: [
        { key: 'courses', value: rows.length, format: 'count' },
        { key: 'live', value: count('ACTIVE'), format: 'count' },
        { key: 'draft', value: count('DRAFT'), format: 'count' },
        { key: 'archived', value: count('ARCHIVED'), format: 'count' },
      ],
    };
  }

  /** Every course for the tenant, read once. `truncated` when there are more. */
  private async allCourses(tenantId: string) {
    const usage = await this.tenantAnalytics.getCourseUsage(tenantId, {
      limit: COURSE_READ_CAP,
      offset: 0,
    });
    return { rows: usage.data, truncated: usage.count > usage.data.length };
  }

  private async coursesInUse(tenantId: string): Promise<CoursesInUseData> {
    const { rows, truncated } = await this.allCourses(tenantId);
    const inUse = rows.filter((c) => c.learnersStarted > 0).length;
    return { total: rows.length, inUse, idle: rows.length - inUse, truncated };
  }

  private async coursesRankedBy(
    tenantId: string,
    measure: 'stalled' | 'notStarted',
  ): Promise<CourseRankingData> {
    const { rows, truncated } = await this.allCourses(tenantId);
    const value = (c: (typeof rows)[number]) =>
      measure === 'stalled'
        ? c.inProgressStalled
        : c.learnersAssigned - c.learnersStarted;
    return {
      truncated,
      rows: rows
        .map((c) => ({ id: c.id, title: c.title, count: value(c) }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, COURSE_RANKING_LIMIT),
    };
  }

  /**
   * Enrolments, not people: a learner in three courses counts three times.
   * Summed across courses so the funnel reads as the organisation's whole
   * course load; a per-course funnel is a later parameter.
   */
  private async courseFunnel(tenantId: string): Promise<CourseFunnelData> {
    const { rows, truncated } = await this.allCourses(tenantId);
    const sum = (pick: (c: (typeof rows)[number]) => number) =>
      rows.reduce((n, c) => n + pick(c), 0);
    return {
      truncated,
      stages: [
        { key: 'assigned', count: sum((c) => c.learnersAssigned) },
        { key: 'started', count: sum((c) => c.learnersStarted) },
        { key: 'halfway', count: sum((c) => c.learnersAtLeast50) },
        { key: 'completed', count: sum((c) => c.learnersCompleted100) },
      ],
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

/** A plain copy of a view, so the shared configuration can never be changed through a response. */
const cloneView = (view: (typeof STATISTICS_VIEWS)[number]) => ({
  id: view.id,
  subject: view.subject as 'course' | 'learner' | null,
  sections: view.sections.map((section) => ({
    key: section.key,
    subject: section.subject,
    charts: [...section.charts],
  })),
  defaultLayout: [...view.defaultLayout],
});
