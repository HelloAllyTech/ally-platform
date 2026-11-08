import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BotImageKind } from '../bot-image/bot-image.entity';
import {
  BRAND_THEMES,
  BrandTheme,
  HEADING_STYLES,
  HeadingStyle,
  HEX_COLOUR,
  MAX_GALLERY_IMAGES,
} from '../type/bot-page.type';

export class UploadBotImageDto {
  @ApiProperty({ enum: BotImageKind })
  @IsEnum(BotImageKind)
  kind!: BotImageKind;

  @ApiPropertyOptional({
    description: 'Alt text; a default is used when empty',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  alt?: string;
}

export class UpdateBotImageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  alt!: string;
}

export class BotPageLandingImagesDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  hero?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GALLERY_IMAGES)
  @IsUUID('all', { each: true })
  gallery?: string[];
}

/**
 * A change to the page's look (chunk 20d): only the fields sent change. Image fields are
 * `bot_images` ids of this bot (null removes). `accentContrast` is computed, never accepted.
 */
export class UpdateBotPageBrandDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  logo?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#C4512D' })
  @IsOptional()
  @Matches(HEX_COLOUR, { message: 'The colour must look like #264D8E' })
  accent?: string | null;

  @ApiPropertyOptional({ enum: HEADING_STYLES })
  @IsOptional()
  @IsIn(HEADING_STYLES as unknown as string[])
  headingStyle?: HeadingStyle;

  @ApiPropertyOptional({ enum: BRAND_THEMES })
  @IsOptional()
  @IsIn(BRAND_THEMES as unknown as string[])
  theme?: BrandTheme;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  coverImage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  shareImage?: string | null;

  @ApiPropertyOptional({ type: BotPageLandingImagesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BotPageLandingImagesDto)
  landingImages?: BotPageLandingImagesDto;

  @ApiPropertyOptional({ description: "A team member's name → image id" })
  @IsOptional()
  @IsObject()
  peoplePhotos?: Record<string, string>;
}
