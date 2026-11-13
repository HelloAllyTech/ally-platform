import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { AUTOMATION_SCHEDULE } from '../constants/analytics-automation.constants';
import {
  AnalyticsAutomationAgentRunDto,
  AnalyticsAutomationConfigDto,
  AnalyticsAutomationRunDetailDto,
  AnalyticsAutomationRunSummaryDto,
} from '../dto/analytics-automation.dto';
import { AnalyticsAutomationRunService } from '../service/analytics-automation-run.service';

/**
 * The weekly Analytics Automation runs — list them, open one, and approve or
 * reject the dbt agent's proposal.
 *
 * A run starts from the scheduler. The one other way is `POST runs`, a testing
 * aid that refuses unless `ANALYTICS_AUTOMATION_ALLOW_MANUAL_START=true`.
 * Same gate as the rest of the Analytics Agent (the `analytics_agent` toggle).
 * Note what Approve does: it makes the dbt agent open a pull request in the dbt
 * repo, so anyone who can open this tab can trigger that (the PR still needs a
 * person to merge it).
 */
@ApiTags('Analytics Agent')
@Controller('v1/analytics/agent/automation')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsAutomationController {
  constructor(private readonly runService: AnalyticsAutomationRunService) {}

  /** Read per request, not at import, so suites can set it. */
  private manualStartEnabled(): boolean {
    return (
      process.env[AUTOMATION_SCHEDULE.ALLOW_MANUAL_START_ENV_VAR] === 'true'
    );
  }

  @Get('config')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'What this deployment allows',
    description: 'Tells the tab whether to show the test start button.',
  })
  @ApiResponse({ status: 200, type: AnalyticsAutomationConfigDto })
  config(): AnalyticsAutomationConfigDto {
    return { manualStartEnabled: this.manualStartEnabled() };
  }

  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Start a run now (testing only)',
    description:
      'Starts the same run the schedule would and returns at once; poll the run to follow it. 403 unless ANALYTICS_AUTOMATION_ALLOW_MANUAL_START=true. 409 when a run is already in progress.',
  })
  @ApiResponse({ status: 202, type: AnalyticsAutomationRunDetailDto })
  @ApiResponse({ status: 403, description: 'Manual start is not enabled' })
  @ApiResponse({ status: 409, description: 'A run is already in progress' })
  async start(): Promise<AnalyticsAutomationRunDetailDto> {
    if (!this.manualStartEnabled()) {
      throw new ForbiddenException('Starting a run by hand is not enabled');
    }
    const started = await this.runService.startManualRun();
    return this.runService.getRun(started.run.id);
  }

  @Get('runs')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Past automation runs',
    description: 'Most recent first, with each agent’s current status.',
  })
  @ApiResponse({ status: 200, type: [AnalyticsAutomationRunSummaryDto] })
  async list(): Promise<AnalyticsAutomationRunSummaryDto[]> {
    return this.runService.listRuns();
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'One automation run with its three agents',
    description:
      'Each agent’s summary, findings, pull request and review verdict. 404 if the run does not exist.',
  })
  @ApiResponse({ status: 200, type: AnalyticsAutomationRunDetailDto })
  @ApiResponse({ status: 404, description: 'Automation run not found' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsAutomationRunDetailDto> {
    return this.runService.getRun(id);
  }

  @Post('agents/:agentRunId/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Approve the dbt agent’s proposal',
    description:
      'Checks the PostHog pull request on GitHub, then starts the dbt agent: it works out what dbt needs and opens a pull request in the dbt repo. Returns at once with the agent in `applying`; poll the run to follow it. 409 when the PostHog pull request is still open or the agent is not awaiting approval; 502 when GitHub cannot be asked.',
  })
  @ApiResponse({ status: 202, type: AnalyticsAutomationAgentRunDto })
  @ApiResponse({ status: 404, description: 'dbt agent run not found' })
  @ApiResponse({ status: 409, description: 'Not awaiting approval' })
  async approve(
    @Param('agentRunId', ParseUUIDPipe) agentRunId: string,
    @Req() req: { user: { id: number } },
  ): Promise<AnalyticsAutomationAgentRunDto> {
    return this.runService.approve(agentRunId, req.user?.id);
  }

  @Post('agents/:agentRunId/reject')
  @HttpCode(HttpStatus.OK)
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Reject the dbt agent’s proposal',
    description:
      'Closes the proposal; its items are not raised again in later runs. 409 when it is not awaiting approval.',
  })
  @ApiResponse({ status: 200, type: AnalyticsAutomationAgentRunDto })
  @ApiResponse({ status: 404, description: 'dbt agent run not found' })
  @ApiResponse({ status: 409, description: 'Not awaiting approval' })
  async reject(
    @Param('agentRunId', ParseUUIDPipe) agentRunId: string,
    @Req() req: { user: { id: number } },
  ): Promise<AnalyticsAutomationAgentRunDto> {
    return this.runService.reject(agentRunId, req.user?.id);
  }
}
