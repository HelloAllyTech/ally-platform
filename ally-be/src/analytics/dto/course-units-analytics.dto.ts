import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import { COURSE_UNIT_XP } from '../repository/course-units-analytics.repository';

/**
 * Standard window params. No `tenantId`: a platform-wide leadership chart,
 * matching the other Highlights → Goals charts — see
 * {@link CourseUnitsResponseDto.scoping}.
 */
export class CourseUnitsQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the course-units series. */
export class CourseUnitsPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Course units consumed in the bucket: XP earned / ' +
      `${COURSE_UNIT_XP}, to two decimals.`,
  })
  units!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Course-unit target for the bucket: the XP goal already configured in ' +
      `analytics_xp_goals, / ${COURSE_UNIT_XP}, to two decimals. Null, not 0, ` +
      'when no goal is set for the period, and always null at day and week ' +
      'grain (goals exist per month, quarter and year only).',
  })
  targetUnits!: number | null;

  @ApiProperty({
    description:
      'Distinct learners who earned XP within the bucket — the headcount ' +
      'behind `units`. A bucket with no XP is a real zero, not a gap.',
  })
  learners!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Average course units per learner (`units / learners`, two decimals). ' +
      'Null, not 0, when nobody earned XP — there is no average of nobody.',
  })
  avgUnitsPerLearner!: number | null;
}

/** Course units consumed per period, with the learners behind them. */
export class CourseUnitsResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'XP that makes one course unit.',
  })
  unitXp!: number;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis: a bucket with no XP is present with ' +
      '`units: 0`, `learners: 0` rather than omitted.',
    type: [CourseUnitsPointDto],
  })
  points!: CourseUnitsPointDto[];

  @ApiProperty({
    description:
      'Always platform-wide (tenantId null) — this chart has no tenant filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
