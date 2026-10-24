import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SkillsStoreKeyScope } from '../entity/skills-store-key.entity';

/** A new candidate version: from the Skills Store editor or `prompts push`. */
export class CreatePromptVersionRequestDto {
  @ApiProperty({ description: 'The English prompt text' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiProperty({
    description:
      'The newest version you started from (candidates included). Refused with ' +
      '409 `stale_base` when a newer version exists. Null only when the prompt ' +
      'has no versions.',
    nullable: true,
    type: Number,
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  baseVersion!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  provider?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  model?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 2 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number | null;

  @ApiPropertyOptional({ description: 'Why this version exists' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({
    description: 'Eval or v2v results to keep with the version',
  })
  @IsOptional()
  @IsObject()
  evalSummary?: Record<string, unknown> | null;
}

export class RevertPromptRequestDto {
  @ApiPropertyOptional({
    description:
      "Judge rubrics only: confirms the judge's pinned PROMPT_VERSION was bumped",
  })
  @IsOptional()
  @IsBoolean()
  confirmJudgeRubricChange?: boolean;
}

export class PromoteVersionRequestDto {
  @ApiProperty({
    description:
      'The live version you saw. Refused with 409 `stale_base` if it changed.',
    nullable: true,
    type: Number,
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  expectedCurrentVersion!: number | null;

  @ApiPropertyOptional({
    description: 'Allow putting an earlier published version live again',
  })
  @IsOptional()
  @IsBoolean()
  rollback?: boolean;

  @ApiPropertyOptional({
    description:
      "Judge rubrics only: confirms the judge's pinned PROMPT_VERSION was bumped",
  })
  @IsOptional()
  @IsBoolean()
  confirmJudgeRubricChange?: boolean;
}

export class CreateSkillsStoreKeyDto {
  @ApiProperty({ description: 'Who or what the key is for' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: SkillsStoreKeyScope, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(SkillsStoreKeyScope, { each: true })
  scopes!: SkillsStoreKeyScope[];
}
