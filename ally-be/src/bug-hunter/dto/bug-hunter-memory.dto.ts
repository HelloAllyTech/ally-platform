import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { BUG_HUNTER_NOTE_MAX_CHARS } from 'src/context-library/profiles/bug-hunter-notes.profile';

/**
 * Bug Hunter's memory is the Context Library's Bug Hunter Notes collection (phase 5). These
 * DTOs are the pipeline's contract with it, unchanged in shape so a runner built before the
 * move keeps working.
 */

/** Cap on hits a single lookup may return, whatever the caller asked for. */
export const BUG_HUNTER_NOTES_MAX_HITS = 10;

/** A note's id (uuid) or its code (`BN-0042`). */
const NOTE_REF =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{2}-\d{4,})$/i;

/** One note as the agent writes it. */
export class WriteBugHunterMemoryDto {
  @ApiProperty({
    maxLength: BUG_HUNTER_NOTE_MAX_CHARS,
    description:
      'The one lesson, written for a stranger: name the repo, file, command or symptom. Under 600 characters.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(BUG_HUNTER_NOTE_MAX_CHARS)
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Repos this applies to. Omit for platform-wide.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  repos?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Open labels: verification, flaky-test, fix-gotcha, false-positive, whatever fits. Not a fixed list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'The run whose reflection wrote this.' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ description: 'The finding this was learned from.' })
  @IsOptional()
  @IsUUID()
  findingId?: string;

  @ApiPropertyOptional({
    description:
      'Ignored: the pipeline may not pin — a pin is a person outranking the curator, and people pin notes in the Context Library.',
  })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class SearchBugHunterMemoryQueryDto {
  @ApiProperty({ description: 'What the agent is asking its notebook.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  q!: string;

  @ApiPropertyOptional({
    description: 'Narrow to entries for this repo plus platform-wide ones.',
  })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiPropertyOptional({ default: 3, maximum: BUG_HUNTER_NOTES_MAX_HITS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BUG_HUNTER_NOTES_MAX_HITS)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Accepted for older runners and ignored: the Context Library returns only good-or-better matches.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;

  @ApiPropertyOptional({
    description:
      'The run making the lookup, so it is recorded as a memory context lookup.',
  })
  @IsOptional()
  @IsUUID()
  runId?: string;
}

export class BugHunterMemoryHitDto {
  @ApiProperty({ description: 'The note id; report it back in feedback.' })
  id!: string;
  @ApiProperty({ description: 'The note code, e.g. BN-0042.' }) code!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [String], nullable: true }) repos!: string[] | null;
  @ApiProperty() pinned!: boolean;
  @ApiProperty({ description: 'How well it matched: strong or good.' })
  band!: string;
  @ApiProperty({
    description:
      'Relevance, 0-1, from the band (strong 0.9, good 0.7). Kept for runners that read it.',
  })
  similarity!: number;
}

export class BugHunterMemorySearchResponseDto {
  @ApiProperty({ type: [BugHunterMemoryHitDto] })
  hits!: BugHunterMemoryHitDto[];
}

/**
 * A run's verdict on the notebook entries it read (OPP-0752). `applied` are the
 * ids that changed what the run did; `contradicted` the ones that turned out
 * wrong tonight. Both may be empty — an empty report is still a report, and is
 * what lets the nightly retirement pass trust a zero.
 */
export class BugHunterMemoryFeedbackDto {
  @ApiProperty({ description: 'The run reporting.' })
  @IsUUID()
  runId!: string;

  @ApiProperty({
    type: [String],
    description: 'Entry ids (or codes) that changed what this run did.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(NOTE_REF, { each: true })
  applied!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Entry ids (or codes) that proved wrong during this run.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(NOTE_REF, { each: true })
  contradicted?: string[];
}
