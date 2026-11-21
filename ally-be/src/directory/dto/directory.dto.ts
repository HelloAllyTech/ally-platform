import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DirectoryVisibility } from '../entity/directory-entry.entity';

const HTTP_URL = /^https?:\/\/\S+$/i;
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/;

export class UpsertDirectoryEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @ApiPropertyOptional({ description: 'http(s) link, or empty' })
  @IsOptional()
  @Matches(HTTP_URL, {
    message: 'The website must start with http:// or https://',
  })
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: DirectoryVisibility })
  @IsOptional()
  @IsEnum(DirectoryVisibility)
  visibility?: DirectoryVisibility;
}

/** Same fields; on PATCH every one is optional and `title` may not be blank. */
export class PatchDirectoryEntryDto extends UpsertDirectoryEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare title: string;
}

export class DirectoryCollectionSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  tagline?: string;

  @ApiPropertyOptional({ description: '#RRGGBB' })
  @IsOptional()
  @Matches(HEX_COLOUR, { message: 'The accent colour must be like #4338CA' })
  accentColor?: string;

  @ApiPropertyOptional({ enum: ['grid', 'list'] })
  @IsOptional()
  @IsIn(['grid', 'list'])
  layout?: 'grid' | 'list';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showSearch?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showCategoryFilter?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showContactDetails?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerNote?: string;
}

export class CreateDirectoryCollectionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class PatchDirectoryCollectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Lowercase letters, digits and hyphens, 3 to 48 characters',
  })
  @IsOptional()
  @Matches(SLUG, {
    message:
      'The page address can use lowercase letters, digits and hyphens (3 to 48 characters)',
  })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ type: DirectoryCollectionSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DirectoryCollectionSettingsDto)
  settings?: DirectoryCollectionSettingsDto;
}

export class SetDirectoryDomainDto {
  @ApiProperty({ description: 'A hostname such as resources.example.org' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  domain!: string;
}
