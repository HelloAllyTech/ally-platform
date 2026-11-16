import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PromptTestDto {
  @ApiProperty({ description: 'Catalog model to run the prompt on' })
  @IsUUID()
  modelId!: string;

  @ApiProperty({ description: 'The (possibly unsaved) prompt text' })
  @IsString()
  @MinLength(1)
  @MaxLength(30000)
  promptText!: string;

  @ApiPropertyOptional({ description: 'Sample user input or variable values' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  sampleInput?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
