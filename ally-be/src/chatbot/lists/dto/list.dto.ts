import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CollectionSettings } from '../../entity/collection.entity';
import type { CollectionFieldPrivacy } from '../../entity/collection-field.entity';
import { ListConstraintKind, ListFieldType } from '../../enum/list.enum';

/**
 * The owner API's bodies (chunk 5a). They check shapes only: the lists engine checks keys, values
 * and rules, and answers with a refusal `{ code, field?, message, conflict? }`.
 */
export class ListFieldDto {
  @ApiProperty({
    example: 'starts_at',
    description: 'Lower case, digits and _, at most 40',
  })
  @IsString()
  @MaxLength(40)
  key!: string;

  @ApiProperty({ example: 'Starts at' })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ enum: ListFieldType })
  @IsEnum(ListFieldType)
  type!: ListFieldType;

  @ApiPropertyOptional({
    description:
      "select: { values: [...] }; relation: { to: 'contact' | '<list key>' }; money: { currency }",
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ description: 'A value of the field’s type' })
  @IsOptional()
  default?: unknown;

  @ApiPropertyOptional({ example: { never_store: false, masked: true } })
  @IsOptional()
  @IsObject()
  privacy?: CollectionFieldPrivacy;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  agent_read?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  agent_write?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}

export class UpdateListFieldDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    enum: ListFieldType,
    description: 'Refused while any entry has a value for the field',
  })
  @IsOptional()
  @IsEnum(ListFieldType)
  type?: ListFieldType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  default?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  privacy?: CollectionFieldPrivacy;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  agent_read?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  agent_write?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}

export class CreateListDto {
  @ApiProperty({
    example: 'appointments',
    description: 'Lower case, digits and _, at most 40',
  })
  @IsString()
  @MaxLength(40)
  key!: string;

  @ApiProperty({ example: 'Appointments' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: {
      title_field: 'slot',
      default_sort: 'slot',
      person_field: 'client',
    },
  })
  @IsOptional()
  @IsObject()
  settings?: CollectionSettings;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  agent_read?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  agent_write?: boolean;

  @ApiPropertyOptional({ type: [ListFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ListFieldDto)
  fields?: ListFieldDto[];
}

export class UpdateListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Replaces the settings as a whole' })
  @IsOptional()
  @IsObject()
  settings?: CollectionSettings;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  agent_read?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  agent_write?: boolean;
}

export class AddListRuleDto {
  @ApiProperty({ enum: ListConstraintKind })
  @IsEnum(ListConstraintKind)
  kind!: ListConstraintKind;

  @ApiProperty({
    example: {
      fields: ['slot'],
      where: { field: 'status', not_in: ['cancelled'] },
    },
  })
  @IsObject()
  config!: Record<string, unknown>;
}

export class ListFilterDto {
  @ApiProperty()
  @IsString()
  field!: string;

  @ApiProperty({ enum: ['eq', 'contains', 'from', 'to'] })
  @IsIn(['eq', 'contains', 'from', 'to'])
  op!: 'eq' | 'contains' | 'from' | 'to';

  @ApiProperty()
  value!: unknown;
}

export class QueryListRecordsDto {
  @ApiPropertyOptional({ type: [ListFilterDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ListFilterDto)
  filters?: ListFilterDto[];

  @ApiPropertyOptional({ example: '-starts_at' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: 'sum:price',
    description: "'count' or 'sum:<key>'",
  })
  @IsOptional()
  @IsString()
  aggregate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  include_deleted?: boolean;

  @ApiPropertyOptional({
    description:
      'Entries where any text, phone, email or web address detail contains this (chunk 5b)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class ListRecordDto {
  @ApiProperty({ example: { slot: '<a slot id>', client: '<a contact id>' } })
  @IsObject()
  data!: Record<string, unknown>;
}

export class UpdateListRecordDto extends ListRecordDto {
  @ApiProperty({ description: 'The version you read; a stale one is refused' })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ImportListDto {
  @ApiPropertyOptional({
    description: "'true' writes the valid rows; otherwise a dry run",
  })
  @IsOptional()
  @IsString()
  commit?: string;
}

// ---- chunk 5b ------------------------------------------------------------------------------------

export class InstallReadyMadeDto {
  @ApiPropertyOptional({
    description:
      "The 'your services' options to install with, by list and field: { appointments: { service: ['Haircut'] } }",
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, Record<string, string[]>>;
}

export class RepeatListRecordsDto {
  @ApiProperty({ example: 'starts_at', description: 'A date-and-time field' })
  @IsString()
  field!: string;

  @ApiProperty({ example: [1, 2, 3, 4, 5], description: '1 Monday … 7 Sunday' })
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days!: number[];

  @ApiProperty({ example: '10:00' })
  @IsString()
  start!: string;

  @ApiProperty({
    example: '17:00',
    description: 'No entry starts at or after it',
  })
  @IsString()
  end!: string;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(5)
  @Max(720)
  every_minutes!: number;

  @ApiPropertyOptional({
    example: '2026-11-16',
    description: 'Today if left out',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ example: '2026-11-20', description: 'The last day, included' })
  @IsString()
  until!: string;

  @ApiPropertyOptional({
    example: { practitioner: 'Dr Mehta' },
    description: 'Other details for every entry it adds',
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Count only: nothing is added' })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

const ABILITY = ['do_it', 'never'] as const;

export class ListAbilitiesDto {
  @ApiPropertyOptional({ enum: ABILITY })
  @IsOptional()
  @IsIn(ABILITY)
  find?: 'do_it' | 'never';

  @ApiPropertyOptional({ enum: ABILITY })
  @IsOptional()
  @IsIn(ABILITY)
  create?: 'do_it' | 'never';

  @ApiPropertyOptional({ enum: ABILITY })
  @IsOptional()
  @IsIn(ABILITY)
  update?: 'do_it' | 'never';
}
