import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TrimStringTransform } from 'src/common/util/string-transform.util';
import { ImageSlotKind } from '../constants/image-slots.constants';
import {
  IMAGE_STUDIO_DESCRIPTION_MAX,
  IMAGE_STUDIO_MAX_BATCH,
  IMAGE_STUDIO_MAX_VARIANTS,
} from '../constants/image-studio.constants';

export class ImagePersonaDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() age?: number | string;
  @IsOptional() @IsString() @MaxLength(100) gender?: string;
  @IsOptional() @IsString() @MaxLength(200) profession?: string;
  @IsOptional() @IsString() @MaxLength(300) currentLocation?: string;
  @IsOptional() @IsString() @MaxLength(500) appearance?: string;
}

/** The content around the slot; everything optional, send what the slot has. */
export class ImageContextDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ description: 'Body, question stem or scene text' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  courseTitle?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  audience?: string;

  @ApiPropertyOptional({ type: () => ImagePersonaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImagePersonaDto)
  persona?: ImagePersonaDto;

  /** Ids of where the image goes, for history and analytics. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  itemId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nodeId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  scenarioId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  characterId?: string;
}

export class ImageSafetyDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() suggestion?: string;
}

export class DescribeImageRequestDto {
  @ApiProperty({ enum: ImageSlotKind })
  @IsEnum(ImageSlotKind)
  slotKind!: ImageSlotKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  styleId?: string;

  @ApiPropertyOptional({ type: () => ImageContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageContextDto)
  context?: ImageContextDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  castCharacterIds?: string[];
}

export class DescribeImageResponseDto {
  @ApiProperty() description!: string;
  @ApiProperty() altText!: string;
  @ApiProperty({ type: () => ImageSafetyDto }) safety!: ImageSafetyDto;
}

export class ImageReferenceInputDto {
  @ApiProperty({ enum: ['character', 'setting', 'style', 'previous'] })
  @IsIn(['character', 'setting', 'style', 'previous'])
  role!: 'character' | 'setting' | 'style' | 'previous';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ description: 'A generated_images id' })
  @IsOptional()
  @IsUUID('all')
  imageId?: string;

  @ApiPropertyOptional({
    description: 'An image already in our S3 buckets; any other URL is refused',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

export class RefineImageInputDto {
  @ApiProperty() @IsUUID('all') imageId!: string;

  @ApiProperty()
  @Transform(TrimStringTransform)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  instruction!: string;
}

export class GenerateImageRequestDto {
  @ApiProperty({ enum: ImageSlotKind })
  @IsEnum(ImageSlotKind)
  slotKind!: ImageSlotKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  slotKey?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  styleId!: string;

  @ApiProperty({ minLength: 3, maxLength: IMAGE_STUDIO_DESCRIPTION_MAX })
  @Transform(TrimStringTransform)
  @IsString()
  @MinLength(3)
  @MaxLength(IMAGE_STUDIO_DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: IMAGE_STUDIO_MAX_VARIANTS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(IMAGE_STUDIO_MAX_VARIANTS)
  variants?: number;

  @ApiPropertyOptional({ type: () => [ImageReferenceInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ImageReferenceInputDto)
  references?: ImageReferenceInputDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  castCharacterIds?: string[];

  @ApiPropertyOptional({ type: () => RefineImageInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RefineImageInputDto)
  refine?: RefineImageInputDto;

  @ApiPropertyOptional({ type: () => ImageContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageContextDto)
  context?: ImageContextDto;
}

export class GenerateImageBatchRequestDto {
  @ApiProperty({ type: () => [GenerateImageRequestDto] })
  @IsArray()
  @ArrayMaxSize(IMAGE_STUDIO_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => GenerateImageRequestDto)
  items!: GenerateImageRequestDto[];
}

export class EstimateImagesRequestDto {
  @ApiPropertyOptional({ type: () => [GenerateImageRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(IMAGE_STUDIO_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => GenerateImageRequestDto)
  items?: GenerateImageRequestDto[];

  @ApiPropertyOptional({ enum: ImageSlotKind })
  @IsOptional()
  @IsEnum(ImageSlotKind)
  slotKind?: ImageSlotKind;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(80) count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  references?: number;
}

export class EstimateImagesResponseDto {
  @ApiProperty() images!: number;
  @ApiProperty() perImageUsd!: number;
  @ApiProperty() totalUsd!: number;
}

export class AcceptImageRequestDto {
  @ApiPropertyOptional({
    description:
      'The course the image was accepted into: becomes its style example when it has none',
  })
  @IsOptional()
  @IsUUID('all')
  trackId?: string;
}

export class GetJobsQueryDto {
  @ApiProperty({ description: 'Comma-separated generated image ids (≤ 80)' })
  @IsString()
  @MaxLength(80 * 37)
  ids!: string;
}

export class GetHistoryQueryDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) slotKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}

export class GetCastSheetsQueryDto {
  @ApiProperty({ description: 'Comma-separated character ids' })
  @IsString()
  @MaxLength(20 * 37)
  characterIds!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(48) styleId!: string;
}

export class ImageCheckDto {
  @ApiProperty() passed!: boolean;
  @ApiProperty({ type: [String] }) issues!: string[];
}

export class GeneratedImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() batchId!: string;
  @ApiProperty({ enum: ImageSlotKind }) slotKind!: string;
  @ApiProperty() styleId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() altText!: string;
  @ApiProperty({ enum: ['queued', 'running', 'succeeded', 'failed'] })
  status!: 'queued' | 'running' | 'succeeded' | 'failed';
  @ApiPropertyOptional() imageUrl?: string;
  @ApiPropertyOptional() width?: number;
  @ApiPropertyOptional() height?: number;
  @ApiPropertyOptional() error?: string;
  @ApiPropertyOptional({ type: () => ImageCheckDto }) check?: ImageCheckDto;
  @ApiProperty({ type: [String] }) referenceIds!: string[];
  @ApiPropertyOptional() refinedFromId?: string;
  @ApiPropertyOptional() characterId?: string;
  @ApiPropertyOptional() costUsd?: number;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() finishedAt?: string;
  @ApiPropertyOptional() acceptedAt?: string;
}

export class GenerateImagesResponseDto {
  @ApiProperty() batchId!: string;
  @ApiProperty({ type: () => [GeneratedImageDto] })
  images!: GeneratedImageDto[];
}

export class ImageStyleDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['photo', 'illustration'] }) kind!:
    | 'photo'
    | 'illustration';
  @ApiProperty() thumbnailUrl!: string;
  @ApiProperty({ type: [String] }) swatch!: [string, string];
  @ApiProperty({ enum: ImageSlotKind, isArray: true })
  recommendedSlots!: string[];
}

export class ImageSlotProfileDto {
  @ApiProperty({ enum: ImageSlotKind }) kind!: string;
  @ApiProperty() label!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty() aspectRatio!: string;
  @ApiProperty() allowsReferences!: boolean;
  @ApiProperty() defaultStyleId!: string;
  @ApiProperty() defaultVariants!: number;
}

export class ImageStudioConfigDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() maxVariants!: number;
  @ApiProperty() maxReferences!: number;
  @ApiProperty() maxBatch!: number;
}

export class CastSheetDto {
  @ApiProperty() characterId!: string;
  @ApiProperty() styleId!: string;
  @ApiProperty({ type: () => GeneratedImageDto }) image!: GeneratedImageDto;
}

/** Keeps a context object a plain record for jsonb storage. */
export const IsPlainContext = IsObject;
