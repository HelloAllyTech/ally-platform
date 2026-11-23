import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEAD_CODE_LIMITS } from '../constants/pm-agent.constants';

/** One module's worth of unused code: the unit that becomes one roadmap ticket. */
export class DeadCodeGroupDto {
  @ApiProperty({
    description:
      'Module path, e.g. ally-ai/app/core/debrief_graph. Unique per report.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEAD_CODE_LIMITS.KEY_MAX)
  key!: string;

  @ApiProperty({ description: 'The repo the module lives in, e.g. ally-ai.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  repo!: string;

  @ApiProperty({ description: 'Number of unused items found in the module.' })
  @IsInt()
  @Min(1)
  count!: number;

  @ApiProperty({
    description: 'Counts by kind, e.g. { function: 8, import: 2 }.',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  @IsObject()
  kinds!: Record<string, number>;

  @ApiProperty({
    description:
      'Up to 40 lines, "kind name (path)". Bounded; not a code dump.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(DEAD_CODE_LIMITS.ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(DEAD_CODE_LIMITS.ITEM_MAX, { each: true })
  items!: string[];
}

export class IngestDeadCodeDto {
  @ApiProperty({ type: [DeadCodeGroupDto] })
  @IsArray()
  @ArrayMaxSize(DEAD_CODE_LIMITS.GROUPS_MAX)
  @ValidateNested({ each: true })
  @Type(() => DeadCodeGroupDto)
  groups!: DeadCodeGroupDto[];
}

export class IngestDeadCodeResponseDto {
  @ApiProperty() received!: number;
  @ApiProperty({ description: 'New modules the PM Agent has not seen before.' })
  created!: number;
  @ApiProperty({ description: 'Known modules whose counts were refreshed.' })
  refreshed!: number;
}
