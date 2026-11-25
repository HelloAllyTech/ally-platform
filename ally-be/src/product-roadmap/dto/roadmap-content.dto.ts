import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';
import { RoadmapSavedViewState } from '../type/roadmap-saved-view.type';

export class RoadmapListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

// ── comments ─────────────────────────────────────────────────────────────────
export class CreateCommentDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.COMMENT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.COMMENT_MAX)
  body!: string;
}

// ── interview notes ──────────────────────────────────────────────────────────
export class CreateInterviewNoteDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_TITLE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TITLE_MAX)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  interviewee?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  transcript?: string | null;

  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX)
  summary!: string;
}

export class UpdateInterviewNoteDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.INTERVIEW_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  interviewee?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  transcript?: string | null;

  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX)
  summary?: string;
}

export class CreateSavedViewDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX)
  name!: string;

  @ApiProperty({
    description: 'Filter/sort snapshot. Goal and owner entries are NAMES.',
  })
  @IsObject()
  state!: RoadmapSavedViewState;
}

/**
 * `pinned` is deliberately ABSENT, so a view's owner cannot pin their own view for everyone by
 * PATCHing this field. (Pinning had its own manage-gated route on the old Product Roadmap; it
 * was retired with that page, and views pinned then stay pinned.) The service also rejects the
 * field explicitly if a client sends it.
 */
export class UpdateSavedViewDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  state?: RoadmapSavedViewState;
}

// ── taxonomy ─────────────────────────────────────────────────────────────────
export class CreateTaxonomyItemDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.GOAL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.GOAL_NAME_MAX)
  name!: string;
}

export class RenameTaxonomyItemDto extends CreateTaxonomyItemDto {}

// ── AI ───────────────────────────────────────────────────────────────────────
export class AiSummariseDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX)
  transcript!: string;
}
