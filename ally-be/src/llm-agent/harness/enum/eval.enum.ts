/**
 * Enums for the harness's learning-loop tables (`agent_eval_*`,
 * `agent_evaluations`, `agent_reviews`). Generic across agents, like the rest
 * of the harness. Every one backs a varchar column with a CHECK constraint
 * listed in database/migrations/check-constraints-cover-enums.spec.ts.
 * Plan: plans/ally-guide/plan.md §7.13, §8.1.
 */

/** What a suite is for. A case belongs to one suite. */
export enum AgentEvalSuiteKind {
  /** A small, fast suite a draft can run in under ten minutes. */
  SMOKE = 'smoke',
  /** Cases mined from production: saved traces and failed turns. */
  REGRESSION = 'regression',
  /** Model-written adversarial cases, refreshed weekly. */
  RED_TEAM = 'red_team',
}

/** Where a case came from (plan §7.12 regression trace collection). */
export enum AgentEvalCaseSource {
  /** "Save as eval case" on a turn trace. */
  TRACE = 'trace',
  /** Proposed automatically from a failed or flagged turn. */
  FAILED_TURN = 'failed_turn',
  /** Saved by a reviewer from the review queue. */
  REVIEW = 'review',
  RED_TEAM = 'red_team',
  /** A perturbed copy of another case. */
  COUNTERFACTUAL = 'counterfactual',
  MANUAL = 'manual',
}

/** Proposed cases do not run in a gate until a person accepts them. */
export enum AgentEvalCaseStatus {
  PROPOSED = 'proposed',
  ACTIVE = 'active',
  RETIRED = 'retired',
}

export enum AgentEvalRunKind {
  /** The smoke suite, once, for a draft. Never changes a release's status. */
  SMOKE = 'smoke',
  /** Every active case, three repetitions, against the GA baseline. */
  GATE = 'gate',
}

export enum AgentEvalRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  PASSED = 'passed',
  FAILED = 'failed',
  ERROR = 'error',
}

/** Why a window was picked for the nightly evaluator. */
export enum AgentEvaluationSample {
  FLAGGED = 'flagged',
  RANDOM = 'random',
}

export enum AgentEvaluationStatus {
  /** Deterministic checks, critic and verifier all ran. */
  JUDGED = 'judged',
  /** Deterministic checks only: the day's budget was spent, or no model. */
  CHECKED = 'checked',
  ERROR = 'error',
}

/** Why a window is in the human review queue (plan §7.13). */
export enum AgentReviewReason {
  SAFETY_FLAG = 'safety_flag',
  DISAGREEMENT = 'disagreement',
  THUMBS_DOWN = 'thumbs_down',
  CALIBRATION = 'calibration',
}

export enum AgentReviewStatus {
  OPEN = 'open',
  CLAIMED = 'claimed',
  DONE = 'done',
  DISMISSED = 'dismissed',
}
