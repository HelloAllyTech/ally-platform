import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const NAME_MAX = 200;
export const NOTES_MAX = 10000;
export const LOG_MAX = 10000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---- Requests ----------------------------------------------------------------

export class ListContactsDto {
  @ApiPropertyOptional({
    description: 'Matches name, organization or job title (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  search?: string;

  @ApiPropertyOptional({ description: 'Default 200, at most 500' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class MatchContactsDto {
  @ApiProperty({ description: 'The name being typed, for the duplicate check' })
  @IsString()
  @MaxLength(NAME_MAX)
  name!: string;
}

export class CreateContactDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NAME_MAX)
  organization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'A user id from GET /v1/crm/managers; null leaves it unassigned',
  })
  @IsOptional()
  @IsInt()
  relationshipManagerId?: number | null;
}

export class UpdateContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NAME_MAX)
  organization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({ description: 'null clears the relationship manager' })
  @IsOptional()
  @IsInt()
  relationshipManagerId?: number | null;
}

export class CreateContactLogDto {
  @ApiProperty({ description: 'What happened, in plain words' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOG_MAX)
  summary!: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD; defaults to today' })
  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;
}

export class UpdateContactLogDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOG_MAX)
  summary?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;
}

// ---- Responses ---------------------------------------------------------------

export class ContactManagerDto {
  @ApiProperty() userId!: number;
  @ApiProperty() name!: string;
}

export class ContactDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ nullable: true }) organization!: string | null;
  @ApiProperty({ nullable: true }) jobTitle!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) relationshipManagerId!: number | null;
  @ApiProperty({ nullable: true }) relationshipManagerName!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({
    description: 'YYYY-MM-DD of the latest log, if any',
    nullable: true,
  })
  lastLoggedOn!: string | null;
  @ApiProperty() logCount!: number;
}

export class ContactLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() contactId!: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) occurredOn!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ nullable: true }) authorId!: number | null;
  @ApiProperty({ nullable: true }) authorName!: string | null;
  @ApiProperty() createdAt!: string;
}

export class ContactListDto {
  @ApiProperty({ type: [ContactDto] }) contacts!: ContactDto[];
}

export class ContactDetailDto extends ContactDto {
  @ApiProperty({ type: [ContactLogDto], description: 'Newest first' })
  logs!: ContactLogDto[];
}

export class ContactManagersDto {
  @ApiProperty({ type: [ContactManagerDto] }) managers!: ContactManagerDto[];
}
