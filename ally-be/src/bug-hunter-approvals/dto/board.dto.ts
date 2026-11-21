import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** The three modes (chunk 10), as in the old Bug Hunter's off / manual / AI. */
export const BUG_HUNTER_V2_MODES = ['off', 'manual', 'autonomous'] as const;
export type BugHunterV2Mode = (typeof BUG_HUNTER_V2_MODES)[number];

/** The board's tabs, in the order the page shows them (like the old Bug Hunter). */
export const BOARD_TABS = [
  'needs_you',
  'failed',
  'in_progress',
  'backlog',
  'done',
] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

/** The apps a bug can be pinned to when the reporter didn't say. */
export const BUG_HUNTER_V2_APPS = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
  'ally-mobile',
] as const;

export class UpdateModeDto {
  @ApiProperty({ enum: BUG_HUNTER_V2_MODES })
  @IsIn(BUG_HUNTER_V2_MODES as unknown as string[])
  mode!: BugHunterV2Mode;
}

export class ListBugsQueryDto {
  @ApiPropertyOptional({ enum: BOARD_TABS, default: 'needs_you' })
  @IsOptional()
  @IsIn(BOARD_TABS as unknown as string[])
  tab?: BoardTab;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class StartBugDto {
  @ApiPropertyOptional({
    enum: BUG_HUNTER_V2_APPS,
    description: 'Required when the bug has no app yet (a reported bug).',
  })
  @IsOptional()
  @IsIn(BUG_HUNTER_V2_APPS as unknown as string[])
  app?: (typeof BUG_HUNTER_V2_APPS)[number];
}

/** Why an admin dismissed a bug (chunk 11), as the reviewer would say it. */
export const DISMISS_REASONS = [
  'not_a_bug',
  'duplicate',
  'wont_fix',
  'wrong_diagnosis',
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export class DismissBugDto {
  @ApiProperty({ enum: DISMISS_REASONS })
  @IsIn(DISMISS_REASONS as unknown as string[])
  reason!: DismissReason;

  @ApiPropertyOptional({
    description: 'Optional: what Bug Hunter should learn.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Bulk Put me on / Dismiss (chunk 11), as on the old board. */
export class BulkBugsDto {
  @ApiProperty({ enum: ['start', 'dismiss'] })
  @IsIn(['start', 'dismiss'])
  action!: 'start' | 'dismiss';

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];

  @ApiPropertyOptional({ enum: DISMISS_REASONS })
  @IsOptional()
  @IsIn(DISMISS_REASONS as unknown as string[])
  reason?: DismissReason;
}
