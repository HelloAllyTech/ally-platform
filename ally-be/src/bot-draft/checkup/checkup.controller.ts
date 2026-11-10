import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { CHECKUP_LIMITS, CheckupService, SuiteCase } from './checkup.service';
import { DraftCheckupService } from './draft-checkup.service';
import { CheckupCasesService } from './checkup-cases.service';
import { ADDED_FROM, OUTCOMES } from './checkup-cases';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const EXPECT = ['answer', 'decline', 'clarify', 'crisis_only', 'smalltalk'];
const SUITE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class SuiteCaseDto implements SuiteCase {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsString() @MaxLength(500) send!: string;
  @ApiProperty({ enum: EXPECT }) @IsIn(EXPECT) expect!: SuiteCase['expect'];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  thread?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facts?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  must_not?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  also_ok?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hard_fail?: boolean;
  @ApiPropertyOptional({ enum: ['must_pass', 'nice_to_pass'] })
  @IsOptional()
  @IsIn(['must_pass', 'nice_to_pass'])
  tier?: 'must_pass' | 'nice_to_pass';
}

export class ImportSuiteDto {
  @ApiProperty() @Matches(SUITE) suite!: string;

  @ApiProperty({ type: [SuiteCaseDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SuiteCaseDto)
  cases!: SuiteCaseDto[];
}

export class GapAnswerDto {
  @ApiProperty() @IsString() @MaxLength(1000) text!: string;
}

const VERSION = /^[0-9a-f]{16}$/;

/** A question the owner adds or edits (chunk 20d-2). */
class CaseFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  question?: string;

  @ApiPropertyOptional({ enum: OUTCOMES })
  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: (typeof OUTCOMES)[number];

  @ApiPropertyOptional({ description: 'What a good answer includes' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  facts?: string[];

  @ApiPropertyOptional({ description: 'What it must not say' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  mustNot?: string[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() mustPass?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;

  @ApiPropertyOptional({ description: 'Turn off keeps it without asking it' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class NewCaseDto extends CaseFieldsDto {
  @ApiProperty() @IsString() @MaxLength(500) declare question: string;

  @ApiProperty({ enum: OUTCOMES })
  @IsIn(OUTCOMES)
  declare outcome: (typeof OUTCOMES)[number];

  @ApiPropertyOptional({ enum: ADDED_FROM })
  @IsOptional()
  @IsIn(ADDED_FROM)
  addedFrom?: (typeof ADDED_FROM)[number];
}

export class EditCaseDto extends CaseFieldsDto {
  @ApiProperty({
    description: 'The version of the question this edit started from',
  })
  @Matches(VERSION)
  version!: string;
}

export class CaseVersionDto {
  @ApiProperty() @Matches(VERSION) version!: string;
}

class SuggestionDto {
  @ApiProperty() @IsString() @MaxLength(500) question!: string;

  @ApiProperty()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  facts!: string[];

  @ApiPropertyOptional() @IsOptional() source?: Record<string, unknown>;
}

export class KeepSuggestionsDto {
  @ApiProperty({ type: [SuggestionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SuggestionDto)
  questions!: SuggestionDto[];
}

export class StartRunDto {
  @ApiPropertyOptional({ enum: ['manual', 'eval'] })
  @IsOptional()
  @IsIn(['manual', 'eval'])
  trigger?: 'manual' | 'eval';

  @ApiPropertyOptional({ description: 'Ask only this suite (evals)' })
  @IsOptional()
  @Matches(SUITE)
  suite?: string;

  @ApiPropertyOptional({
    description: 'Ask each question this many times (evals, platform admins)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHECKUP_LIMITS.maxAttempts)
  attempts?: number;

  @ApiPropertyOptional({
    enum: ['all', 'failed'],
    description: 'Only the questions that did not pass last time (chunk 20d-2)',
  })
  @IsOptional()
  @IsIn(['all', 'failed'])
  only?: 'all' | 'failed';
}

/**
 * The Checkup (chunk 20a-2): an assistant's test questions, run through its own engine and graded
 * by the one grader. Members read; editors run it. Eval suites are platform admins only.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class CheckupController {
  constructor(
    private readonly checkup: CheckupService,
    private readonly drafts: DraftCheckupService,
    private readonly cases: CheckupCasesService,
  ) {}

  // ── The owner's questions (chunk 20d-2) ─────────────────────────────────

  @Get(':id/checkup/cases')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: "The checkup's questions, each with its last 5 results",
  })
  listCases(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.list(id);
  }

  @Post(':id/checkup/cases')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Add a question' })
  addCase(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NewCaseDto) {
    return this.cases.create(id, dto);
  }

  @Patch(':id/checkup/cases/:caseId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Edit a question, or turn it off or on',
    description:
      'A safety question can only be added to. Refused with 409 and the current question when stale.',
  })
  editCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: EditCaseDto,
  ) {
    return this.cases.edit(id, caseId, dto);
  }

  @Delete(':id/checkup/cases/:caseId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Delete a question (restore is Undo); safety questions stay',
  })
  removeCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CaseVersionDto,
  ) {
    return this.cases.remove(id, caseId, dto.version);
  }

  @Post(':id/checkup/cases/:caseId/restore')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Undo deleting a question' })
  restoreCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ) {
    return this.cases.restore(id, caseId);
  }

  @Post(':id/checkup/cases/:caseId/try')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: '"Try this one": ask one question now and wait for its result',
  })
  tryCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ) {
    return this.cases.tryOne(id, caseId);
  }

  @Post(':id/checkup/suggestions')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Suggest more questions from the pages (nothing is added)',
  })
  suggest(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.suggest(id);
  }

  @Post(':id/checkup/suggestions/keep')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Keep the suggested questions the owner ticked' })
  keep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KeepSuggestionsDto,
  ) {
    return this.drafts.keepSuggestions(id, dto.questions);
  }

  @Get(':id/checkup')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'The checkup: the latest run, the trend, and the wording it needs',
  })
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.view(id);
  }

  @Post(':id/checkup/cases/:caseId/answer')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Answer a question it couldn’t: added to the Owner notes',
  })
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: GapAnswerDto,
  ) {
    return this.drafts.answerGap(id, caseId, dto.text);
  }

  @Post(':id/checkup/cases/:caseId/not-offered')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: '"We don’t offer this": noted, and kept as a decline',
  })
  notOffered(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ) {
    return this.drafts.notOffered(id, caseId);
  }

  @Post(':id/checkup/suites')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: "Add or update an eval suite's questions (platform admins)",
  })
  importSuite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportSuiteDto,
  ) {
    return this.checkup.importSuite(id, dto.suite, dto.cases);
  }

  @Post(':id/checkup/runs')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Start a checkup run',
    description:
      'Answers at once with the run; poll GET …/checkup/runs/:runId for results.',
  })
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRunDto) {
    return this.checkup.start(id, {
      trigger: dto.trigger ?? 'manual',
      suite: dto.suite ?? null,
      attempts: dto.attempts,
      only: dto.only,
    });
  }

  @Get(':id/checkup/runs/:runId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'A checkup run with its results and numbers' })
  getRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.checkup.getRun(id, runId);
  }
}
