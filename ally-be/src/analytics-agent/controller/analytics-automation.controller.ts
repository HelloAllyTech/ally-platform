import {
  Controller,
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
import {
  AnalyticsAutomationAgentRunDto,
  AnalyticsAutomationRunDetailDto,
  AnalyticsAutomationRunSummaryDto,
} from '../dto/analytics-automation.dto';
import { AnalyticsAutomationRunService } from '../service/analytics-automation-run.service';

/**
 * The weekly Analytics Automation runs — list them, open one, and approve or
 * reject the dbt agent's proposal.
 *
 * There is deliberately no endpoint that starts a run: only the scheduler does.
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
      'Starts the dbt agent editing the dbt repo and opening a pull request. Returns at once with the agent in `applying`; poll the run to follow it. 409 when the proposal is not awaiting approval.',
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
