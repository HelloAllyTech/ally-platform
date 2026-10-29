/** Every one backs a CHECK in migration 1980810000000 (see check-constraints-cover-enums.spec.ts). */

export enum DebriefRunMode {
  /** Beside today's debrief until launch; no learner sees it. */
  SHADOW = 'shadow',
  /** What the learner reads, for a tenant that has been switched on. */
  LIVE = 'live',
  /** The learning loop's replays on the test sets; learning budget only. */
  REPLAY = 'replay',
}

export enum DebriefRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  /** Passed the checks and the Evaluator's bar. */
  PUBLISHED = 'published',
  /** Passed the checks, not the bar: published, flagged and sent to review. */
  BELOW_BAR = 'below_bar',
  /** Nothing passed the checks in time or budget: a person finishes it. */
  NEEDS_PERSON = 'needs_person',
  /** No debrief by design: too short, already debriefed, tenant off. */
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

export enum DebriefRunArm {
  BASELINE = 'baseline',
  CHALLENGER = 'challenger',
}
