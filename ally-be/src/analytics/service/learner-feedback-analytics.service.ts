import { Injectable } from '@nestjs/common';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  LEARNER_FEEDBACK_DEFAULT_LIMIT,
  LearnerFeedbackQueryDto,
  LearnerFeedbackResponseDto,
  LearnerFeedbackSummaryDto,
} from '../dto/learner-feedback-analytics.dto';
import {
  LearnerFeedbackAnalyticsRepository,
  LearnerFeedbackStarRow,
} from '../repository/learner-feedback-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const PROVENANCE =
  "The learner's own 1-5 rating after a roleplay, and the comment they wrote " +
  'with it (scenario_session_feedbacks), latest per session. Every countable ' +
  'session is included, also those that ended with no conversation, so ' +
  'counts can run slightly above the Average rating chart, which reads ' +
  'completed sessions only. Windowed on when the session ended. Preview and ' +
  'seed rooms and test organisations are excluded.';

/** Parse `1,2,5` into distinct star values; the DTO has already validated it. */
export function parseRatings(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const stars = [...new Set(raw.split(',').map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    .sort((a, b) => a - b);
  return stars.length ? stars : undefined;
}

/**
 * The window summary from per-star counts: all five stars always present, so
 * a star nobody gave reads as 0 rather than disappearing from the strip.
 */
export function summariseStars(
  rows: LearnerFeedbackStarRow[],
): LearnerFeedbackSummaryDto {
  const byStar = new Map(rows.map((r) => [r.rating, r]));
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: byStar.get(rating)?.count ?? 0,
    withComment: byStar.get(rating)?.withComment ?? 0,
  }));
  const ratings = distribution.reduce((sum, d) => sum + d.count, 0);
  const withComment = distribution.reduce((sum, d) => sum + d.withComment, 0);
  const starTotal = distribution.reduce(
    (sum, d) => sum + d.rating * d.count,
    0,
  );
  return {
    ratings,
    withComment,
    avgRating: ratings ? Math.round((starTotal / ratings) * 100) / 100 : null,
    distribution,
  };
}

/**
 * What learners said about their roleplays, as a reviewable feed.
 *
 * The numbers elsewhere on Analytics say how satisfied learners are; this is
 * the one place their own words are readable. It reports individual ratings,
 * so it carries no sample floor — a single comment is the unit being read,
 * not an aggregate that could be over-read.
 */
@Injectable()
export class LearnerFeedbackAnalyticsService {
  constructor(
    private readonly repository: LearnerFeedbackAnalyticsRepository,
  ) {}

  /** Buckets do not drive anything here; the window util still wants one. */
  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '30d') return 'day';
    if (range === '90d') return 'week';
    return 'month';
  }

  async getLearnerFeedback(
    query: LearnerFeedbackQueryDto,
  ): Promise<LearnerFeedbackResponseDto> {
    const needsFloor =
      (query.range ?? '90d') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: LearnerFeedbackAnalyticsService.defaultBucketFor,
      allTimeStart: needsFloor
        ? await this.repository.getDataFloor()
        : undefined,
    });
    const { start, endExclusive } = window;
    const tenantId = query.tenantId?.trim() || undefined;
    const limit = query.limit ?? LEARNER_FEEDBACK_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const filters = {
      ratings: parseRatings(query.ratings),
      commentsOnly: query.commentsOnly !== 'false',
      search: query.search?.trim() || undefined,
    };

    const [stars, page] = await Promise.all([
      this.repository.getStarCounts(start, endExclusive, tenantId),
      this.repository.getPage(
        start,
        endExclusive,
        tenantId,
        filters,
        limit,
        offset,
      ),
    ]);

    return {
      window: describeWindow(window),
      summary: summariseStars(stars),
      items: page.rows,
      total: page.total,
      limit,
      offset,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      provenance: PROVENANCE,
    };
  }
}
