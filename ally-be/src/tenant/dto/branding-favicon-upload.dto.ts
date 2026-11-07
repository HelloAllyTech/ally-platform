import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  FaviconUploadContentType,
  TENANT_BRANDING_LIMITS,
} from '../constants/tenant-branding.constants';

export class FaviconUploadRequestDto {
  @ApiProperty({ example: 'favicon.png' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    minimum: 1,
    maximum: TENANT_BRANDING_LIMITS.FAVICON_MAX_BYTES,
  })
  @IsNumber()
  @Min(1)
  @Max(TENANT_BRANDING_LIMITS.FAVICON_MAX_BYTES)
  fileSize!: number;

  @ApiProperty({
    enum: FaviconUploadContentType,
    example: FaviconUploadContentType.PNG,
    description: 'PNG, ICO, WebP or JPEG. SVG is refused.',
  })
  @IsEnum(FaviconUploadContentType)
  @IsNotEmpty()
  contentType!: FaviconUploadContentType;
}

export class FaviconUploadResponseDto {
  @ApiProperty({ description: 'Presigned PUT URL, valid 10 minutes' })
  presignedUrl!: string;

  @ApiProperty({ description: 'Public URL to send back as `faviconUrl`' })
  faviconUrl!: string;
}
