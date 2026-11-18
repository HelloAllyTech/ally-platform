import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';
import { parseSessionFilters } from '../util/debrief-console-view.util';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { parseMetricsFilter } from '../util/debrief-metrics-filter.util';
import { DebriefConsoleService } from '../service/debrief-console.service';
import { DebriefNightlyService } from '../service/debrief-nightly.service';
import { DebriefRunLogsService } from '../service/debrief-run-logs.service';
import { DebriefGuidanceMetricsService } from '../service/debrief-guidance-metrics.service';
import { DebriefMetricsService } from '../service/debrief-metrics.service';
import { AuthedRequest } from './console-shared';

/**
 * The Console's read views: Home, a session, metrics, attention, analytics and the viewer's own roles.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleViewController {
  constructor(
    private readonly console: DebriefConsoleService,
    private readonly metrics: DebriefMetricsService,
    private readonly view: DebriefConsoleViewService,
    private readonly agentLogs: DebriefRunLogsService,
    private readonly nightly: DebriefNightlyService,
    private readonly guidanceMetrics: DebriefGuidanceMetricsService,
  ) {}

  @Get('overview')
  @DebriefRead()
  @ApiOperation({
    summary: 'Debrief agent at a glance: runs, judge scores, cost, budgets',
  })
  overview(@Query('days') days?: string) {
    const d = Number(days);
    return this.console.overview(
      Number.isInteger(d) && d > 0 && d <= 90 ? d : 7,
    );
  }

  @Get('metrics/nightly')
  @DebriefRead()
  @ApiOperation({
    summary:
      "The nightly check (v9 FR-49): each day's measures overall, by language and by recipe, the alerts, and the weekly judge-drift readings",
  })
  nightlyView(@Query('days') days?: string) {
    return this.nightly.days(days ? Number(days) || 56 : 56);
  }

  @Get('metrics')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Success metrics (v9 §3.3): the weekly steering proxy, guardrails, efficiency, experience by language and device, baselines and monthly uptake lift',
  })
  metricsView(@Query() q: Record<string, string>) {
    const weeks = q.weeks ? Number(q.weeks) || 12 : 12;
    // Organisation, language, learner level, recipe, release version, judge
    // version: one set, applied to every live metric (malformed values dropped).
    return this.metrics.view(weeks, parseMetricsFilter(q));
  }

  @Get('guidance-metrics')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Debrief Guidance analytics: lookup and guidance agent use, planner choices, tool calls, entries, latency, with/without the agent (aggregate only)',
  })
  guidanceMetricsView(
    @Query('days') days?: string,
    @Query('mode') mode?: string,
  ) {
    return this.guidanceMetrics.report({ days, mode });
  }

  @Get('models')
  @DebriefRead()
  @ApiOperation({
    summary:
      "Each step's model in the live release, and the models a person may pick for it",
  })
  models() {
    return this.console.models();
  }

  @Get('me')
  @DebriefRead()
  @ApiOperation({
    summary:
      "The viewer's roles and every action they may take (`can`), for hiding buttons",
  })
  async me(@Req() req: AuthedRequest) {
    const v = await this.view.viewer(req.user.id);
    return { userId: v.userId, roles: v.roles, can: v.can };
  }

  @Get('sessions')
  @DebriefRead()
  @ApiOperation({
    summary:
      'The home list: a category (needs / flagged / below / published / escalated / agreement_sample / all), filters, queue order and counts',
  })
  async sessions(
    @Req() req: AuthedRequest,
    @Query() q: Record<string, string>,
  ) {
    return this.view.sessions(
      parseSessionFilters(q),
      await this.view.viewer(req.user.id),
    );
  }

  @Get('sessions/runs/:id')
  @DebriefRead()
  @ApiOperation({
    summary:
      'One session view: transcript, cards and versions, flags, Ask Ally, distress, skill estimate, judge, comments, queue and pending actions for your role',
  })
  async sessionView(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.view.session(id, await this.view.viewer(req.user.id));
  }

  @Get('runs/:runId/logs')
  @DebriefAct('agentLogs')
  @ApiOperation({
    summary:
      'Agent logs: the exact input every agent was sent and its full reply, in order (Ally team only). Runs from before logs were kept answer an empty list with `loggedFrom`',
  })
  agentLogsOf(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.agentLogs.view(runId);
  }

  @Get('attention')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Banners and counts for Debriefs home and the Debrief PM agent, only for roles that can act',
  })
  async attention(@Req() req: AuthedRequest) {
    return this.view.attention(await this.view.viewer(req.user.id));
  }

  @Get('analytics')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Analytics › Debriefs: the six tiles, the cost panel and judge agreement',
  })
  analytics(@Query('days') days?: string) {
    const d = Number(days);
    return this.view.analytics(Number.isInteger(d) && d > 0 && d <= 90 ? d : 7);
  }
}
