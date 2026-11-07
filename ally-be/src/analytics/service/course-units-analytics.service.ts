import { Injectable } from '@nestjs/common';

import { GoalsXpAnalyticsRepository } from '../repository/goals-xp-analytics.repository';

import {
  COURSE_UNIT_XP,
  CourseUnitsAnalyticsRepository,
  CourseUnitsBucketRow,
} from '../repository/course-units-analytics.repository';
import {
  CourseUnitsPointDto,
  CourseUnitsQueryDto,
  CourseUnitsResponseDto,
} from '../dto/course-units-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** A year of months by default — the chart is read as "units per month". */
const DEFAULT_RANGE: AnalyticsRange = '12m';

const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' || range === 'all' ? 'month' : 'week';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Course units consumed, for Highlights → Goals. A course unit is
 * {@link COURSE_UNIT_XP} XP, so units = XP earned / 100. The learners column is
 * what separates "more people" from "the same people doing more", and the
 * average is the ratio of the two. Where an XP goal exists for the period
 * (month and year), its target is the goal / 100.
 */
@Injectable()
export class CourseUnitsAnalyticsService {
  constructor(
    private readonly repository: CourseUnitsAnalyticsRepository,
    private readonly goalsRepository: GoalsXpAnalyticsRepository,
  ) {}

  async getCourseUnits(
    query: CourseUnitsQueryDto,
  ): Promise<CourseUnitsResponseDto> {
    const range = query.range ?? DEFAULT_RANGE;
    const isAllTime = range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(
      { range, bucket: query.bucket, from: query.from, to: query.to },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const rows = await this.repository.getCourseUnitsByBucket(
      window.start,
      window.endExclusive,
      window.bucket,
    );

    // Targets are the XP goals already configured for the Utilization chart,
    // divided by the unit size — never configured separately here.
    const goals =
      window.bucket === 'month' || window.bucket === 'year'
        ? await this.goalsRepository.getGoalsByGrain(window.bucket)
        : new Map<string, number>();

    return {
      window: describeWindow(window),
      unitXp: COURSE_UNIT_XP,
      points: this.buildPoints(rows, window, goals),
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /** Gap-free series: every bucket in the window, absent ones a real zero. */
  private buildPoints(
    rows: CourseUnitsBucketRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
    goals: Map<string, number>,
  ): CourseUnitsPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => {
      const row = byBucket.get(bucket);
      const xp = row?.xp ?? 0;
      const learners = row?.learners ?? 0;
      const goalXp = goals.get(bucket);
      return {
        bucket,
        targetUnits:
          goalXp === undefined ? null : round2(goalXp / COURSE_UNIT_XP),
        units: round2(xp / COURSE_UNIT_XP),
        learners,
        avgUnitsPerLearner:
          learners > 0 ? round2(xp / COURSE_UNIT_XP / learners) : null,
      };
    });
  }
}
