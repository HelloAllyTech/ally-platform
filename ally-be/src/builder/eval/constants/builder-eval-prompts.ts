/**
 * The replay eval's settings. Its two model roles — the simulated admin and
 * the checklist judge — are the `builder_eval_admin_system` and
 * `builder_eval_judge_system` prompts in the Skills Store (defaults in
 * src/prompts/builder/). They are the measuring instrument, so a replay reads
 * their live text directly, never a candidate's overrides.
 */

/** Turns before a replay gives up on reaching a ready PRD. */
export const BUILDER_EVAL_MAX_TURNS = 14;

/** How many runs of one suite go at once. Each is a full interview. */
export const BUILDER_EVAL_CONCURRENCY = 2;

/** Suites allowed to run at once, across the deployment. */
export const BUILDER_EVAL_MAX_RUNNING_SUITES = 2;

/** A baseline is reused for a prompt gate when it is this recent. */
export const BUILDER_EVAL_BASELINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bumped whenever a change alters what a suite measures — a new gate, or the
 * validated turn holding replies back differently — so a prompt gate never
 * compares a candidate with a baseline scored on other terms. A suite's
 * summary records the version it was scored under; a baseline is reused only
 * on a match, otherwise one runs alongside.
 *
 * 2 — `falseReadyClaims` gate; ready claims held back every time and judged
 *     after the reviewer's due pass (2026-10-23).
 */
export const BUILDER_EVAL_SCORING_VERSION = 2;

/**
 * How often a running suite says it is alive. Separate from run completion on
 * purpose: one interview replay can run longer than any sensible stall window,
 * and "no run finished lately" is not "nobody is running it".
 */
export const BUILDER_EVAL_HEARTBEAT_MS = 60 * 1000;

/** A running suite with no heartbeat for this long lost its process — a deploy, usually. */
export const BUILDER_EVAL_STALL_MS = 10 * 60 * 1000;

/** Restarts a suite survives before it is called errored rather than resumed again. */
export const BUILDER_EVAL_MAX_RESUMES = 3;

/** How far the candidate's mean judge score may fall below the baseline's and still pass. */
export const BUILDER_EVAL_JUDGE_TOLERANCE = 0.05;
