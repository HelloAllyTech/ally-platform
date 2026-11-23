import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProposedChangeDto } from './assistant-home.dto';

/** SB1: "Run 10 likely questions" on the assistant being built. */
export class RunLikelyDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    default: 10,
    description: 'How many likely questions to ask',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  count?: number;
}

/** SB1: edit by talking on the assistant being built (the draft, not the assistant row). */
export class ProposeDraftChangeDto {
  @ApiPropertyOptional({
    description: 'What to change, in the owner’s words (same as `message`)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  request?: string;

  @ApiPropertyOptional({
    description: 'What to change, in the owner’s words (same as `request`)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message?: string;
}

export class ApplyDraftChangeDto {
  @ApiProperty({ type: [ProposedChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProposedChangeDto)
  changes!: ProposedChangeDto[];

  @ApiPropertyOptional({
    description:
      'The draft version the proposal was made on (SB1). Ignored when `fieldVersions` is sent.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;

  @ApiPropertyOptional({
    description:
      'Stage 3: the version of each field the proposal touches, as `propose` returned it. Only these are checked (409 `stale_field`).',
  })
  @IsOptional()
  @IsObject()
  fieldVersions?: Record<string, string>;
}
