import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { OrgScopedRoute } from 'src/auth/decorators/org-scoped-route.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentTraceService } from 'src/llm-agent/harness/trace/agent-trace.service';
import { AgentTurnStoreService } from 'src/llm-agent/harness/turn/agent-turn-store.service';
import { GuideAdminService } from '../admin/guide-admin.service';
import { GuideConfigAdminService } from '../config/guide-config-admin.service';
import { GuideConfigResolverService } from '../config/guide-config-resolver.service';
import { AgentConfigLayer } from 'src/llm-agent/harness/enum/harness.enum';
import { GuideBaselineService } from '../measure/guide-baseline.service';
import { GuidePlaygroundService } from '../admin/guide-playground.service';
import { GuideAlertService } from '../measure/guide-alert.service';
import { GuideOutreachService } from '../outreach/guide-outreach.service';
import { GuideMode } from '../enum/guide.enum';
import { GuidePeerService } from '../peer/guide-peer.service';
import { GuideAdviceStatus } from '../entity/guide-advice-line.entity';
import {
  GuideAdviceModerationDto,
  GuideBaselineCaptureDto,
  GuideConfigOverrideDto,
  GuideCanaryStartDto,
  GuidePlaygroundRunDto,
  GuideCrisisResponseDto,
  GuideRollbackDto,
  UpdateGuideSwitchesDto,
} from '../dto/guide.dto';
import { ALLY_GUIDE_AGENT_KEY } from '../release/guide-release.bundle';
import { GuideSettingsService } from '../settings/guide-settings.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_ALLY_GUIDE] };
const EDIT = { permissions: [PERMISSIONS.EDIT_ALLY_GUIDE] };
const REVIEW = { permissions: [PERMISSIONS.REVIEW_ALLY_GUIDE_TRANSCRIPTS] };

/**
 * The Ally Console's API (plans/ally-guide/plan.md §10.5): kill switches,
 * releases with one-click rollback, and the Turn Inspector. Traces here carry
 * the summary only — stage timings, outcome, release — never learner text;
 * reading conversations is the separate, per-person transcripts permission.
 */
@ApiTags('Ally guide — admin')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/guide/admin')
export class GuideAdminController {
  constructor(
    private readonly settings: GuideSettingsService,
    private readonly releases: AgentReleaseService,
    private readonly traces: AgentTraceService,
    private readonly turns: AgentTurnStoreService,
    private readonly admin: GuideAdminService,
    private readonly baseline: GuideBaselineService,
    private readonly playgroundService: GuidePlaygroundService,
    private readonly alerts: GuideAlertService,
    private readonly outreach: GuideOutreachService,
    private readonly peer: GuidePeerService,
    private readonly configResolver: GuideConfigResolverService,
    private readonly configAdmin: GuideConfigAdminService,
  ) {}

  @Get('overview')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'Live health: turns, time to first token by channel, safety, cache ratio, cost, GA release',
  })
  overview(@Query('days') days?: string) {
    return this.admin.overview(Number(days) || 7);
  }

  @Get('threads')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'Conversations, newest activity first (no content)',
  })
  listThreads(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('tenantId') tenantId?: string,
    @Query('mode') mode?: string,
    @Query('status') status?: string,
  ) {
    return this.admin.listThreads({
      limit: Number(limit) || undefined,
      before,
      tenantId,
      mode,
      status,
    });
  }

  @Get('threads/:threadId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'One conversation row, for a deep link (no content)',
  })
  async thread(@Param('threadId', ParseUUIDPipe) threadId: string) {
    const [row] = await this.admin.listThreads({ threadId, limit: 1 });
    if (!row) throw new NotFoundException('Thread not found');
    return row;
  }

  @Get('threads/:threadId/transcript')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      'A redacted transcript, for the Ally team only (per-person transcripts toggle)',
  })
  transcript(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.admin.transcript(threadId);
  }

  @Get('turns/:turnId/payload')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      "Turn Inspector: the full trace payload (situation report, tool I/O, reply). Holds the learner's words",
  })
  async tracePayload(@Param('turnId', ParseUUIDPipe) turnId: string) {
    const payload = await this.traces.getPayload(turnId);
    if (!payload)
      throw new NotFoundException('No payload stored for this turn');
    return payload;
  }

  @Get('org-profile')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "An organisation's Ally profile: support lines, supervisor wording, protocols, tone",
  })
  orgProfile(@Query('tenantId') tenantId: string) {
    return this.admin.orgProfile(tenantId);
  }

  @Put('org-profile')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary: "Save an organisation's Ally profile (a new version)",
  })
  saveOrgProfile(
    @Query('tenantId') tenantId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: TokenUser,
  ) {
    return this.admin.saveOrgProfile(tenantId, body, user.id);
  }

  @Get('org-crisis-responses')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary: "An organisation's own fixed crisis copy, per language",
  })
  orgCrisisResponses(@Query('tenantId') tenantId: string) {
    return this.admin.listCrisisResponses(tenantId);
  }

  @Put('org-crisis-responses')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Save an organisation's crisis copy for a language (a new version)",
  })
  saveOrgCrisisResponse(
    @Query('tenantId') tenantId: string,
    @Body() dto: GuideCrisisResponseDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.admin.saveCrisisResponse({
      tenantId,
      languageCode: dto.languageCode,
      body: dto.body,
      userId: user.id,
    });
  }

  @Get('crisis-responses')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'The platform fixed crisis copy, per language' })
  crisisResponses() {
    return this.admin.listCrisisResponses(null);
  }

  @Put('crisis-responses')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Save the platform crisis copy for a language (a new version, recorded as approved by you)',
  })
  saveCrisisResponse(
    @Body() dto: GuideCrisisResponseDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.admin.saveCrisisResponse({
      tenantId: null,
      languageCode: dto.languageCode,
      body: dto.body,
      userId: user.id,
    });
  }

  @Delete('crisis-responses/:id')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Withdraw a crisis copy version (falls back to English, then the default)',
  })
  removeCrisisResponse(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removeCrisisResponse(id, null);
  }

  @Delete('org-crisis-responses/:id')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Withdraw a version of an organisation's own crisis copy (falls back to the platform copy)",
  })
  removeOrgCrisisResponse(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.admin.removeCrisisResponse(id, tenantId);
  }

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'The kill switches' })
  getSettings() {
    return this.settings.switches();
  }

  @Put('settings')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: 'Change any kill switch; takes effect within 30 seconds',
  })
  updateSettings(
    @Body() dto: UpdateGuideSwitchesDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.settings.update(dto, user.id);
  }

  @Get('releases')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: "Ally's releases, newest first" })
  async listReleases() {
    const releases = await this.releases.list(ALLY_GUIDE_AGENT_KEY);
    return releases.map((release) => {
      const summary: Partial<typeof release> = { ...release };
      delete summary.bundle;
      return summary;
    });
  }

  @Get('releases/rollback-target')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'The release a rollback would land on now, or null',
  })
  rollbackTarget() {
    return this.releases.rollbackTarget(ALLY_GUIDE_AGENT_KEY);
  }

  @Get('releases/audit')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Who changed which release, when and why' })
  releaseAudit(@Query('limit') limit?: string) {
    return this.admin.releaseAudit(Number(limit) || 50);
  }

  @Get('releases/:releaseId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  getRelease(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.releases.getById(releaseId);
  }

  @Post('playground')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'One dry-run turn of any release against a course and a scripted conversation (nothing stored)',
  })
  playground(
    @Body() dto: GuidePlaygroundRunDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The Console's Stop closes the request: stop the dry run with it, so a
    // cancelled turn doesn't keep calling (and charging) the models.
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    return this.playgroundService.run(
      { ...dto, mode: dto.mode as GuideMode | undefined },
      stop.signal,
    );
  }

  @Get('alerts')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Alerts that fired, newest first' })
  listAlerts(@Query('limit') limit?: string, @Query('open') open?: string) {
    return this.alerts.list(Number(limit) || 50, open === 'true');
  }

  @Get('alerts/counts')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Open (unacknowledged) and total alerts' })
  alertCounts() {
    return this.alerts.counts();
  }

  @Post('alerts/check')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: 'Run the alert rules now (they also run every 15 minutes)',
  })
  checkAlerts() {
    return this.alerts.check();
  }

  @Get('advice')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'Advice moderation queue: lines finishers left at the mentor door (pending by default, oldest first). Authors are never shown.',
  })
  listAdvice(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const wanted = ['pending', 'approved', 'rejected'].includes(status ?? '')
      ? (status as GuideAdviceStatus)
      : 'pending';
    return this.peer.listForModeration({
      status: wanted,
      limit: Number(limit) || 50,
      before: before && !Number.isNaN(Date.parse(before)) ? before : null,
    });
  }

  @Post('advice/:adviceId/moderate')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Approve or reject an advice line. Approved lines show, anonymously, to the same organisation once enough have finished the course.',
  })
  moderateAdvice(
    @Param('adviceId', ParseUUIDPipe) adviceId: string,
    @Body() dto: GuideAdviceModerationDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.peer.moderate({
      id: adviceId,
      decision: dto.decision,
      reason: dto.reason ?? null,
      moderatorId: user.id,
    });
  }

  @Post('alerts/:alertId/ack')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Mark an alert as seen' })
  acknowledgeAlert(
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.alerts.acknowledge(alertId, user.id);
  }

  @Post('outreach/run')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Run outreach now: due appointments, then idle nudges (they also run every 5 min / hourly)',
  })
  async runOutreach() {
    const appointments = await this.outreach.runAppointments();
    const idle = await this.outreach.runIdle();
    return { appointments, idle };
  }

  @Post('baseline')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Capture the public-course baseline Ally is compared against (plan decision 19)',
  })
  captureBaseline(
    @Body() dto: GuideBaselineCaptureDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.baseline.capture({
      windowDays: dto.windowDays ?? 90,
      userId: user.id,
      note: dto.note ?? null,
    });
  }

  @Get('baseline')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Baseline snapshots, newest first' })
  listBaselines(@Query('limit') limit?: string) {
    return this.baseline.list(Number(limit) || 20);
  }

  @Post('releases/:releaseId/promote')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Make a release GA (the current GA is retired)' })
  promote(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.releases.makeGa(releaseId, user.id);
  }

  @Post('releases/:releaseId/canary')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Put a draft in front of a share of new conversations (one canary at a time; promote it to make it GA)',
  })
  startCanary(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() dto: GuideCanaryStartDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.releases.startCanary(
      releaseId,
      dto.percent,
      user.id,
      dto.reason,
    );
  }

  @Post('releases/canary/stop')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Stop the canary without promoting it; emergency moves every thread to GA at its next turn',
  })
  stopCanary(@Body() dto: GuideRollbackDto, @CurrentUser() user: TokenUser) {
    return this.releases.stopCanary(
      ALLY_GUIDE_AGENT_KEY,
      user.id,
      dto.emergency,
      dto.reason,
    );
  }

  @Post('releases/rollback')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Go back to the previous GA release' })
  rollback(@Body() dto: GuideRollbackDto, @CurrentUser() user: TokenUser) {
    return this.releases.rollback(
      ALLY_GUIDE_AGENT_KEY,
      user.id,
      dto.emergency,
      dto.reason,
    );
  }

  @Get('turns/:turnId/trace')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Turn Inspector: the turn and its trace summary' })
  async getTurnTrace(@Param('turnId', ParseUUIDPipe) turnId: string) {
    const turn = await this.turns.findById(turnId);
    if (!turn) throw new NotFoundException('Turn not found');
    const trace = await this.traces.getByTurn(turnId);
    return {
      turn,
      trace: trace
        ? {
            summary: trace.summary,
            releaseId: trace.releaseId,
            hasPayload: Boolean(trace.payloadKey),
            createdAt: trace.createdAt,
          }
        : null,
    };
  }

  @Get('threads/:threadId/traces')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: "A thread's recent turn traces (summaries only)" })
  async listThreadTraces(@Param('threadId', ParseUUIDPipe) threadId: string) {
    const traces = await this.traces.listByThread(threadId);
    return traces.map((t) => ({
      turnId: t.turnId,
      releaseId: t.releaseId,
      summary: t.summary,
      createdAt: t.createdAt,
    }));
  }

  // ── Configuration plane (plan §7.5) ───────────────────────────────────

  @Get('threads/:threadId/config')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'Effective config: every policy value this thread runs under, with the layer it came from',
    description:
      'Resolved release → org → course → learner → runtime. `pending` shows a value saved since ' +
      'the epoch began, which the thread picks up at its next epoch. No learner text.',
  })
  explainConfig(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.configResolver.explain(threadId);
  }

  @Get('config/schema')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'Every policy key: type, limits, unit, description, who may override it, and the live release value',
  })
  configSchema() {
    return this.configAdmin.schema();
  }

  @Get('config/overrides')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'Every organisation and course that overrides Ally config',
  })
  listConfigOverrides(@Query('layer') layer?: string) {
    return this.configAdmin.listOverrides(parseLayer(layer));
  }

  @Get('config/audit')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Config override changes, newest first' })
  configAudit(
    @Query('layer') layer?: string,
    @Query('scopeId') scopeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.configAdmin.auditLog({
      layer: parseLayer(layer),
      scopeId: scopeId || undefined,
      limit: Number(limit) || undefined,
    });
  }

  @Get('config/org')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, VIEW)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "An organisation's Ally config: the settings it may change, its overrides and recent changes",
  })
  orgConfig(@Query('tenantId') tenantId: string) {
    return this.configAdmin.layerView(
      AgentConfigLayer.ORG,
      requireScope(tenantId, 'tenantId'),
    );
  }

  @Put('config/org')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_ORG, EDIT)
  @OrgScopedRoute()
  @ApiOperation({
    summary:
      "Change an organisation's Ally config (audited; each conversation picks it up at its next epoch)",
  })
  saveOrgConfig(
    @Query('tenantId') tenantId: string,
    @Body() dto: GuideConfigOverrideDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.configAdmin.save({
      layer: AgentConfigLayer.ORG,
      scopeId: requireScope(tenantId, 'tenantId'),
      change: { set: dto.set, clear: dto.clear },
      expectedVersion: dto.expectedVersion,
      userId: user.id,
    });
  }

  @Get('config/course/:trackId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "A course's Ally config: the settings it may change, its overrides and recent changes",
  })
  courseConfig(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.configAdmin.layerView(AgentConfigLayer.COURSE, trackId);
  }

  @Put('config/course/:trackId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      "Change a course's Ally config (audited; each conversation picks it up at its next epoch)",
  })
  saveCourseConfig(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Body() dto: GuideConfigOverrideDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.configAdmin.save({
      layer: AgentConfigLayer.COURSE,
      scopeId: trackId,
      change: { set: dto.set, clear: dto.clear },
      expectedVersion: dto.expectedVersion,
      userId: user.id,
    });
  }
}

const parseLayer = (value?: string): AgentConfigLayer | undefined =>
  value === AgentConfigLayer.ORG || value === AgentConfigLayer.COURSE
    ? value
    : undefined;

const requireScope = (value: string | undefined, name: string): string => {
  if (!value?.trim()) throw new BadRequestException(`${name} is required`);
  return value.trim();
};
