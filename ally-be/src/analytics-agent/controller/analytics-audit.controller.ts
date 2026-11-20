import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  AnalyticsAuditDetailDto,
  AnalyticsAuditSummaryDto,
  StartAnalyticsAuditDto,
  StartAnalyticsAuditResponseDto,
} from '../dto/analytics-audit.dto';
import {
  AnalyticsAuditAgentService,
  toSummary,
} from '../service/analytics-audit-agent.service';

/**
 * The Analytics Agent's audit runs — start one, list past ones, open one.
 *
 * Same gate as the agent it audits (the `analytics_agent` toggle). Note what
 * that means: an audit reads questions and answers from EVERY admin's
 * conversations, whereas the conversations endpoints show each admin only their
 * own. The audit is a platform-scope quality check, so anyone who can open it can
 * read what any admin asked.
 */
@ApiTags('Analytics Agent')
@Controller('v1/analytics/agent/audits')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsAuditController {
  constructor(private readonly auditService: AnalyticsAuditAgentService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: "Start an audit of the Analytics Agent's recent answers",
    description:
      'Audits the most recent `messageCount` answered messages (default 15) that ' +
      'no earlier audit has covered. Returns at once with the run in `running`; ' +
      'the audits take minutes and continue in the background. Poll ' +
      '`GET /audits/:id` to watch `completedMessages` climb to `totalMessages`.\n\n' +
      '`audit: null` means every recent message was already audited, so nothing ' +
      'was started. 409 when another audit is still running.',
  })
  @ApiResponse({
    status: 202,
    description: 'Accepted',
    type: StartAnalyticsAuditResponseDto,
  })
  @ApiResponse({ status: 409, description: 'An audit is already running' })
  async start(
    @Body() body: StartAnalyticsAuditDto,
  ): Promise<StartAnalyticsAuditResponseDto> {
    const started = await this.auditService.startAudit(body.messageCount);
    // `done` is deliberately not awaited: the run outlives this request.
    return { audit: started ? toSummary(started.audit) : null };
  }

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'Past audit runs',
    description: 'Most recent first, as summaries without their messages.',
  })
  @ApiResponse({ status: 200, type: [AnalyticsAuditSummaryDto] })
  async list(): Promise<AnalyticsAuditSummaryDto[]> {
    return this.auditService.listRuns();
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT)
  @ApiOperation({
    summary: 'One audit run with its audited messages',
    description:
      'Messages are those finished so far, in the order they were asked. 404 if ' +
      'the run does not exist.',
  })
  @ApiResponse({ status: 200, type: AnalyticsAuditDetailDto })
  @ApiResponse({ status: 404, description: 'Audit not found' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsAuditDetailDto> {
    return this.auditService.getRun(id);
  }
}
