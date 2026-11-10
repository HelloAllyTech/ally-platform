import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StartPlanDto {
  @ApiProperty({ description: 'The idea in the author’s own words' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ enum: ['typed', 'voice'] })
  @IsOptional()
  @IsIn(['typed', 'voice'])
  captureMode?: 'typed' | 'voice';

  @ApiPropertyOptional({
    description: 'Save it without starting the copilot (no AI, no cost)',
  })
  @IsOptional()
  @IsBoolean()
  park?: boolean;
}

export class PlanTurnDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}

export class FilePlanDto {
  @ApiPropertyOptional({
    description:
      'The product goal, when the copilot did not settle one; must be a live goal name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productGoal?: string;
}

export class HandBackDto {
  @ApiPropertyOptional({ description: 'A note for whoever takes it on next' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ClosePlanDto {
  @ApiProperty({ description: 'Why this is not being pursued, in plain words' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class AskAuthorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;
}

export class AnswerAuthorQuestionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  answer!: string;
}

const IMPACT_TAGS = [
  'stores_or_moves_personal_data',
  'sends_user_content_to_llm',
  'learner_or_client_facing_ai',
  'crisis_or_helpline_path',
  'recordings_or_transcripts',
  'minors_possible',
  'prompt_or_model_change',
  'ui_change',
  'mobile',
  'cross_tenant',
  'export',
] as const;

export class SetImpactTagsDto {
  @ApiProperty({ enum: IMPACT_TAGS, isArray: true })
  @IsArray()
  @ArrayMaxSize(IMPACT_TAGS.length)
  @IsIn(IMPACT_TAGS as unknown as string[], { each: true })
  tags!: (typeof IMPACT_TAGS)[number][];
}

class MeasureMethodDto {
  @ApiProperty({ enum: ['analytics_question', 'manual'] })
  @IsIn(['analytics_question', 'manual'])
  kind!: 'analytics_question' | 'manual';

  @ApiProperty({
    description:
      'The analytics question the outcome review will ask, or how it will be judged by hand',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  spec!: string;
}

export class SetSuccessMeasureDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) metric!: string;

  @ApiProperty({
    nullable: true,
    description: 'Null when there is no baseline yet',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseline!: string | null;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) target!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  guardrails!: string[];

  @ApiProperty({ type: MeasureMethodDto })
  @ValidateNested()
  @Type(() => MeasureMethodDto)
  method!: MeasureMethodDto;

  @ApiProperty({ type: [Number], example: [14, 45] })
  @IsArray()
  @ArrayMaxSize(4)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(365, { each: true })
  reviewAfterDays!: number[];
}

export class ResolveFindingDto {
  @ApiProperty({ enum: ['fixed', 'dismissed'] })
  @IsIn(['fixed', 'dismissed'])
  kind!: 'fixed' | 'dismissed';

  @ApiProperty({ description: 'Why — required, and shown to every later lead' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class LaunchItemDoneDto {
  @ApiProperty() @IsBoolean() done!: boolean;
}
