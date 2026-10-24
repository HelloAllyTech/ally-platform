/** Types for the Analytics page's Ally tab (AAQ-240 to AAQ-251): `/v1/analytics/ally-guide/*`. */

import { AnalyticsScoping, AnalyticsWindow } from "./auth";

/** A rate over a group of learners; the rate is withheld (null) under the minimum group size. */
export interface AllyRate {
  /** 0 to 1, or null when suppressed or empty. */
  rate: number | null;
  count: number;
  of: number;
  learners: number;
  suppressed: boolean;
}

interface AllyBase {
  window: AnalyticsWindow;
  scoping: AnalyticsScoping;
  /** No rate is shown over fewer learners than this. */
  minGroupSize: number;
  provenance: string;
}

export interface AllyGuideSummary extends AllyBase {
  learners: number;
  conversations: number;
  learnerMessages: number;
  thumbsUp: AllyRate;
  costUsd: number;
  costPerLearnerUsd: number | null;
}

export interface AllyWeek {
  /** Monday of the ISO week (yyyy-mm-dd). */
  week: string;
  activeLearners: number;
  firstSessionWin: AllyRate;
  firstWinWithin5Min: AllyRate;
  itemsPerLearningDay: number | null;
  sevenDayReturn: AllyRate;
  appointmentsSet: number;
  appointmentsKept: AllyRate;
  voiceAdoption: AllyRate;
  quizFirstAttemptPass: AllyRate;
  quizFirstAttemptPassClassic: AllyRate;
  roleplayScore: number | null;
  roleplayScoreClassic: number | null;
  careEntriesPer100: number | null;
  crisisEntriesPer100: number | null;
  offCourse: AllyRate;
  refusals: AllyRate;
}

export interface AllyGuideWeekly extends AllyBase {
  weeks: AllyWeek[];
}

export type AllyGuardFlag = "ok" | "engagement_up_learning_flat" | "learning_fell" | "too_few";

export interface AllyPairedWeek {
  week: string;
  itemsPerLearningDay: number | null;
  thumbsUpShare: number | null;
  quizFirstAttemptPass: number | null;
  guard: AllyGuardFlag;
}

export interface AllyGuideEngagementLearning extends AllyBase {
  weeks: AllyPairedWeek[];
}

export interface AllyCourseCost {
  /** Null for the folded "Other courses" row. */
  trackId: string | null;
  title: string;
  learners: number;
  turns: number;
  costUsd: number;
  costPerLearnerUsd: number | null;
  /** Courses folded into this row because each had too few learners. */
  folded: number;
}

export interface AllyGuideCourses extends AllyBase {
  courses: AllyCourseCost[];
}
