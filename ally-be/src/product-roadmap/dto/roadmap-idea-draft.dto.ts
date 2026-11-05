import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const IDEA_DRAFT_TEXT_MAX = 4000;

export class CreateIdeaDraftDto {
  @ApiProperty({ maxLength: IDEA_DRAFT_TEXT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(IDEA_DRAFT_TEXT_MAX)
  rawText!: string;

  @ApiPropertyOptional({ enum: ['voice', 'typed'] })
  @IsOptional()
  @IsIn(['voice', 'typed'])
  captureMode?: 'voice' | 'typed';
}

export class UpdateIdeaDraftDto {
  @ApiPropertyOptional({ maxLength: IDEA_DRAFT_TEXT_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(IDEA_DRAFT_TEXT_MAX)
  rawText?: string;

  @ApiPropertyOptional({ enum: ['voice', 'typed'] })
  @IsOptional()
  @IsIn(['voice', 'typed'])
  captureMode?: 'voice' | 'typed';
}
