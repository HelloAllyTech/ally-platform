import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
  ClChunkConfidence,
  ClChunkOrigin,
  ClChunkStatus,
  ClUseCase,
} from '../enum/context-library.enum';

/** Multipart fields arrive as strings; lists may come as JSON or comma-separated. */
const toList = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';
/** Absent stays absent: "not chosen" and "false" mean different things for an audience. */
const toOptionalBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : undefined;
const toJsonObject = ({ value }: { value: unknown }) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export class ContextUploadDto {
  @ApiProperty({
    type: [String],
    description: 'Target collections (JSON array or comma-separated)',
  })
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  collections!: string[];

  @ApiPropertyOptional({ description: 'JSON object: file name → title' })
  @IsOptional()
  @Transform(toJsonObject)
  @IsObject()
  titles?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  docVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  reextract?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  addAnyway?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.05)
  costCapUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description:
      'Platform admins: true for every organisation, false for only those in tenantIds. ' +
      'Omitted means global unless tenantIds names organisations.',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Organisations reached (JSON array or comma-separated ids)',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  tenantIds?: string[];
}

export class ContextAuthoredChunkDto {
  @ApiProperty()
  @IsString()
  @MaxLength(400)
  statement!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  body?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  situations?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  exampleQueries?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  topics?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  facets?: Record<string, string | string[]>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  tenantIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class ContextBulkDto {
  @ApiProperty()
  @IsString()
  collectionId!: string;

  @ApiPropertyOptional({
    description:
      'Only the exact string "true" applies; anything else is a dry run.',
  })
  @IsOptional()
  @IsString()
  apply?: string;

  @ApiPropertyOptional({
    description:
      'Platform admins: true for every organisation, false for only those in tenantIds. ' +
      'Applies to new rows that leave is_global and tenant_ids blank.',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Organisations reached (JSON array or comma-separated ids)',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  tenantIds?: string[];
}

export class ContextChunkListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  collectionId?: string;

  @ApiPropertyOptional({ enum: ClChunkStatus })
  @IsOptional()
  @IsIn(Object.values(ClChunkStatus))
  status?: ClChunkStatus;

  @ApiPropertyOptional({ enum: ClChunkOrigin })
  @IsOptional()
  @IsIn(Object.values(ClChunkOrigin))
  origin?: ClChunkOrigin;

  @ApiPropertyOptional({ enum: ClChunkConfidence })
  @IsOptional()
  @IsIn(Object.values(ClChunkConfidence))
  confidence?: ClChunkConfidence;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    description:
      '`global` for entries every learner may read, or an organisation id for the entries that ' +
      'reach that organisation (on the organisation routes, `mine` for its own).',
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^(global|mine|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    {
      message: 'audience must be "global", "mine" or an organisation id',
    },
  )
  audience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ContextGrantDto {
  @ApiProperty({ enum: ClUseCase })
  @IsIn(Object.values(ClUseCase))
  useCase!: ClUseCase;

  @ApiProperty()
  @IsString()
  collectionId!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  weight?: number;
}

export class ContextResumeDto {
  @ApiPropertyOptional({
    description: 'Raise the cost cap by this many US dollars',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  raiseCapBy?: number;
}

export class ContextSearchDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  query!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  collectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  explain?: boolean;

  @ApiPropertyOptional({ description: 'Run the graded re-rank (slower)' })
  @IsOptional()
  @IsBoolean()
  rerank?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ContextLoopSettingsDto {
  @ApiPropertyOptional({
    description: 'Share of live searches the judge grades, 0–1',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  judgeSampleRate?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Loops switched off for this collection',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paused?: string[];
}

/** Retiring a Knowledge Base corpus deletes it; the body must repeat the exact phrase. */
export class ContextRetireCorpusDto {
  @ApiProperty({
    description:
      'Exactly "retire <corpus>" — "retire character_library", "retire ally_guide_library" or ' +
      '"retire debrief_knowledge", matching the route. Anything else deletes nothing.',
    example: 'retire character_library',
  })
  @IsString()
  @MaxLength(80)
  confirm!: string;
}

/** Who a chunk, or a document's chunks, reaches. Platform admins only. */
export class ContextAudienceDto {
  @ApiProperty({
    description:
      'true for every organisation; false for only those in tenantIds',
  })
  @IsBoolean()
  isGlobal!: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  tenantIds?: string[];
}
