import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RoadmapWatchLevel } from 'src/product-planning/enum/product-planning.enum';

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
