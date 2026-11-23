import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ANALYTICS_RANGES, AnalyticsRange } from './platform-analytics.dto';
import {
  CHART_GROUPS,
  CHART_SHAPES,
  CHART_TYPES,
  ChartGroup,
  ChartScope,
  ChartShape,
  ChartSize,
  ChartType,
} from '../constants/tenant-chart-library.constants';
import {
  SCOPE_KINDS,
  ScopeKind,
} from '../repository/tenant-scope-options.repository';
import { ChartAvailabilityState } from '../util/tenant-chart-library.util';

export class TenantChartFilterDto {
  @ApiProperty({ enum: ['course', 'simulation', 'learner'] })
  key!: 'course' | 'simulation' | 'learner';
  @ApiProperty() required!: boolean;
}

export class TenantChartLibraryEntryDto {
  @ApiProperty({ description: 'Stable id, for example TSQ-001' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'The question the chart answers' })
  question!: string;
  @ApiProperty({ enum: CHART_GROUPS }) group!: ChartGroup;
  @ApiProperty({ enum: CHART_SHAPES }) shape!: ChartShape;
  @ApiProperty({ enum: CHART_TYPES }) chart!: ChartType;
  @ApiProperty({ enum: ['s', 'm', 'wide'] }) size!: ChartSize;
  @ApiProperty({
    isArray: true,
    enum: ['organisation', 'course', 'simulation', 'learner'],
    description: 'What the chart can be drawn for',
  })
  scopes!: ChartScope[];
  @ApiProperty({
    type: () => [TenantChartFilterDto],
    description:
      'The filters the card offers. A required filter means the card has no unfiltered view.',
  })
  filters!: TenantChartFilterDto[];
  @ApiProperty({ enum: ['available', 'sparse', 'unavailable'] })
  state!: ChartAvailabilityState;
  @ApiProperty({
    nullable: true,
    description: 'Why the chart is sparse or unavailable; null when available',
  })
  reason!: string | null;
}

export class TenantChartLibraryResponseDto {
  @ApiProperty({
    description:
      'Whether the new Statistics page is switched on for this tenant. When false the client keeps the existing page and `charts` is empty.',
  })
  enabled!: boolean;

  @ApiProperty({ type: [TenantChartLibraryEntryDto] })
  charts!: TenantChartLibraryEntryDto[];
}

export class TenantCapabilitiesResponseDto {
  @ApiProperty({ description: 'Counts that decide which charts are available' })
  capabilities!: Record<string, number>;
}

export class TenantChartQueryDto {
  @ApiProperty({
    enum: ANALYTICS_RANGES,
    default: '90d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    required: false,
    description: 'Table charts only: case-insensitive name filter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({
    required: false,
    description:
      'IANA time zone for charts that group by time of day, for example Asia/Kolkata. Defaults to UTC.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/, {
    message: 'timezone must look like Asia/Kolkata',
  })
  timezone?: string;

  @ApiProperty({
    required: false,
    description:
      'Draw the chart for one simulation. Only for charts whose scopes include "simulation".',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  scenarioId?: number;

  @ApiProperty({
    required: false,
    description:
      'Draw the chart for one course. Only for charts whose scopes include "course".',
  })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiProperty({
    required: false,
    description:
      'Draw the chart for one learner. Only for charts whose scopes include "learner".',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  learnerId?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class TenantChartScopeDto {
  @ApiProperty({ enum: SCOPE_KINDS }) kind!: ScopeKind;
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'The course, simulation or learner name' })
  label!: string;
}

export class TenantChartDataResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['available', 'sparse'] })
  state!: Exclude<ChartAvailabilityState, 'unavailable'>;
  @ApiProperty({
    description:
      'Chart data. Its shape depends on the chart: see the chart’s `shape` in the library.',
  })
  data!: unknown;

  @ApiProperty({
    required: false,
    type: TenantChartScopeDto,
    description:
      'What the chart was drawn for, when it was not the whole organisation',
  })
  scope?: TenantChartScopeDto;
  @ApiProperty({
    required: false,
    type: () => [TenantChartScopeDto],
    description: 'Every filter the chart was drawn with, with names',
  })
  filters?: TenantChartScopeDto[];
}

export class TenantScopeOptionsQueryDto {
  @ApiProperty({ enum: SCOPE_KINDS })
  @IsIn(SCOPE_KINDS)
  kind!: ScopeKind;

  @ApiProperty({ required: false, description: 'Case-insensitive name filter' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class TenantScopeOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}
