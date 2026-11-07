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

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  subtitle!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  assistantName!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(HTTPS_URL, { message: 'The avatar must be an https link' })
  @MaxLength(1000)
  avatarUrl?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  disclaimer!: string;

  @ApiPropertyOptional({ type: BotPageFooterLinkDto, nullable: true })
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

  @ApiProperty({ example: 'mehta-clinic' })
  @IsString()
  @MaxLength(48)
  slug!: string;

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
}

export class BotPageVerifyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  email!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code!: string;
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
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOT_PAGE_BOUNDS.maxMessageChars)
  message!: string;
}
