import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import { DebriefClinicalListsService } from '../service/debrief-clinical-lists.service';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefAutonomyService } from '../service/debrief-autonomy.service';
import { DebriefReleasesService } from '../service/debrief-releases.service';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefSettingsService } from '../service/debrief-settings.service';
import { DebriefBaselineService } from '../service/debrief-baseline.service';
import {
  SettingsChangeDto,
  ClinicalListChangeDto,
  AcceptBaselineDto,
  AutonomyMatrixDto,
  AutonomyOrgDto,
  BudgetsDto,
} from './dto/debrief-console.dto';
import { AuthedRequest, budgetTitle } from './console-shared';

/**
 * Debrief Settings: owner settings, clinical lists, baseline, budgets, autonomy and the pinned-rules list.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleSettingsController {
  constructor(
    private readonly pmAgent: DebriefPmAgentService,
    private readonly settings: DebriefSettingsService,
    private readonly clinicalLists: DebriefClinicalListsService,
    private readonly baseline: DebriefBaselineService,
    private readonly view: DebriefConsoleViewService,
    private readonly autonomy: DebriefAutonomyService,
    private readonly releaseHistory: DebriefReleasesService,
  ) {}

  @Get('settings')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Owner settings (v9 FR-60): every test-ladder threshold and budget, with the baseline proposal',
  })
  settingsView() {
    return this.settings.view();
  }

  @Put('settings')
  @DebriefAct('ownerSettings')
  @ApiOperation({ summary: 'Change owner settings (audited)' })
  updateSettings(@Req() req: AuthedRequest, @Body() body: SettingsChangeDto) {
    return this.settings.update(body.changes, req.user.id);
  }

  @Get('settings/clinical-lists')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Clinical lists: the words behind the score, diagnosis and jargon checks, per language',
  })
  clinicalListsView() {
    return this.clinicalLists.view();
  }

  @Put('settings/clinical-lists')
  @DebriefAct('clinicalLists')
  @ApiOperation({
    summary:
      "Replace one language's clinical list (the clinical advisor or the owner; audited)",
  })
  updateClinicalList(
    @Req() req: AuthedRequest,
    @Body() body: ClinicalListChangeDto,
  ) {
    return this.clinicalLists.update(
      body.kind,
      body.language,
      body.entries ?? null,
      req.user.id,
    );
  }

  @Post('settings/accept')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary: "Accept some of the baseline job's proposed values",
  })
  acceptBaseline(@Req() req: AuthedRequest, @Body() body: AcceptBaselineDto) {
    return this.settings.acceptBaseline(body.keys, req.user.id);
  }

  @Post('settings/baseline')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Run the baseline job now: propose starting values from production data (it also runs monthly)',
  })
  runBaseline() {
    return this.baseline.run();
  }

  @Get('pinned-rules')
  @DebriefRead()
  @ApiOperation({
    summary:
      'The pinned rules (safety rules, risk cue definition, rubric, judge, reviewer and Evaluator instructions): current version and who last changed it. Read-only: they are edited in the Skills Store by the named pinned editors',
  })
  async pinnedRules() {
    return this.view.pinnedRules();
  }

  @Get('autonomy')
  @DebriefRead()
  @ApiOperation({
    summary:
      'What the Debrief PM agent may do alone: kind × step matrix with eligibility, per-organisation overrides, re-locks',
  })
  async autonomyView(@Req() req: AuthedRequest) {
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('autonomy/matrix')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Change matrix cells (owner). "auto" only where eligible, except a confirmed canary override; pinned rules are not configurable',
  })
  async setMatrix(@Req() req: AuthedRequest, @Body() body: AutonomyMatrixDto) {
    await this.autonomy.setMatrix(body.changes, req.user.id, !!body.override);
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('autonomy/orgs/:tenantId')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      "An organisation's overrides (owner): paired_trial / canary → default | ask | never; only tightens",
  })
  async setOrgAutonomy(
    @Param('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: AutonomyOrgDto,
  ) {
    await this.autonomy.setOrg(tenantId, body.changes, req.user.id);
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('budgets')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Owner: change the run ceiling and the monthly cap. Budgets alone go live on this confirm, as a new release (undo with Roll back); the evaluator bar is proposed and climbs the ladder.',
  })
  async budgets(@Req() req: AuthedRequest, @Body() body: BudgetsDto) {
    const settings: Record<string, number> = {};
    if (body.runCeilingUsd != null) settings.runCeilingUsd = body.runCeilingUsd;
    if (body.monthlyCapUsd != null) settings.monthlyCapUsd = body.monthlyCapUsd;
    if (body.passScore != null) settings.passScore = body.passScore;
    const proposed = await this.releaseHistory.proposeChange(
      {
        title: budgetTitle(settings),
        why: body.note ?? null,
        settings,
      },
      req.user.id,
    );
    // v9: a budget change needs a person's confirmation, the owner's, and the
    // owner just gave it. Budgets alone go live now, still as a release with
    // its idea and audit, so Roll back undoes them.
    if (!proposed.budgetOnly) return { ...proposed, live: false };
    await this.pmAgent.approve(proposed.ideaId, req.user.id, body.note);
    return { ...proposed, live: true };
  }
}
