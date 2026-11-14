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
