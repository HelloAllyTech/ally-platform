import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const DIAGNOSES = ['correct', 'wrong', 'not_a_bug'] as const;
export const FIX_VERDICTS = [
  'worked',
  'needed_edits',
  'wrong',
  'none',
] as const;
export type Diagnosis = (typeof DIAGNOSES)[number];
export type FixVerdict = (typeof FIX_VERDICTS)[number];

export class CreateVerdictDto {
  @ApiProperty({ enum: DIAGNOSES, description: 'Was the diagnosis right?' })
  @IsIn(DIAGNOSES as unknown as string[])
  diagnosis!: Diagnosis;

  @ApiProperty({
    enum: FIX_VERDICTS,
    description: 'Did the suggested fix work? `none` when there was no fix.',
  })
  @IsIn(FIX_VERDICTS as unknown as string[])
  fix!: FixVerdict;

  @ApiProperty({ description: 'Why, in a sentence or two. Required.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'A reason is required.' })
  @MaxLength(2000)
  reason!: string;
}

export class ListReportsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'judged', 'all'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'judged', 'all'])
  status?: 'open' | 'judged' | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  app?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;
}
