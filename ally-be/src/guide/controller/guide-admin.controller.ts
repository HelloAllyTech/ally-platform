import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentTraceService } from 'src/llm-agent/harness/trace/agent-trace.service';
import { AgentTurnStoreService } from 'src/llm-agent/harness/turn/agent-turn-store.service';
import { GuideRollbackDto, UpdateGuideSwitchesDto } from '../dto/guide.dto';
import { ALLY_GUIDE_AGENT_KEY } from '../release/guide-release.bundle';
import { GuideSettingsService } from '../settings/guide-settings.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_ALLY_GUIDE] };
const EDIT = { permissions: [PERMISSIONS.EDIT_ALLY_GUIDE] };

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
  ) {}

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
