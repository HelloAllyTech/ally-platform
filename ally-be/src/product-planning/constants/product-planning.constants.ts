/**
 * Defaults for the planning flow. The live values are Builder settings
 * (builder_settings.plan*), so they can be retuned once real spend is visible;
 * these are what a fresh settings row starts with.
 */
export const PLANNING_DEFAULTS = {
  /** One ceiling per plan, first message to outcome review, builds included. */
  PLAN_CEILING_USD: 100,
  /** Where the private Idea stage wraps up (soft, never a hard stop). */
  IDEA_CEILING_USD: 1,
  /** Warn at this fraction of a ceiling. */
  WARN_AT_FRACTION: 0.8,
  /** Closing a plan whose idea has more votes than this needs a second Lead. */
  CLOSE_CONFIRM_VOTE_THRESHOLD: 10,
} as const;

/** Spend rows are priced to this many decimal places (numeric(12,6)). */
export const PLAN_SPEND_COST_SCALE = 6;

/**
 * The Roadmap v2 switches (plans/roadmap-builder-merge §3.2, §4.6, §5.5, §5.6).
 * Live values are columns on `builder_settings`; these are what an unset
 * column means. Nothing reads them while `roadmapV2Enabled` is off, except
 * the settings screen that shows them.
 */
export const ROADMAP_V2_DEFAULTS = {
  /** How many open ideas one lead carries at once (the existing inProgressLimit). */
  IN_PROGRESS_LIMIT: 3,
  /** The most a lead may raise their idea's ceiling to; an Owner may go higher. */
  MAX_LEAD_CEILING_USD: 200,
  /** Working days an idea may wait for review before its age turns amber. */
  AWAITING_REVIEW_AMBER_DAYS: 5,
} as const;

/**
 * Paths whose change holds an auto-release for an explicit Release click
 * (§5.5, D6). Globs over the monorepo's paths. Owners can replace the list in
 * settings; a null column means this list. Pinned by roadmap-v2-defaults.spec.
 */
export const AUTO_RELEASE_HELD_PATHS_DEFAULT: readonly string[] = [
  'ally-be/src/database/migrations/**',
  '**/auth/**',
  '**/authorization/**',
  '**/*permission*.constants.ts',
  '**/*role*.constants.ts',
  '**/*payment*',
  '**/*billing*',
];

/** An Owner-set release window. Null on the settings row means any time. */
export interface RoadmapReleaseWindow {
  /** First hour releases may start, 0–23, in `timezone`. */
  startHour: number;
  /** Hour releases stop starting, 1–24 (exclusive). Before startHour wraps past midnight. */
  endHour: number;
  /** IANA zone, e.g. Asia/Kolkata. */
  timezone: string;
}
