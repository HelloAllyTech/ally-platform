import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SAFETY_TEXT_KINDS } from '../languages/safety-translations.service';
import type { SafetyTextKind } from '../languages/safety-translations.service';

/** Assistants stage 5: copy knowledge from another chatbot. */
export class CopyKnowledgeDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Only these documents of the source; all of them when absent',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  documentIds?: string[];
}

export class AddFromPoolDto {
  @ApiProperty() @IsUUID('4') documentId!: string;
}

export class SetCuratedDto {
  @ApiProperty() @IsBoolean() curated!: boolean;
}

export class PushQuickReplyDto {
  @ApiProperty({ description: 'The global reply whose locked copies change' })
  @IsUUID('4')
  globalId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  responseText?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  patterns?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class SafetyTranslationDto {
  @ApiProperty({ example: 'ta' })
  @IsString()
  @MaxLength(16)
  language!: string;

  @ApiProperty({ enum: SAFETY_TEXT_KINDS })
  @IsIn(SAFETY_TEXT_KINDS as unknown as string[])
  kind!: SafetyTextKind;

  @ApiProperty({
    description:
      'The translated text. A crisis text keeps {link} (and {numbers} for the builder numbers).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}

export class DryRunDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
