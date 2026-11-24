import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One working-copy field (stage 3, per-field versions). */
export class EditFieldDto {
  @ApiProperty({
    description: 'The new value (text, a list of text, or an object, by field)',
  })
  @Allow()
  value!: unknown;

  @ApiProperty({
    description:
      'The version of the value this edit started from, as last returned for this field',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  version!: string;
}

export class ApplyWorkingCopyDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Only these fields (default: every pending change)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fields?: string[];
}

export class ApplyTemplateDto {
  @ApiProperty({ example: 'lib-helpline-front-door' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  templateId!: string;

  @ApiPropertyOptional({
    description:
      'The template’s form fields by key (`name` and its setup questions)',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;
}

export class SourceDocumentDto {
  @ApiProperty({
    description:
      'A file uploaded with POST /v1/chatbots/:id/documents/upload-url',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  fileUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty({ example: 'pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sourceType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  fileName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

export class AddSourcesDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Web addresses to read. The first starts at once unless a crawl is running; the rest wait their turn.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  addresses?: string[];

  @ApiPropertyOptional({ type: [SourceDocumentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SourceDocumentDto)
  documents?: SourceDocumentDto[];
}

export class BuildModeDto {
  @ApiProperty({ enum: ['copilot', 'form'] })
  @IsIn(['copilot', 'form'])
  mode!: 'copilot' | 'form';

  @ApiPropertyOptional({
    enum: ['template', 'scratch', 'website', 'documents', 'interview'],
    description:
      'The start path the builder chose. Choosing one touches a blank chatbot (it is kept).',
  })
  @IsOptional()
  @IsIn(['template', 'scratch', 'website', 'documents', 'interview'])
  path?: string;
}
