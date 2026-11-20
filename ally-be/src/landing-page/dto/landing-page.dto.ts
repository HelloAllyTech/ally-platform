import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  LANDING_LANGUAGES,
  LANDING_LIMITS,
  LANDING_SLUG_PATTERN,
  LandingLanguage,
} from '../constants/landing-page.constants';
import { LandingImageUploadContentType } from '../enum/landing-image-upload-content-type.enum';
import { LandingPageStatus } from '../enum/landing-page-status.enum';
import { LandingPageConfig } from '../type/landing-page-config.type';

export class CreateLandingPageDto {
  @ApiProperty({ description: 'Organization the page belongs to' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ description: 'Admin-facing name, never shown to visitors' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LANDING_LIMITS.PAGE_NAME)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Last segment of the public address. Built from the name when omitted. Unique within the organization.',
    example: 'baat-se-baat-banegi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LANDING_LIMITS.SLUG)
  @Matches(LANDING_SLUG_PATTERN, {
    message: 'slug may only use lowercase letters, digits and single hyphens',
  })
  slug?: string;

  @ApiProperty({
    description:
      'Languages the page offers. Every text exists once per language.',
    enum: LANDING_LANGUAGES,
    isArray: true,
    example: ['en', 'hi'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LANDING_LANGUAGES.length)
  @ArrayUnique()
  @IsEnum(LANDING_LANGUAGES, { each: true })
  languages!: LandingLanguage[];

  @ApiPropertyOptional({
    description:
      'Opens in this language. Defaults to the first of `languages`.',
    enum: LANDING_LANGUAGES,
  })
  @IsOptional()
  @IsEnum(LANDING_LANGUAGES)
  defaultLanguage?: LandingLanguage;

  @ApiPropertyOptional({
    description:
      'Whether visitors may create an account from the page. Stored only; sign-up is not built yet.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  signUpEnabled?: boolean;
}

export class UpdateLandingPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LANDING_LIMITS.PAGE_NAME)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(LANDING_LIMITS.SLUG)
  @Matches(LANDING_SLUG_PATTERN, {
    message: 'slug may only use lowercase letters, digits and single hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({
    description:
      'The whole page configuration. Replaces the draft; cleaned and validated on save.',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class GetLandingPagesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ enum: LandingPageStatus })
  @IsOptional()
  @IsEnum(LandingPageStatus)
  status?: LandingPageStatus;

  @ApiPropertyOptional({ description: 'Matches the name or slug' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UploadLandingImageRequestDto {
  @ApiProperty({ example: 'hero.png' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string;

  @ApiProperty({ enum: LandingImageUploadContentType })
  @IsEnum(LandingImageUploadContentType)
  contentType!: LandingImageUploadContentType;

  @ApiProperty({ description: 'Size in bytes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileSize!: number;

  @ApiProperty({ description: 'Organization the image is for' })
  @IsUUID()
  tenantId!: string;
}

export class UploadLandingImageResponseDto {
  @ApiProperty() presignedUrl!: string;
  @ApiProperty({
    description: 'Address to store in the page config once uploaded',
  })
  imageUrl!: string;
}

export class LandingPageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() tenantCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: LandingPageStatus }) status!: LandingPageStatus;
  @ApiProperty({ description: '/<tenant code>/<slug>' }) path!: string;
  @ApiProperty({ description: 'The draft being edited' })
  config!: LandingPageConfig;
  @ApiPropertyOptional({
    description: 'The live copy; null while the page is unpublished',
    nullable: true,
  })
  publishedConfig!: LandingPageConfig | null;
  @ApiProperty({ description: 'There are edits that are not live yet' })
  hasUnpublishedChanges!: boolean;
  @ApiPropertyOptional({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class GetLandingPagesResponseDto {
  @ApiProperty({ type: [LandingPageResponseDto] })
  items!: LandingPageResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

/** What the public page needs, and nothing else. */
export class PublicLandingPageResponseDto {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() tenantCode!: string;
  @ApiProperty({ description: 'The published configuration' })
  config!: LandingPageConfig;
  @ApiProperty({
    description:
      "The organization's public branding (name and logo), the same data /v1/public/tenants/:code/branding returns",
  })
  branding!: Record<string, unknown>;
}
