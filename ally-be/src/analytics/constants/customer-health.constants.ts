import { MIN_ORG_GROUP_SIZE } from '../repository/highlights-analytics.repository';

/**
 * Why Ally staff might get in touch with an organisation. Each reason is a pure
 * function of numbers the organisation's own Statistics page shows, so staff and
 * the organisation's admins never see two stories. Nothing reads what a learner
 * said or did in a session: counts, shares and averages only.
 */
export type CustomerReasonId =
  | 'neverActive'
  | 'quiet'
  | 'neverStarted'
  | 'activityDown'
  | 'reviewsBehind'
  | 'creditsNearLimit'
  | 'lowRating'
  | 'activityUp';

/** What an organisation looks like, in the numbers the rules read. */
export interface CustomerFacts {
  learners: number;
  /** Every completed session the organisation has ever had. */
  completedTotal: number;
  completedLast28d: number;
  completedPrev28d: number;
  /** Null when no session has ever been completed. */
  daysSinceLastCompleted: number | null;
  /** Learners who have never completed a session. */
  neverStartedLearners: number;
  /** Completed sessions of the last 28 days, and how many were reviewed. */
  reviewedLast28d: number;
  ratingsCount90d: number;
  ratingsAverage90d: number | null;
  /** Null when no credit limit is set, because there is no ceiling to be a share of. */
  creditUtilisationPct: number | null;
}

export interface CustomerReason {
  id: CustomerReasonId;
  /** `attention`: worth getting in touch about. `celebrate`: worth congratulating. */
  polarity: 'attention' | 'celebrate';
  /** How much it counts towards the ranking (attention only). */
  severity: number;
  /** The numbers the sentence is written from. */
  params: Record<string, number>;
}

/** Every threshold, in one place. Set with the people who chase accounts. */
export const CUSTOMER_THRESHOLDS = {
  /** An organisation with no completed session for this many days has gone quiet. */
  quietDays: 21,
  /** Quiet this long is more serious. */
  longQuietDays: 60,
  /** This share of learners who never completed a session. */
  neverStartedShare: 0.4,
  /** The last 28 days against the 28 before: below this ratio is a fall. */
  activityDownRatio: 0.7,
  /** Above this ratio is a rise worth congratulating. */
  activityUpRatio: 1.3,
  /** A comparison needs this many sessions in the earlier period. */
  minSessionsToCompare: 10,
  /** Reviews are judged on this many completed sessions at least. */
  minSessionsForReviews: 10,
  /** Under this share of completed sessions reviewed. */
  reviewShareBelow: 0.5,
  /** At or above this share of the credits used. */
  creditsNearLimitPct: 90,
  /** Ratings are judged on this many at least, below this average. */
  minRatings: 10,
  lowRatingBelow: 3.5,
  /** Rates over fewer learners than this are not drawn (a share of four people is about those people). */
  minLearnersForRates: MIN_ORG_GROUP_SIZE,
} as const;

const T = CUSTOMER_THRESHOLDS;

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The reasons for one organisation, most serious first. Small organisations get none that are rates. */
export function customerReasons(f: CustomerFacts): CustomerReason[] {
  const out: CustomerReason[] = [];
  const enoughForRates = f.learners >= T.minLearnersForRates;

  const neverActive = f.learners > 0 && f.completedTotal === 0;
  const quiet =
    !neverActive &&
    f.daysSinceLastCompleted !== null &&
    f.daysSinceLastCompleted >= T.quietDays;

  if (neverActive) {
    out.push({
      id: 'neverActive',
      polarity: 'attention',
      severity: 4,
      params: { learners: f.learners },
    });
  }
  if (quiet) {
    out.push({
      id: 'quiet',
      polarity: 'attention',
      severity: (f.daysSinceLastCompleted as number) >= T.longQuietDays ? 4 : 3,
      params: { days: f.daysSinceLastCompleted as number },
    });
  }
  if (
    enoughForRates &&
    !neverActive &&
    f.neverStartedLearners / f.learners >= T.neverStartedShare
  ) {
    out.push({
      id: 'neverStarted',
      polarity: 'attention',
      severity: 2,
      params: {
        count: f.neverStartedLearners,
        percent: Math.round((f.neverStartedLearners / f.learners) * 100),
      },
    });
  }
  const comparable =
    enoughForRates && f.completedPrev28d >= T.minSessionsToCompare;
  // Going quiet already says it; a fall on top of silence adds nothing.
  if (
    comparable &&
    !quiet &&
    f.completedLast28d < f.completedPrev28d * T.activityDownRatio
  ) {
    out.push({
      id: 'activityDown',
      polarity: 'attention',
      severity: 2,
      params: { from: f.completedPrev28d, to: f.completedLast28d },
    });
  }
  if (
    enoughForRates &&
    f.completedLast28d >= T.minSessionsForReviews &&
    f.reviewedLast28d / f.completedLast28d < T.reviewShareBelow
  ) {
    out.push({
      id: 'reviewsBehind',
      polarity: 'attention',
      severity: 1,
      params: {
        percent: Math.round((f.reviewedLast28d / f.completedLast28d) * 100),
      },
    });
  }
  if (
    f.creditUtilisationPct !== null &&
    f.creditUtilisationPct >= T.creditsNearLimitPct
  ) {
    out.push({
      id: 'creditsNearLimit',
      polarity: 'attention',
      severity: 2,
      params: { percent: Math.round(f.creditUtilisationPct) },
    });
  }
  if (
    enoughForRates &&
    f.ratingsAverage90d !== null &&
    f.ratingsCount90d >= T.minRatings &&
    f.ratingsAverage90d < T.lowRatingBelow
  ) {
    out.push({
      id: 'lowRating',
      polarity: 'attention',
      severity: 2,
      params: {
        average: round1(f.ratingsAverage90d),
        count: f.ratingsCount90d,
      },
    });
  }
  if (
    comparable &&
    f.completedLast28d >= f.completedPrev28d * T.activityUpRatio
  ) {
    out.push({
      id: 'activityUp',
      polarity: 'celebrate',
      severity: 0,
      params: { from: f.completedPrev28d, to: f.completedLast28d },
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/** How much an organisation's attention reasons add up to, for the ranking. */
export const attentionScore = (reasons: readonly CustomerReason[]): number =>
  reasons
    .filter((r) => r.polarity === 'attention')
    .reduce((sum, r) => sum + r.severity, 0);
