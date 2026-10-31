import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/**
 * XP that makes one "course unit" (Sandeep, 2026-10-31). A unit is a unit of
 * learning effort, defined as a flat 100 XP, so units consumed = XP earned / 100.
 * Exported so the SQL-side maths, the DTO description and the client's help text
 * quote the same number.
 */
export const COURSE_UNIT_XP = 100;

/** One bucket of the course-units series, in raw XP. */
export interface CourseUnitsBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** All XP awarded within the bucket. */
  xp: number;
  /** Distinct learners who earned XP within the bucket. */
  learners: number;
}

/**
 * XP earned and the distinct learners behind it, per bucket, from the
 * append-only `xp_events` ledger.
 *
 * Same ledger and conventions as `ActiveUsersXpAnalyticsRepository`: bucketed on
 * `awardedOn` (the day an award counts against, so backfilled rows keep their
 * historical date), tables by name, quoted camelCase identifiers, test tenants
 * excluded. A learner counts in a bucket when their XP within it is positive.
 */
@Injectable()
export class CourseUnitsAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: never interpolate anything not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /** Left edge of an all-time window: the PLATFORM data floor, like every sibling chart. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Total XP and distinct earning learners per bucket within [start, end).
   * Buckets with no XP are ABSENT; the service puts them back on the axis.
   */
  async getCourseUnitsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<CourseUnitsBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource.query(
      `
      WITH per_user_bucket AS (
        SELECT date_trunc('${trunc}', e."awardedOn") AS bucket,
               e."userId"                             AS user_id,
               SUM(e."xp")                             AS xp
        FROM xp_events e
        WHERE e."awardedOn" >= $1
          AND e."awardedOn" < $2
          AND ${excludeTestTenants('e."tenant_id"')}
        GROUP BY bucket, e."userId"
      )
      SELECT to_char(bucket, 'YYYY-MM-DD')            AS "bucket",
             COALESCE(SUM(xp) FILTER (WHERE xp > 0), 0)::bigint AS "xp",
             COUNT(*) FILTER (WHERE xp > 0)::int       AS "learners"
      FROM per_user_bucket
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [start, end],
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: r.bucket as string,
      xp: Number(r.xp) || 0,
      learners: Number(r.learners) || 0,
    }));
  }
}
