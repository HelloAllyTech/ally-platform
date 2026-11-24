import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { ChartFilterKey } from './tenant-chart-library.constants';
import { StatisticsViewId } from './tenant-statistics-views.constants';

/**
 * The findings behind "Your focus today" on For you.
 *
 * A rule reads the data of ONE chart (the same data the chart draws, so the
 * numbers in an insight are the numbers on the page it links to) and either
 * finds something worth a person's attention or does not. Rules are pure
 * functions: no queries, no clock, no translation. The service fetches each
 * chart once, runs the rules over it, ranks what they find, and the web app
 * writes the sentence from the rule id and its numbers in the person's
 * language. Nothing here is free text, so every finding is testable and
 * translated.
 *
 * Nothing in a rule reads what learners said or did in a session: only counts
 * and scores a chart already shows.
 */
export type InsightPolarity = 'attention' | 'celebrate';

/** What a rule found. The service adds the rule's id, polarity and chart. */
export interface InsightDraft {
  /** 0 to 1: how much it matters, to rank findings of the same polarity. */
  severity: number;
  /** The numbers and names the sentence is written from. */
  params: Record<string, string | number>;
  /** Where "See the chart" goes: a tab, a chart on it, and the filter that shows this finding. */
  evidence: {
    view: StatisticsViewId;
    chartId: string;
    filters?: Partial<Record<ChartFilterKey, string>>;
  };
  /** Tells apart findings of one rule about different things (the course), so each can be dismissed on its own. */
  subjectKey?: string;
}

export interface InsightRule<T = unknown> {
  /** Stable. Also the translation key of the sentence: `statisticsLibrary.insights.items.<id>`. */
  id: string;
  polarity: InsightPolarity;
  /** The chart whose data the rule reads. */
  chartId: string;
  range?: AnalyticsRange;
  evaluate: (data: T) => InsightDraft | null;
}

/**
 * How much has to be true before something is worth saying, in one place so a
 * threshold can be tuned (or an organisation's own later) without touching a
 * rule. Small samples say nothing: every rule has a minimum.
 */
export const INSIGHT_THRESHOLDS = {
  /** Learners (not practised in 30 days, or never started) before it is worth saying. */
  quietLearnersMin: 3,
  /** ...and the share of all learners that must be quiet too, so one in a thousand is not an alarm. */
  quietLearnersShare: 0.1,
  /** Learners stalled in, or never started on, one course. */
  courseLearnersMin: 3,
  /** Completed sessions before the share reviewed means anything, and the share below which it is low. */
  reviewSessionsMin: 10,
  reviewShareLow: 0.5,
  /** Learners behind a skill's average before it can be called the weakest, and the level at or below which it is low. */
  skillLearnersMin: 3,
  skillLevelLow: 2.5,
  /** Ratings before the average means anything, and the average below which it is low. */
  ratingsMin: 10,
  ratingAverageLow: 3.5,
  /** Weeks of usage before "highest yet" means anything, and the least active learners in that week. */
  usageWeeksMin: 6,
  usageActiveMin: 3,
  /** Learners with two scored sessions before improvement is worth saying, and the share improving. */
  trendLearnersMin: 5,
  trendShareHigh: 0.5,
} as const;

/** The most findings shown of each kind. */
export const INSIGHT_LIMITS = { attention: 5, celebrate: 3 } as const;
/** How long a cached set of findings is kept for an organisation. */
export const INSIGHT_CACHE_SECONDS = 600;
/** How long "Remind me later" hides a finding, unless the request says otherwise. */
export const INSIGHT_SNOOZE_DAYS = 7;
export const INSIGHT_SNOOZE_DAYS_MAX = 30;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number, places = 1) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

// Data shapes, as the chart handlers return them. Declared here, not imported
// from the service, so the rules do not depend on it.
interface LearnerStatusData {
  total: number;
  counts: {
    active: number;
    at_risk: number;
    dormant: number;
    never_started: number;
  };
}
interface CourseRankingData {
  rows: Array<{ id: string; title: string; count: number }>;
}
interface ReviewCoverageData {
  completedSessions: number;
  reviewedSessions: number;
}
interface SkillChangeData {
  rows: Array<{
    skill: string;
    first: number;
    latest: number;
    learners: number;
  }>;
}
interface RatingsData {
  count: number;
  average: number | null;
}
interface UsageData {
  activeUsers: Array<{ bucket: string; count: number }>;
}
interface LearnerTrendData {
  improving: number;
  total: number;
}

const quiet = (count: number, total: number) =>
  count >= INSIGHT_THRESHOLDS.quietLearnersMin &&
  total > 0 &&
  count / total >= INSIGHT_THRESHOLDS.quietLearnersShare;

export const INSIGHT_RULES: readonly InsightRule<any>[] = [
  {
    id: 'learners.dormant',
    polarity: 'attention',
    chartId: 'TSQ-007',
    evaluate: (data: LearnerStatusData) => {
      const count = data.counts.dormant;
      if (!quiet(count, data.total)) return null;
      return {
        severity: clamp((count / data.total) * 2),
        params: { count, total: data.total },
        evidence: { view: 'organisation', chartId: 'TSQ-007' },
      };
    },
  } satisfies InsightRule<LearnerStatusData>,
  {
    id: 'learners.neverStarted',
    polarity: 'attention',
    chartId: 'TSQ-007',
    evaluate: (data: LearnerStatusData) => {
      const count = data.counts.never_started;
      if (!quiet(count, data.total)) return null;
      return {
        severity: clamp((count / data.total) * 1.5),
        params: { count, total: data.total },
        evidence: { view: 'organisation', chartId: 'TSQ-007' },
      };
    },
  } satisfies InsightRule<LearnerStatusData>,
  {
    id: 'courses.stalled',
    polarity: 'attention',
    chartId: 'TSQ-015',
    evaluate: (data: CourseRankingData) => {
      const top = data.rows[0];
      if (!top || top.count < INSIGHT_THRESHOLDS.courseLearnersMin) return null;
      return {
        severity: clamp(0.4 + top.count / 40),
        params: { title: top.title, count: top.count },
        evidence: {
          view: 'course',
          chartId: 'TSQ-045',
          filters: { course: top.id },
        },
        subjectKey: top.id,
      };
    },
  } satisfies InsightRule<CourseRankingData>,
  {
    id: 'courses.notStarted',
    polarity: 'attention',
    chartId: 'TSQ-016',
    evaluate: (data: CourseRankingData) => {
      const top = data.rows[0];
      if (!top || top.count < INSIGHT_THRESHOLDS.courseLearnersMin) return null;
      return {
        severity: clamp(0.3 + top.count / 50),
        params: { title: top.title, count: top.count },
        evidence: {
          view: 'course',
          chartId: 'TSQ-041',
          filters: { course: top.id },
        },
        subjectKey: top.id,
      };
    },
  } satisfies InsightRule<CourseRankingData>,
  {
    id: 'reviews.backlog',
    polarity: 'attention',
    chartId: 'TSQ-027',
    evaluate: (data: ReviewCoverageData) => {
      if (data.completedSessions < INSIGHT_THRESHOLDS.reviewSessionsMin) {
        return null;
      }
      const share = data.reviewedSessions / data.completedSessions;
      if (share >= INSIGHT_THRESHOLDS.reviewShareLow) return null;
      return {
        severity: clamp((1 - share) * 0.8),
        params: {
          percent: Math.round(share * 100),
          reviewed: data.reviewedSessions,
          completed: data.completedSessions,
        },
        evidence: { view: 'organisation', chartId: 'TSQ-027' },
      };
    },
  } satisfies InsightRule<ReviewCoverageData>,
  {
    id: 'skills.weakest',
    polarity: 'attention',
    chartId: 'TSQ-024',
    evaluate: (data: SkillChangeData) => {
      const weakest = data.rows.find(
        (row) => row.learners >= INSIGHT_THRESHOLDS.skillLearnersMin,
      );
      if (!weakest || weakest.latest > INSIGHT_THRESHOLDS.skillLevelLow) {
        return null;
      }
      return {
        severity: clamp(
          (INSIGHT_THRESHOLDS.skillLevelLow - weakest.latest) / 1.5 + 0.3,
        ),
        params: { skill: weakest.skill, level: round(weakest.latest) },
        evidence: { view: 'organisation', chartId: 'TSQ-024' },
        subjectKey: weakest.skill,
      };
    },
  } satisfies InsightRule<SkillChangeData>,
  {
    id: 'ratings.low',
    polarity: 'attention',
    chartId: 'TSQ-026',
    evaluate: (data: RatingsData) => {
      if (
        data.average === null ||
        data.count < INSIGHT_THRESHOLDS.ratingsMin ||
        data.average >= INSIGHT_THRESHOLDS.ratingAverageLow
      ) {
        return null;
      }
      return {
        severity: clamp(
          (INSIGHT_THRESHOLDS.ratingAverageLow - data.average) / 2 + 0.3,
        ),
        params: { average: round(data.average), count: data.count },
        evidence: { view: 'organisation', chartId: 'TSQ-026' },
      };
    },
  } satisfies InsightRule<RatingsData>,
  {
    id: 'usage.high',
    polarity: 'celebrate',
    chartId: 'TSQ-002',
    evaluate: (data: UsageData) => {
      const counts = data.activeUsers.map((point) => point.count);
      if (counts.length < INSIGHT_THRESHOLDS.usageWeeksMin) return null;
      const last = counts[counts.length - 1];
      const earlier = counts.slice(0, -1);
      if (
        last < INSIGHT_THRESHOLDS.usageActiveMin ||
        last <= Math.max(...earlier)
      ) {
        return null;
      }
      return {
        severity: 0.5,
        params: { count: last, weeks: counts.length },
        evidence: { view: 'organisation', chartId: 'TSQ-002' },
      };
    },
  } satisfies InsightRule<UsageData>,
  {
    id: 'learners.improving',
    polarity: 'celebrate',
    chartId: 'TSQ-021',
    evaluate: (data: LearnerTrendData) => {
      if (data.total < INSIGHT_THRESHOLDS.trendLearnersMin) return null;
      const share = data.improving / data.total;
      if (share < INSIGHT_THRESHOLDS.trendShareHigh) return null;
      return {
        severity: clamp(share),
        params: { improving: data.improving, total: data.total },
        evidence: { view: 'organisation', chartId: 'TSQ-021' },
      };
    },
  } satisfies InsightRule<LearnerTrendData>,
];
