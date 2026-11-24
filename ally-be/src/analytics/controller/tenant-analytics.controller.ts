import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { TenantScopedPermissions } from 'src/auth/decorators/own-tenant-scope.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { EnableAnalyticsDto } from '../dto/enable-analytics.dto';
import {
  CourseUsageQueryDto,
  CourseUsageResponseDto,
  LearnerUsageQueryDto,
  LearnerUsageResponseDto,
  OrganizationMetricsQueryDto,
  OrganizationMetricsResponseDto,
} from '../dto/tenant-analytics.dto';
import {
  TenantCapabilitiesResponseDto,
  TenantChartDataResponseDto,
  TenantChartLibraryResponseDto,
  TenantChartQueryDto,
  TenantScopeOptionDto,
  TenantScopeOptionsQueryDto,
} from '../dto/tenant-chart-library.dto';
import { AnalyticsService } from '../service/analytics.service';
import { TenantAnalyticsService } from '../service/tenant-analytics.service';
import {
  TenantInsightStateBodyDto,
  TenantInsightsResponseDto,
} from '../dto/tenant-insights.dto';
import { TenantInsightsService } from '../service/tenant-insights.service';
import { TenantChartLibraryService } from '../service/tenant-chart-library.service';
import { CourseAssessmentReportService } from '../service/course-assessment-report.service';
import { compareScenarioBehaviours } from 'src/track/util/assessment-compat.util';

@ApiTags('Tenant Analytics')
@Controller('v1/tenant-analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class TenantAnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly tenantAnalyticsService: TenantAnalyticsService,
    private readonly chartLibraryService: TenantChartLibraryService,
    private readonly courseAssessmentReportService: CourseAssessmentReportService,
    private readonly dataSource: DataSource,
    private readonly insightsService: TenantInsightsService,
  ) {}

  /**
   * Pre/post assessment roleplays in one course, for the caller's own tenant:
   * each learner's pre and post score (as frozen at submission), the gain,
   * incomplete starts, and a cohort summary whose averages are withheld below
   * the minimum group size. A course with no pairs returns `pairs: []`.
   */
  @Get('courses/:trackId/assessment-pairs')
  @ApiOperation({
    summary:
      "Pre/post assessment results for one course, in the caller's tenant",
  })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getCourseAssessmentPairs(
    @Param('trackId', ParseUUIDPipe) trackId: string,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.courseAssessmentReportService.getCoursePairs(trackId, tenantId);
  }

  /**
   * Whether two roleplays score the same behaviours — the course builder's
   * warning when a trainer pairs a pre with a post. Advisory only.
   */
  @Get('assessment-pair-compat/:preScenarioId/:postScenarioId')
  @ApiOperation({
    summary: 'Whether a pre and a post roleplay score the same behaviours',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TRACK])
  async getAssessmentPairCompat(
    @Param('preScenarioId', ParseIntPipe) preScenarioId: number,
    @Param('postScenarioId', ParseIntPipe) postScenarioId: number,
  ) {
    return compareScenarioBehaviours(
      this.dataSource,
      preScenarioId,
      postScenarioId,
    );
  }

  /**
   * Organization Metrics for the caller's own tenant (tenant-admin native
   * dashboard). The tenant is taken from the JWT — never from the client —
   * so a tenant admin can only ever read their own organization's numbers.
   */
  @Get('organization-metrics')
  @ApiOperation({
    summary:
      "Organization metrics (simulations completed, active users) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: OrganizationMetricsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getOrganizationMetrics(
    @Query() query: OrganizationMetricsQueryDto,
  ): Promise<OrganizationMetricsResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getOrganizationMetrics(
      tenantId,
      query.range ?? '30d',
    );
  }

  /**
   * Per-learner usage table for the caller's own tenant. Same JWT-scoped
   * tenant + permission gate as `organization-metrics` — a tenant admin can
   * only ever see their own organization's learners.
   */
  @Get('learner-usage')
  @ApiOperation({
    summary:
      "Per-learner usage table (name, activity recency, roleplay + course progress) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: LearnerUsageResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getLearnerUsage(
    @Query() query: LearnerUsageQueryDto,
  ): Promise<LearnerUsageResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getLearnerUsage(tenantId, query);
  }

  /**
   * Per-course (Track 2.0) usage table for the caller's own tenant. Same
   * JWT-scoped tenant + permission gate as `organization-metrics`.
   */
  @Get('course-usage')
  @ApiOperation({
    summary:
      "Per-course usage table (assigned/started/completion + timing) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: CourseUsageResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getCourseUsage(
    @Query() query: CourseUsageQueryDto,
  ): Promise<CourseUsageResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getCourseUsage(tenantId, query);
  }

  /**
   * The charts the caller's tenant may add to its Statistics dashboard, and
   * whether it can fill each. `enabled: false` until the new page is switched
   * on for the tenant (`tenants.settings.statisticsDashboard.enabled`).
   */
  @Get('chart-library')
  @ApiOperation({
    summary: "Chart library for the caller's tenant, with availability",
  })
  @ApiResponse({ status: 200, type: TenantChartLibraryResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getChartLibrary(): Promise<TenantChartLibraryResponseDto> {
    return this.chartLibraryService.getLibrary(this.requireTenantId());
  }

  /** The counts that decide which charts the caller's tenant can fill. */
  @Get('capabilities')
  @ApiOperation({ summary: 'Data counts that decide chart availability' })
  @ApiResponse({ status: 200, type: TenantCapabilitiesResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getCapabilities(): Promise<TenantCapabilitiesResponseDto> {
    const capabilities = await this.chartLibraryService.getCapabilities(
      this.requireTenantId(),
    );
    return { capabilities };
  }

  /** One library chart's data for the caller's tenant. */
  @Get('charts/:chartId')
  @ApiOperation({ summary: "One chart's data for the caller's tenant" })
  @ApiResponse({ status: 200, type: TenantChartDataResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getChart(
    @Param('chartId') chartId: string,
    @Query() query: TenantChartQueryDto,
  ): Promise<TenantChartDataResponseDto> {
    return this.chartLibraryService.getChartData(
      this.requireTenantId(),
      chartId,
      query,
    );
  }

  /** The courses, simulations or learners a chart can be drawn for. */
  @Get('chart-scope-options')
  @ApiOperation({ summary: 'List what a statistics chart can be drawn for' })
  @ApiResponse({ status: 200, type: [TenantScopeOptionDto] })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getScopeOptions(
    @Query() query: TenantScopeOptionsQueryDto,
  ): Promise<TenantScopeOptionDto[]> {
    return this.chartLibraryService.getScopeOptions(
      this.requireTenantId(),
      query.kind,
      query.search,
      undefined,
      query.id,
    );
  }

  /**
   * What is worth a look today and what is worth celebrating, for the caller's
   * organisation, minus what the caller has already put away.
   */
  @Get('insights')
  @ApiOperation({ summary: 'Insights for the For you tab' })
  @ApiResponse({ status: 200, type: TenantInsightsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getInsights(): Promise<TenantInsightsResponseDto> {
    return this.insightsService.getInsights(
      this.requireTenantId(),
      this.requireUserId(),
    );
  }

  /** Marks one insight done, or asks to be reminded later. Only the caller's own state changes. */
  @Post('insights/state')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark an insight done, or snooze it' })
  @ApiBody({ type: TenantInsightStateBodyDto })
  @ApiResponse({ status: 204 })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async setInsightState(
    @Body() body: TenantInsightStateBodyDto,
  ): Promise<void> {
    await this.insightsService.setState(
      this.requireTenantId(),
      this.requireUserId(),
      body.fingerprint,
      body.state,
      body.days,
    );
  }

  private requireUserId(): number {
    const userId = Number(ExecutionManager.getUserId());
    if (!Number.isInteger(userId)) {
      throw new ForbiddenException('No user in the auth context');
    }
    return userId;
  }

  private requireTenantId(): string {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return tenantId;
  }

  @Patch('dashboards')
  @ApiOperation({ summary: 'Update tenant dashboards' })
  @ApiBody({ type: EnableAnalyticsDto })
  @ApiResponse({ status: 200, description: 'Tenant dashboards updated' })
  // The body names the organization; an organization-restricted admin may
  // only set the dashboards of one on their allowlist.
  @TenantScopedPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  async updateTenantDashboards(
    @Body() enableAnalyticsDto: EnableAnalyticsDto,
  ): Promise<boolean> {
    return this.analyticsService.updateTenantDashboards(enableAnalyticsDto);
  }
}
