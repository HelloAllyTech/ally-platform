/**
 * Defaults for the planning flow. The live values are Builder settings
 * (builder_settings.plan*), so they can be retuned once real spend is visible;
 * these are what a fresh settings row starts with.
 */
export const PLANNING_DEFAULTS = {
  /** Ceiling for one plan from first message to PRD ready, drafts included. */
  PLAN_CEILING_USD: 5,
  /** The share of that ceiling the private Idea stage may use (soft wrap-up). */
  IDEA_CEILING_USD: 1,
  /** Warn at this fraction of a ceiling. */
  WARN_AT_FRACTION: 0.8,
  /** Closing a plan whose idea has more votes than this needs a second Lead. */
  CLOSE_CONFIRM_VOTE_THRESHOLD: 10,
} as const;

/** Spend rows are priced to this many decimal places (numeric(12,6)). */
export const PLAN_SPEND_COST_SCALE = 6;
