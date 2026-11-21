import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const SECURITY_SIGNAL_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
] as const;
export type SecuritySignalSeverity =
  (typeof SECURITY_SIGNAL_SEVERITIES)[number];

export class SecuritySignalFindingDto {
  @ApiProperty({ enum: SECURITY_SIGNAL_SEVERITIES })
  @IsIn(SECURITY_SIGNAL_SEVERITIES)
  severity!: SecuritySignalSeverity;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'Service folder, e.g. ally-be' })
  @IsString()
  @MaxLength(40)
  service!: string;

  @ApiProperty({ description: 'Repo-relative path of the file at fault' })
  @IsString()
  @MaxLength(300)
  file!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  line?: number;

  @ApiProperty({ description: 'What is wrong, in plain words' })
  @IsString()
  @MaxLength(1500)
  what!: string;

  @ApiPropertyOptional({ description: 'Who could do what' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  impact?: string;

  @ApiPropertyOptional({ description: 'The smallest concrete fix' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  fix?: string;
}

export class IngestSecuritySignalsDto {
  @ApiProperty({ type: [SecuritySignalFindingDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SecuritySignalFindingDto)
  findings!: SecuritySignalFindingDto[];

  @ApiPropertyOptional({ description: 'Link to the private audit run/issue' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  runUrl?: string;
}

export interface IngestSecuritySignalsResult {
  created: number;
  refreshed: number;
  skippedDismissed: number;
  skippedLowSeverity: number;
}
