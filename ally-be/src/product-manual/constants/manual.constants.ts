/** Limits and labels for the Product Manual. See docs/product-manual.md. */

export const MANUAL_SLUG_MAX = 120;
export const MANUAL_TITLE_MAX = 200;
export const MANUAL_BODY_MAX = 200_000;
export const MANUAL_SUMMARY_MAX = 2_000;
export const MANUAL_REASON_MAX = 2_000;
export const MANUAL_TAG_MAX = 40; // entries per roles / surfaces / journeys
export const MANUAL_TAG_LEN = 60;
/** Page-detail breadcrumb depth guard (also the cycle guard). */
export const MANUAL_BREADCRUMB_DEPTH = 6;
/** How far up the parent chain a write walks to refuse a cycle. */
export const MANUAL_PARENT_WALK_DEPTH = 12;

export const MANUAL_IMPORT_MAX_PAGES = 200;

export const MANUAL_SEARCH_DEFAULT_LIMIT = 20;
export const MANUAL_SEARCH_MAX_LIMIT = 50;
export const MANUAL_SEARCH_MIN_CHARS = 2;
export const MANUAL_SEARCH_MAX_CHARS = 200;

export const MANUAL_CHANGES_DEFAULT_LIMIT = 30;
export const MANUAL_CHANGES_MAX_LIMIT = 100;

export const MANUAL_RUNS_DEFAULT_LIMIT = 10;
export const MANUAL_RUNS_MAX_LIMIT = 50;

export const MANUAL_BUDGET_MIN_USD = 1;
export const MANUAL_BUDGET_MAX_USD = 2000;
export const MANUAL_BUDGET_DEFAULT_USD = 100;
/** One run may reserve at most monthly / this much. */
export const MANUAL_RUN_CAP_DIVISOR = 4;

/**
 * Every `llm_usage.task` the manual spends under starts with this (`product_manual_chat`,
 * `product_manual_agent`, and any finer `product_manual_*` label), so chat and the weekly agent share
 * one cap.
 */
export const MANUAL_TASK_PREFIX = 'product_manual_';

/** The IST offset (UTC+05:30) the monthly budget is counted in. */
export const MANUAL_IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export const MANUAL_BANNER_BUDGET_EXHAUSTED =
  "Weekly updates are paused: this month's budget is used up. They resume on the 1st.";

/** Weekly agent schedule: Mondays 02:00 UTC. */
export const MANUAL_WEEKLY_DAY_UTC = 1;
export const MANUAL_WEEKLY_HOUR_UTC = 2;

/** `ChangeRow.authorLabel` per author kind. */
export const MANUAL_AUTHOR_LABELS: Record<string, string> = {
  seed: 'Initial import',
  weekly_agent: 'Weekly agent',
  chat_agent: 'Chat agent',
  proposal: 'Weekly agent (from a proposal)',
  human: 'Staff',
  revert: 'Revert',
};
