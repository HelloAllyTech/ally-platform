import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsObject,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DEBRIEF_APPROVED_PROVIDERS } from '../../constants/debrief-release.constants';
import {
  CLINICAL_ENTRY_MAX_CHARS,
  CLINICAL_LIST_KINDS,
  CLINICAL_LIST_LANGUAGES,
  CLINICAL_LIST_MAX_ENTRIES,
  ClinicalListKind,
  ClinicalListLanguage,
} from '../../constants/debrief-clinical-lists.constants';
import {
  AUTONOMY_STEPS,
  CHANGE_KINDS,
} from '../../util/debrief-console-view.util';
import {
  DebriefCommentAnchor,
  DebriefCommentTag,
} from '../../enum/debrief-review.enum';
import { COMMENT_BODY_MAX, QUOTE_MAX } from '../../util/debrief-review.util';
import {
  BUILDER_ANSWERERS,
  BuilderAnswerer,
} from '../../util/debrief-builder-progress.util';

export class ReasonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** "Hand to Builder": who answers Builder's interview (R2-20). */
export class ApproveIdeaDto extends ReasonDto {
  @ApiProperty({ required: false, enum: BUILDER_ANSWERERS })
  @IsOptional()
  @IsIn(BUILDER_ANSWERERS as unknown as string[])
  answerer?: BuilderAnswerer;
}

/**
 * Builder's waiting question answered from the idea card: the Builder feed's
 * answer shape (`AnswerBuilderDecisionDto`): option ids, the person's own
 * words, or both. `text` is the older one-line form, read as `message`.
 */
export class BuilderAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  questionId!: string;

  @ApiPropertyOptional({ type: [String], description: 'Picked option ids' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "The person's own words",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  customValues?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @ApiPropertyOptional({ description: 'Older form of `message`' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;
}

export class CardCorrectionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  lead?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  body?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  why?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  try_saying?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  reason?: string;
}

export class ResolveFlagDto {
  @ApiProperty({ enum: ['kept', 'removed', 'corrected'] })
  @IsIn(['kept', 'removed', 'corrected'])
  outcome!: 'kept' | 'removed' | 'corrected';

  @ApiProperty({
    required: false,
    description: 'Required to keep or correct a point: the learner reads it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ required: false, type: CardCorrectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardCorrectionDto)
  correction?: CardCorrectionDto;
}

export class TenantLiveDto {
  @ApiProperty()
  @IsBoolean()
  live!: boolean;
}

export class SettingsChangeDto {
  @ApiProperty({
    description:
      'Settings to change, by key; null returns a key to its default (v9 FR-60)',
  })
  @IsObject()
  changes!: Record<string, number | boolean | null>;
}

export class ClinicalListChangeDto {
  @ApiProperty({ enum: CLINICAL_LIST_KINDS })
  @IsIn([...CLINICAL_LIST_KINDS])
  kind!: ClinicalListKind;

  @ApiProperty({ enum: CLINICAL_LIST_LANGUAGES })
  @IsIn([...CLINICAL_LIST_LANGUAGES])
  language!: ClinicalListLanguage;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Plain words or phrases, matched case-insensitively at word boundaries; null restores the default',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLINICAL_LIST_MAX_ENTRIES)
  @IsString({ each: true })
  @MaxLength(CLINICAL_ENTRY_MAX_CHARS, { each: true })
  entries!: string[] | null;
}

export class AcceptBaselineDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keys!: string[];
}

export class TenantRegionDto {
  @ApiProperty({ enum: ['india', 'outside_india'] })
  @IsIn(['india', 'outside_india'])
  region!: 'india' | 'outside_india';
}

export class TenantProvidersDto {
  @ApiProperty({ enum: DEBRIEF_APPROVED_PROVIDERS, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(DEBRIEF_APPROVED_PROVIDERS as unknown as string[], { each: true })
  providers!: string[];
}

export class CorrectCardDto {
  @ApiProperty({ description: 'The card, e.g. `work_on_this[0]`' })
  @IsString()
  @MaxLength(48)
  section!: string;

  @ApiProperty({ type: CardCorrectionDto })
  @ValidateNested()
  @Type(() => CardCorrectionDto)
  correction!: CardCorrectionDto;

  @ApiProperty({ description: 'What changed: the learner reads it' })
  @IsString()
  @MaxLength(500)
  note!: string;
}

export class StillHappeningDto {
  @ApiProperty({ description: 'The later run the problem happened again on' })
  @IsUUID()
  runId!: string;

  @ApiProperty({
    required: false,
    description: 'Defaults to "Still happening."',
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body?: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;
}

export class ConsoleCommentDto {
  @ApiProperty({ enum: DebriefCommentAnchor })
  @IsEnum(DebriefCommentAnchor)
  anchorKind!: DebriefCommentAnchor;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  turnIndex?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  section?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  spanStart?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  spanEnd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_MAX)
  quotedText?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class EditConsoleCommentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body?: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;
}

export class QuestionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  text!: string;
}

export class PmAboutDto {
  @ApiProperty({ enum: ['change', 'session', 'page'] })
  @IsIn(['change', 'session', 'page'])
  kind!: 'change' | 'session' | 'page';

  @ApiProperty({
    required: false,
    description: 'The change (idea) id or the session run id',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;
}

export class PmConversationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  text!: string;

  @ApiProperty({ required: false, type: PmAboutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PmAboutDto)
  about?: PmAboutDto;
}

export class StartStepDto {
  @ApiProperty({ enum: ['gate_test', 'paired_trial'] })
  @IsIn(['gate_test', 'paired_trial'])
  step!: 'gate_test' | 'paired_trial';
}

export class MatrixCellDto {
  @ApiProperty({ enum: CHANGE_KINDS })
  @IsString()
  kind!: string;

  @ApiProperty({ enum: AUTONOMY_STEPS })
  @IsString()
  step!: string;

  @ApiProperty({ enum: ['auto', 'ask', 'off'] })
  @IsString()
  value!: string;
}

export class AutonomyMatrixDto {
  @ApiProperty({ type: [MatrixCellDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => MatrixCellDto)
  changes!: MatrixCellDto[];

  @ApiProperty({
    required: false,
    description:
      'The owner confirmed a canary "on its own" before the judge-agreement gate is met',
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class AutonomyOrgDto {
  @ApiProperty({
    description: '{ paired_trial?, canary?: "default" | "ask" | "never" }',
  })
  @IsObject()
  changes!: Record<string, string>;
}

export class BudgetsDto {
  @ApiProperty({ required: false, description: 'The evaluator bar (5–10)' })
  @IsOptional()
  @IsNumber()
  passScore?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  runCeilingUsd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  monthlyCapUsd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EmergencyStopDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class StepEditDto {
  @ApiProperty({
    description:
      'A recipe step (`reviser`) or an agent (`agent:protocol_check`)',
  })
  @IsString()
  @MaxLength(64)
  step!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  backupModel?: string | null;
}

export class ProposeChangeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  why?: string;

  @ApiProperty({ required: false, type: [StepEditDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StepEditDto)
  steps?: StepEditDto[];

  @ApiProperty({
    required: false,
    description: '{ runCeilingUsd?, monthlyCapUsd?, passScore? } (owner)',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, number>;

  @ApiProperty({ required: false, description: "Ask Ally's model" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reply?: string;

  @ApiProperty({
    required: false,
    description: 'Skills Store versions to ship: { promptCode: version }',
  })
  @IsOptional()
  @IsObject()
  prompts?: Record<string, number>;
}
