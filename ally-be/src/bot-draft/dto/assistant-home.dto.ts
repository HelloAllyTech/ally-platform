import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  ValidateNested,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { HOME_FIELDS } from '../home/home-fields';
import { ListChange } from '../home/home-lists';

const VERSION = /^[0-9a-f]{16}$/;

export class SaveHomeFieldDto {
  @ApiProperty({ enum: Object.keys(HOME_FIELDS) })
  @IsIn(Object.keys(HOME_FIELDS))
  field!: string;

  @ApiProperty({ description: 'The new value; its shape depends on the field' })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    description: 'The version of the value this edit started from',
  })
  @Matches(VERSION)
  version!: string;
}

export class ChangeRuleDto {
  @ApiProperty({ enum: ['add', 'edit', 'remove'] })
  @IsIn(['add', 'edit', 'remove'])
  op!: 'add' | 'edit' | 'remove';

  @ApiPropertyOptional({
    description: '`own-<n>`; a `pack-<n>` rule is refused',
  })
  @ValidateIf((dto: ChangeRuleDto) => dto.op !== 'add')
  @Matches(/^(own|pack)-\d{1,3}$/)
  id?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: ChangeRuleDto) => dto.op !== 'remove')
  @IsString()
  @MaxLength(400)
  text?: string;

  @ApiProperty()
  @Matches(VERSION)
  version!: string;
}

export class ChangeListDto {
  @ApiProperty({ enum: ['add', 'edit', 'remove', 'reorder'] })
  @IsIn(['add', 'edit', 'remove', 'reorder'])
  op!: ListChange['op'];

  @ApiPropertyOptional({ description: 'The entry an edit or remove is about' })
  @ValidateIf((dto: ChangeListDto) => dto.op === 'edit' || dto.op === 'remove')
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional({ description: "What to add, or an edit's fields" })
  @IsOptional()
  @IsObject()
  item?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Quick replies: the new order' })
  @ValidateIf((dto: ChangeListDto) => dto.op === 'reorder')
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];

  @ApiProperty({
    description: 'The version of the list this change started from',
  })
  @Matches(VERSION)
  version!: string;
}

export class ProposeChangeDto {
  @ApiProperty() @IsString() @MaxLength(1000) request!: string;
}

export class ProposedChangeDto {
  @ApiProperty()
  @IsIn([
    'assistant_name',
    'introduction',
    'tone',
    'instructions',
    'decline_text',
    'suggested_questions',
    'language',
    'add_rule',
    'avoid_topic',
  ])
  field!: string;

  @ApiPropertyOptional() before?: unknown;

  @ApiProperty() @IsDefined() after!: unknown;
}

export class ApplyChangeDto {
  @ApiProperty({ type: [ProposedChangeDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProposedChangeDto)
  changes!: ProposedChangeDto[];
}

export class SourceUrlDto {
  @ApiProperty() @IsString() @MaxLength(2000) url!: string;
}

export class CorrectFactDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  text!: string;

  @ApiProperty({
    description: "The version of the fact's text this correction started from",
  })
  @Matches(VERSION)
  version!: string;
}
