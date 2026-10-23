import {
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
} from '@nestjs/common';
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
import { GuideBaselineService } from '../measure/guide-baseline.service';
import {
  GuideBaselineCaptureDto,
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
  ) {
    return this.admin.listThreads({
      limit: Number(limit) || undefined,
      before,
      tenantId,
      mode,
    });
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
    return this.admin.removeCrisisResponse(id);
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

  @Get('releases/:releaseId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  getRelease(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.releases.getById(releaseId);
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
}
