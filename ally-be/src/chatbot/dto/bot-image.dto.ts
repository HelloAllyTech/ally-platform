import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { BotImageKind } from '../entity/bot-image.entity';
import {
  BOT_PAGE_BOUNDS,
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
 * Look fields retired in stage 7. Stored values stay (inert); a request that sends any of them is
 * refused (400 `look_field_retired`), so a stale client can't silently think it changed them.
 */
export const RETIRED_BRAND_FIELDS = [
  'headingStyle',
  'theme',
  'coverImage',
  'shareImage',
  'landingImages',
  'peoplePhotos',
] as const;

/**
 * A change to the page's look: only the fields sent change. Since stage 7 the look is the name
 * (the assistant's name field), the logo, one accent colour and a short welcome line. `logo` is a
 * `bot_images` id of this bot (null removes). `accentContrast` is computed, never accepted.
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

  @ApiPropertyOptional({ description: 'One short welcome line (stage 7)' })
  @IsOptional()
  @IsString()
  @MaxLength(BOT_PAGE_BOUNDS.maxWelcomeChars)
  welcome?: string;
}
