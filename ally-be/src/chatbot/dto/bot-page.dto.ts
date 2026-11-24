import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BotPageAccess,
  BotPageAccessKind,
  BotPageStatus,
  PrechatFieldType,
} from '../enum/bot-page.enum';
import { BOT_PAGE_BOUNDS, HEX_COLOUR } from '../type/bot-page.type';

const HTTPS_URL = /^https:\/\/\S+$/;

export class BotPageFooterLinkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;

  @ApiProperty({ description: 'An https link' })
  @Matches(HTTPS_URL, { message: 'The footer link must start with https://' })
  @MaxLength(500)
  url!: string;
}

export class BotPageBrandingDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(HTTPS_URL, { message: 'The logo must be an https link' })
  @MaxLength(1000)
  logoUrl?: string | null;

  @ApiProperty({ example: '#264D8E' })
  @Matches(HEX_COLOUR, { message: 'The colour must look like #264D8E' })
  accentColour!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  /** Retired in stage 7 (the welcome line replaces it); refused by the PUT when sent. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @ApiPropertyOptional({ description: 'One short welcome line (stage 7)' })
  @IsOptional()
  @IsString()
  @MaxLength(BOT_PAGE_BOUNDS.maxWelcomeChars)
  welcome?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  assistantName!: string;

  /** Retired in stage 7; refused by the PUT when sent. */
  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @Matches(HTTPS_URL, { message: 'The avatar must be an https link' })
  @MaxLength(1000)
  avatarUrl?: string | null;

  /** Retired in stage 7 (the fixed crisis notice owns it); refused by the PUT when sent. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  disclaimer?: string;

  /** Retired in stage 7; refused by the PUT when sent. */
  @ApiPropertyOptional({
    type: BotPageFooterLinkDto,
    nullable: true,
    deprecated: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BotPageFooterLinkDto)
  footerLink?: BotPageFooterLinkDto | null;
}

export class PrechatFieldDto {
  @ApiProperty({ description: 'Stable id; keep it when editing a question' })
  @Matches(/^[a-z0-9_-]{1,40}$/i)
  id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: PrechatFieldType })
  @IsEnum(PrechatFieldType)
  type!: PrechatFieldType;

  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxChoiceOptions)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  consentText?: string;
}

export class BotPageLimitsDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(BOT_PAGE_BOUNDS.maxMessagesPerVisitorPerHour)
  messagesPerVisitorPerHour!: number;

  /** Stage 7: one person's messages per day. Absent: the stored value, or the default. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BOT_PAGE_BOUNDS.maxMessagesPerVisitorPerDay)
  messagesPerVisitorPerDay?: number;

  @ApiProperty()
  @IsInt()
  @Min(50)
  @Max(BOT_PAGE_BOUNDS.maxMessageChars)
  maxMessageChars!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(BOT_PAGE_BOUNDS.maxDailyCapPerBot)
  dailyCapPerBot!: number;
}

export class BotPageSettingsDto {
  @ApiProperty({ type: BotPageBrandingDto })
  @ValidateNested()
  @Type(() => BotPageBrandingDto)
  branding!: BotPageBrandingDto;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxSuggested)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(BOT_PAGE_BOUNDS.maxSuggestedChars, { each: true })
  suggestedQuestions!: string[];

  @ApiProperty({ type: [PrechatFieldDto] })
  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxPrechat)
  @ValidateNested({ each: true })
  @Type(() => PrechatFieldDto)
  prechat!: PrechatFieldDto[];

  @ApiProperty({ type: BotPageLimitsDto })
  @ValidateNested()
  @Type(() => BotPageLimitsDto)
  limits!: BotPageLimitsDto;

  @ApiProperty({ enum: ['en', 'hi', 'auto'] })
  @IsIn(['en', 'hi', 'auto'])
  language!: 'en' | 'hi' | 'auto';
}

/** The whole page, as the Bot page tab saves it. */
export class UpdateBotPageDto {
  @ApiProperty({ enum: BotPageStatus })
  @IsEnum(BotPageStatus)
  status!: BotPageStatus;

  /**
   * Retired in stage 7: the address is assigned by Ally. Ignored by the service; the PUT refuses
   * a value that differs from the stored link (400 `address_not_editable`).
   */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  slug?: string;

  @ApiProperty({ enum: BotPageAccess })
  @IsEnum(BotPageAccess)
  access!: BotPageAccess;

  @ApiProperty({ type: BotPageSettingsDto })
  @ValidateNested()
  @Type(() => BotPageSettingsDto)
  settings!: BotPageSettingsDto;
}

export class BotPageAccessEntryDto {
  @ApiProperty({ enum: BotPageAccessKind })
  @IsEnum(BotPageAccessKind)
  kind!: BotPageAccessKind;

  @ApiProperty({ description: 'An email address, or an organisation id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  value!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class AddBotPageAccessDto {
  @ApiProperty({ type: [BotPageAccessEntryDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BotPageAccessEntryDto)
  entries!: BotPageAccessEntryDto[];
}

export class BotPageLogoUrlDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  fileSize!: number;

  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp'] })
  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  contentType!: string;
}

// ── public ──────────────────────────────────────────────────────────────

/** Where the website widget is (chunk 13): the host page's origin, as the browser reports it to the frame. */
export class BotPageEmbedDto {
  @ApiProperty({ example: 'https://sunrisemind.in' })
  @IsString()
  @MaxLength(300)
  host!: string;

  @ApiPropertyOptional({ description: 'The page the bubble is on' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  page?: string;
}

export class BotPageSessionDto {
  @ApiPropertyOptional({
    description: 'Cloudflare Turnstile token (public pages)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;

  @ApiPropertyOptional({
    description: 'Send a code to this address (organisation and invite pages)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  email?: string;

  @ApiPropertyOptional({ type: BotPageEmbedDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BotPageEmbedDto)
  embed?: BotPageEmbedDto;
}

export class BotPageVerifyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  email!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code!: string;

  @ApiPropertyOptional({ type: BotPageEmbedDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BotPageEmbedDto)
  embed?: BotPageEmbedDto;
}

export class BotPageIntakeAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  id!: string;

  @ApiProperty({ description: 'Text, or "true" for an accepted consent' })
  @IsString()
  @MaxLength(500)
  value!: string;
}

export class BotPageIntakeDto {
  @ApiProperty({ type: [BotPageIntakeAnswerDto] })
  @IsArray()
  @ArrayMaxSize(BOT_PAGE_BOUNDS.maxPrechat)
  @ValidateNested({ each: true })
  @Type(() => BotPageIntakeAnswerDto)
  answers!: BotPageIntakeAnswerDto[];
}

export class BotPageMessageDto {
  @ApiProperty({
    description: 'What the person typed, or the label of what they tapped.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOT_PAGE_BOUNDS.maxMessageChars)
  message!: string;

  @ApiPropertyOptional({
    description:
      "BT1: a tap's token (from a reply's parts). The reply answers what the tap stands for; a Confirm writes with no model call.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;
}

/** "Was this helpful?" on one answer (chunk Q2a). A reason and note only with a thumbs down. */
export class BotPageFeedbackDto {
  @ApiProperty({ enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  rating!: 'up' | 'down';

  @ApiPropertyOptional({ enum: ['wrong_info', 'not_answered', 'other'] })
  @IsOptional()
  @IsIn(['wrong_info', 'not_answered', 'other'])
  reason?: 'wrong_info' | 'not_answered' | 'other';

  @ApiPropertyOptional({
    description: 'Tell us more (optional), at most 300 characters',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
