import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RoadmapWatchLevel } from 'src/product-planning/enum/product-planning.enum';
import { RoadmapOpportunityEffort } from '../enum/roadmap-opportunity.enum';

export class SetRoadmapCeilingDto {
  @ApiProperty({
    description:
      "The idea's new spend ceiling in USD. A lead may go up to the Owner-set maximum; an Owner may set any amount.",
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  ceilingUsd!: number;
}

export class SetRoadmapWatchDto {
  @ApiProperty({ enum: RoadmapWatchLevel })
  @IsEnum(RoadmapWatchLevel)
  level!: RoadmapWatchLevel;
}

export class MarkRoadmapNotificationsReadDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  groupKeys?: string[];

  @ApiPropertyOptional({ description: 'Mark everything read' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class PatchRoadmapItemSummaryDto {
  @ApiPropertyOptional({
    description:
      "The idea's text after its title line. Who and outcome come from the copilot's brief and are not edited here.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  problem?: string;
}

/** Inline edits on the idea page (§4.11). Each field is checked on its own. */
export class PatchRoadmapItemDto {
  @ApiPropertyOptional({ description: "The title: the idea text's first line" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'roadmap_product_goals.id' })
  @IsOptional()
  @IsUUID('all')
  goalId?: string;

  @ApiPropertyOptional({ type: PatchRoadmapItemSummaryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchRoadmapItemSummaryDto)
  summary?: PatchRoadmapItemSummaryDto;

  @ApiPropertyOptional({ description: 'A Builder or Owner (Owner only)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  leadUserId?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "'YYYY-MM', or null for Unscheduled (Owner only)",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  plannedMonth?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: RoadmapOpportunityEffort,
    description: 'S to XXL, or null for Not sized (Owner only)',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(RoadmapOpportunityEffort)
  size?: RoadmapOpportunityEffort | null;
}
