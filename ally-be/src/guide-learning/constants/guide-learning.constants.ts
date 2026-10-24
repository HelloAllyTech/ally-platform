/**
 * The Ally guide's learning loop (plans/ally-guide/plan.md §7.13).
 */

/**
 * The cost ledger's `agentKey` for everything the learning loop spends:
 * critic, verifier, red team and eval replays. Separate from `ally_guide`
 * so none of it counts toward a learner's budget tier, a visitor's
 * allowance or the guide's cost-anomaly alert.
 */
export const GUIDE_LEARNING_COST_KEY = 'ally_guide_learning';

/** Ledger roles the evaluator's daily budget covers. Eval runs are not capped by it. */
export const BUDGETED_ROLES = [
  'evaluator_critic',
  'evaluator_verifier',
  'red_team',
] as const;

/** Stable suite keys: code finds a suite by these, whatever its id. */
export const SUITE_KEYS = {
  SMOKE: 'smoke',
  REGRESSION: 'regression',
  RED_TEAM: 'red_team',
} as const;

/** Production windows considered per night, at most (flagging is by SQL and regex). */
export const MAX_CANDIDATES_PER_NIGHT = 5_000;
/** Messages of context before the learner message in a window. */
export const WINDOW_CONTEXT_MESSAGES = 6;
/** Judge output limit: thirteen short verdicts fit comfortably. */
// Room to think before a structured verdict: on the live run, 2,000 left a
// reasoning model's critic and verifier stopped at max_tokens with nothing.
export const JUDGE_MAX_TOKENS = 8_000;
export const JUDGE_TIMEOUT_MS = 60_000;
/** A judge call is refused when the day has less than this left. */
export const JUDGE_RESERVE_USD = 0.05;
/** Evaluations, reviews and their copies are kept this long (plan §8.2). */
export const EVALUATION_RETENTION_DAYS = 180;
/** Failed turns proposed as cases per night, at most. */
export const MAX_PROPOSED_PER_NIGHT = 20;
/** Red-team cases written per category per week. */
export const RED_TEAM_CASES_PER_CATEGORY = 4;
/** The smoke suite's size cap: it must run in under ten minutes. */
export const SMOKE_MAX_CASES = 25;
/** Replays in flight at once in an eval run. */
export const REPLAY_CONCURRENCY = 4;
