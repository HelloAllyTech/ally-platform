import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';
import { SELF_CHECK_FIELD_MAX } from './roadmap-draft.util';

const IDEMPOTENCY = { min: 8, max: 80 };

export class CreateRoadmapDraftDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  text!: string;

  @ApiPropertyOptional({ description: 'roadmap_product_goals id' })
  @IsOptional()
  @IsString()
  goalId?: string | null;

  @ApiPropertyOptional({ enum: ['typed', 'voice'] })
  @IsOptional()
  @IsIn(['typed', 'voice'])
  captureMode?: 'typed' | 'voice';
}

export class PatchRoadmapDraftDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  text?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the goal' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  goalId?: string | null;

  @ApiPropertyOptional({
    description: 'The version this edit was made on; stale -> 409',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseVersion?: number;
}

export class RoadmapDraftTurnDto {
  @ApiPropertyOptional({
    description: 'Your reply to the agent; omit for Check my idea',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answer?: string;

  @ApiPropertyOptional({ description: 'Client uuid for a retried send' })
  @IsOptional()
  @IsString()
  @Length(IDEMPOTENCY.min, IDEMPOTENCY.max)
  idempotencyKey?: string;
}

export class RoadmapSelfCheckDto {
  @ApiProperty() @IsString() @Length(1, SELF_CHECK_FIELD_MAX) who!: string;
  @ApiProperty() @IsString() @Length(1, SELF_CHECK_FIELD_MAX) pain!: string;
  @ApiProperty() @IsString() @Length(1, SELF_CHECK_FIELD_MAX) why!: string;
  @ApiProperty() @IsString() @Length(1, SELF_CHECK_FIELD_MAX) goal!: string;
  @ApiProperty() @IsString() @Length(1, SELF_CHECK_FIELD_MAX) outcome!: string;
}

export class SubmitRoadmapDraftDto {
  @ApiProperty({
    maxLength: ROADMAP_LIMITS.TITLE_MAX,
    description: 'One line naming the idea. Required to submit.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'An idea needs a title.' })
  @MaxLength(ROADMAP_LIMITS.TITLE_MAX)
  title!: string;

  @ApiPropertyOptional({ description: 'roadmap_product_goals id' })
  @IsOptional()
  @IsString()
  goalId?: string | null;

  /**
   * What to file as the idea's summary beneath its title (audit rec. 6). Left out, as every
   * client before it does, it is `mine`: the author's draft text, verbatim, exactly as before.
   */
  @ApiPropertyOptional({
    enum: ['mine', 'agent'],
    description:
      "`mine` files the draft text verbatim as the summary (the default); `agent` files the idea agent's statement, as edited here",
  })
  @IsOptional()
  @IsIn(['mine', 'agent'])
  use?: 'mine' | 'agent';

  @ApiPropertyOptional({
    maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX,
    description: "With `use: 'agent'`: the statement, as the author edited it",
  })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  statement?: string;
}

export class RoadmapDictationDto {
  @ApiProperty({ description: 'Clip length in ms, as recorded (max 120000)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMs!: number;

  @ApiPropertyOptional({
    description: 'The draft or idea the mic is on; its spend is charged there',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}

// ── Review ───────────────────────────────────────────────────────────────────

export const REVIEW_REASON_MAX = 300;

export class RoadmapReviewDto {
  @ApiProperty({ enum: ['accept', 'decline', 'reopen'] })
  @IsIn(['accept', 'decline', 'reopen'])
  decision!: 'accept' | 'decline' | 'reopen';

  @ApiPropertyOptional({ description: 'accept only: assign this lead too' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  leadUserId?: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_REASON_MAX,
    description: 'decline only, required; the author alone sees it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_REASON_MAX)
  reason?: string;
}

export class RoadmapBatchReviewItemDto extends RoadmapReviewDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  code!: string;
}

export class RoadmapBatchReviewDto {
  @ApiProperty({ type: [RoadmapBatchReviewItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RoadmapBatchReviewItemDto)
  items!: RoadmapBatchReviewItemDto[];
}

export class RoadmapReviewUndoDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  undoToken!: string;
}

export class RoadmapLeadDto {
  @ApiProperty({ enum: ['assign', 'handBack'] })
  @IsIn(['assign', 'handBack'])
  action!: 'assign' | 'handBack';

  @ApiPropertyOptional({ description: 'assign only' })
  @ValidateIf((dto) => dto.action === 'assign')
  @Type(() => Number)
  @IsInt()
  leadUserId?: number;

  @ApiPropertyOptional({ maxLength: 500, description: 'handBack only' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
