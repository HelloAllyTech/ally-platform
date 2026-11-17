import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';
import { DebriefAct } from '../util/debrief-console-roles.util';
import { DebriefFrameworkService } from '../service/debrief-framework.service';
import {
  DebriefRiskCueOptionService,
  RiskCueOptionInput,
} from '../service/debrief-risk-cue-option.service';
import { DebriefRiskCueTestService } from '../service/debrief-risk-cue-test.service';
import { DebriefRiskCueOption } from '../entity/debrief-risk-cue-option.entity';

type AuthedRequest = { user: { id: number } };

class RiskCueOptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @ApiProperty({
    description: 'What counts as a risk cue here, clear vs possible.',
  })
  @IsString()
  @MaxLength(6000)
  wording!: string;

  @ApiProperty({ enum: ['alarm', 'assessed'] })
  @IsIn(['alarm', 'assessed'])
  handling!: 'alarm' | 'assessed';

  @ApiProperty()
  @IsBoolean()
  wordListRaises!: boolean;

  @ApiProperty()
  @IsBoolean()
  supportLinesOnCue!: boolean;

  @ApiProperty({ description: '{ cues: string[], nonCues: string[] }' })
  @IsObject()
  examples!: { cues: string[]; nonCues: string[] };
}

class NoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** An option as the apps show it. */
function view(o: DebriefRiskCueOption, userId?: number) {
  return {
    id: o.id,
    key: o.key,
    name: o.name,
    description: o.description ?? null,
    // Null wording is "the pinned definition"; the apps show it as such.
    wording: o.wording ?? null,
    handling: o.handling,
    wordListRaises: o.wordListRaises,
    supportLinesOnCue: o.supportLinesOnCue,
    examples: o.examples,
    status: o.status,
    version: o.version,
    testResult: o.testResult ?? null,
    reviewNote: o.reviewNote ?? null,
    approvedAt: o.approvedAt ?? null,
    mine: userId != null && o.createdBy === userId,
  };
}

/**
 * What a roleplay's Debrief assesses and how it handles a risk cue (spec DEBRIEF_ACROSS_ROLEPLAYS):
 * the choices Simulation Studio offers, a creator's own risk-cue options, and the clinical advisor's
 * review of them. A creator writes an option; a clinical advisor (or the owner) approves it once
 * its own example test passes; an approved option is selectable by every roleplay.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/roleplay-options')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefRoleplayOptionsController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly frameworks: DebriefFrameworkService,
    private readonly riskCues: DebriefRiskCueOptionService,
    private readonly riskCueTests: DebriefRiskCueTestService,
  ) {}

  // --- Simulation Studio (creators) ---------------------------------------------

  /**
   * Whether Simulation Studio shows the two Debrief choices for this roleplay: only where the new
   * Debrief runs. A roleplay assigned to at least one organisation that has it switched on (or a
   * global one, with any organisation on), and for a roleplay not saved yet, any organisation on.
   * Other organisations keep today's debrief, which these choices never touch.
   */
  @Get('availability')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary:
      'Whether the new Debrief is switched on for this roleplay (the Studio shows the Debrief choices only then)',
  })
  async availability(
    @Query('scenarioId', new ParseIntPipe({ optional: true }))
    scenarioId?: number,
  ) {
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM agent_config_overrides o
          WHERE o."agentKey" = $2 AND o.layer = 'org'
            AND COALESCE((o."values"->>'live')::boolean, false)
            AND ($1::int IS NULL
                 OR EXISTS (SELECT 1 FROM scenario_tenants st
                             WHERE st."scenarioId" = $1 AND st."deletedAt" IS NULL
                               AND st."tenantId"::text = o."scopeId")
                 OR EXISTS (SELECT 1 FROM scenarios sc
                             WHERE sc.id = $1 AND sc."isGlobal" = true))
       ) AS enabled`,
      [scenarioId ?? null, DEBRIEF_AGENT_KEY],
    );
    return { enabled: row?.enabled === true };
  }

  @Get('frameworks')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary:
      'The skill frameworks a roleplay may choose (Context Library entries, the default first, then None)',
  })
  listFrameworks() {
    return this.frameworks.list();
  }

  @Get('risk-cue-options')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary:
      'The risk-cue options a roleplay may choose: every approved one, plus your own drafts and submissions',
  })
  async listRiskCues(@Req() req: AuthedRequest) {
    return (await this.riskCues.list(req.user.id)).map((o) =>
      view(o, req.user.id),
    );
  }

  @Post('risk-cue-options')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary: 'Write a new risk-cue option (a draft only you see)',
  })
  async createRiskCue(
    @Req() req: AuthedRequest,
    @Body() body: RiskCueOptionDto,
  ) {
    return view(
      await this.riskCues.create(body as RiskCueOptionInput, req.user.id),
      req.user.id,
    );
  }

  @Patch('risk-cue-options/:id')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({ summary: 'Edit your draft (any edit voids its last test)' })
  async updateRiskCue(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: RiskCueOptionDto,
  ) {
    return view(
      await this.riskCues.update(id, body as RiskCueOptionInput, req.user.id),
      req.user.id,
    );
  }

  @Post('risk-cue-options/:id/test')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary:
      'Run the option’s own examples through the Safety reader (3 runs). Draft or awaiting approval, yours only.',
  })
  async testMine(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    const o = await this.riskCues.get(id);
    if (o.createdBy !== req.user.id) {
      throw new ForbiddenException('You can only test your own option.');
    }
    if (!['draft', 'awaiting_approval'].includes(o.status)) {
      throw new ConflictException(
        'Only a draft or an option waiting for approval can be tested.',
      );
    }
    return view(await this.riskCueTests.run(o), req.user.id);
  }

  @Post('risk-cue-options/:id/submit')
  @RequireFeatureToggle(FeatureToggleKey.CREATE_ROLEPLAYS)
  @ApiOperation({
    summary: 'Send your draft to a clinical advisor for approval',
  })
  async submitRiskCue(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return view(await this.riskCues.submit(id, req.user.id), req.user.id);
  }

  // --- The clinical advisor's review (and the owner's) ---------------------------

  @Get('risk-cue-options/review')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Every risk-cue option for review: awaiting approval first, then live ones and drafts',
  })
  async review(@Req() req: AuthedRequest) {
    return (await this.riskCues.listForReview()).map((o) =>
      view(o, req.user.id),
    );
  }

  @Post('risk-cue-options/:id/review-test')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary: 'Run an option’s examples through the Safety reader (3 runs)',
  })
  async reviewTest(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return view(
      await this.riskCueTests.run(await this.riskCues.get(id)),
      req.user.id,
    );
  }

  @Post('risk-cue-options/:id/approve')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Approve an option (clinical advisor or owner): only once its test passed on this version; then every roleplay can pick it',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: NoteDto,
  ) {
    return view(
      await this.riskCues.approve(id, req.user.id, body?.note),
      req.user.id,
    );
  }

  @Post('risk-cue-options/:id/reject')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary: 'Turn an option down with a reason; it goes back to its creator',
  })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: NoteDto,
  ) {
    return view(await this.riskCues.reject(id, body?.note ?? ''), req.user.id);
  }

  @Post('risk-cue-options/:id/retire')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Retire an approved option: no new roleplay may pick it; ones already using it keep it',
  })
  async retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return view(await this.riskCues.retire(id), req.user.id);
  }
}
