import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BotPageBrandingDto,
  PrechatFieldDto,
} from '../../chatbot/dto/bot-page.dto';
import { BOT_PAGE_BOUNDS } from '../../chatbot/type/bot-page.type';
import { DesignId, PurposeId, SafetyPackId } from '../enum/bot-draft.enum';

export class BotDraftAccessDto {
  @IsIn(['public', 'organisation', 'invite'])
  mode!: 'public' | 'organisation' | 'invite';

  @IsArray()
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true })
  emails!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  organisationIds!: string[];
}

/** Validates a whole `BotDraft` after a patch: the result must still be a well-formed draft. */
export class BotDraftDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(60)
  assistantName!: string;

  @IsString()
  @MaxLength(600)
  introduction!: string;

  @IsString()
  @MaxLength(4000)
  instructions!: string;

  @IsIn(['warm', 'professional', 'friendly', 'formal'])
  tone!: 'warm' | 'professional' | 'friendly' | 'formal';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, { each: true })
  languages!: string[];

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  topics!: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  knowledgeDocumentIds!: string[];

  @IsString()
  @MaxLength(20000)
  ownerNotes!: string;

  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxSuggested)
  @IsString({ each: true })
  @MaxLength(BOT_PAGE_BOUNDS.maxSuggestedChars, { each: true })
  suggestedQuestions!: string[];

  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxPrechat)
  @ValidateNested({ each: true })
  @Type(() => PrechatFieldDto)
  prechat!: PrechatFieldDto[];

  @IsString()
  @MaxLength(600)
  declineText!: string;

  @IsEnum(SafetyPackId)
  safetyPackId!: SafetyPackId;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  extraNever!: string[];

  @ValidateNested()
  @Type(() => BotPageBrandingDto)
  branding!: BotPageBrandingDto;

  @ValidateNested()
  @Type(() => BotDraftAccessDto)
  access!: BotDraftAccessDto;

  @ValidateIf((_o, v) => v !== null)
  @IsEnum(DesignId)
  design!: DesignId | null;

  @IsOptional()
  @IsEnum(PurposeId)
  purpose?: PurposeId | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  purposeNote?: string;
}

// ── requests ────────────────────────────────────────────────────────────

export class CreateBotDraftDto {
  @ApiPropertyOptional({ example: 'sunrisemind.example' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @ApiPropertyOptional({
    description: 'What the business does, in a few sentences',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Start from uploaded documents instead (they are added with POST :id/documents)',
  })
  @IsOptional()
  @IsBoolean()
  upload?: boolean;
}

/** "Describe it instead", after a website gave too little (chunk 20a-2). */
export class DescribeBotDraftDto {
  @ApiProperty({ description: 'What the business does, in a few sentences' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;
}

export class AddBotDraftDocumentDto {
  @ApiProperty({
    description:
      "A document on the draft's chatbot, uploaded through /v1/chatbots/:id/documents",
  })
  @IsUUID()
  documentId!: string;
}

export class PatchOpDto {
  @ApiProperty({ enum: ['add', 'replace', 'remove'] })
  @IsIn(['add', 'replace', 'remove'])
  op!: 'add' | 'replace' | 'remove';

  @ApiProperty({ example: '/branding/title' })
  @IsString()
  @Matches(/^\/[^\s]*$/)
  @MaxLength(200)
  path!: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;
}

export class PatchBotDraftDto {
  @ApiProperty({ enum: ['draft', 'learned'] })
  @IsIn(['draft', 'learned'])
  target!: 'draft' | 'learned';

  @ApiProperty({ type: [PatchOpDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PatchOpDto)
  ops!: PatchOpDto[];

  @ApiProperty({ description: 'The draft version the edit was made on' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class BotDraftMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({ description: 'A quick reply the owner chose' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  chip?: string;
}

export class UndoBotDraftDto {
  @ApiProperty()
  @IsUUID()
  eventId!: string;
}

export class PublishBotDraftDto {
  @ApiProperty({ enum: ['public', 'organisation', 'invite'] })
  @IsIn(['public', 'organisation', 'invite'])
  access!: 'public' | 'organisation' | 'invite';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true })
  emails?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  organisationIds?: string[];

  @ApiPropertyOptional({
    description:
      'The owner confirmed going live although a question they marked Must pass failed (chunk 20d-2)',
  })
  @IsOptional()
  @IsBoolean()
  confirmMustPass?: boolean;
}

/** "Choose pages" (chunk 20a-2): path patterns; no includes means every page. */
export class PageChoiceDto {
  @ApiProperty({ type: [String], example: ['/services'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  include!: string[];

  @ApiProperty({ type: [String], example: ['/blog'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclude!: string[];
}
