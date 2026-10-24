/**
 * Enums for the harness's offline-optimisation tables (plans/ally-guide/plan.md
 * §7.13 loop 2): lessons and their audit, progressive delegation, shadow
 * reports and synthetic monitoring runs. Generic across agents. Every one backs
 * a varchar column with a CHECK constraint listed in
 * database/migrations/check-constraints-cover-enums.spec.ts.
 */

/** Where a lesson applies, and which span of the prompt carries it. */
export enum AgentLessonScope {
  /** Every conversation: the persona span (S1). */
  PLATFORM = 'platform',
  /** One organisation's conversations: the organisation span (S2). */
  ORG = 'org',
  /** One course's conversations: the course span (S3). */
  COURSE = 'course',
}

/**
 * A lesson's life. Only `active` lessons are in a GA release's playbook; the
 * playbook frozen in the release is the truth, this status is bookkeeping.
 */
export enum AgentLessonStatus {
  /** In a curator release that is still on its way through the pipeline. */
  PROPOSED = 'proposed',
  /** Touches safety vocabulary: waits for a person before any release. */
  QUARANTINED = 'quarantined',
  /** A person cleared it from quarantine; the next proposal carries it. */
  APPROVED = 'approved',
  /** In the GA release's playbook. */
  ACTIVE = 'active',
  /** A guardrail refused it (cap, evidence, copied text, pinned). Kept for the audit. */
  BLOCKED = 'blocked',
  /** A person rejected it, or the release carrying it failed or was reverted. */
  REJECTED = 'rejected',
  /** Taken out of the playbook by a person; the next release drops it. */
  RETIRED = 'retired',
}

/** Everything the curator's audit records (append-only). */
export enum AgentLessonAuditAction {
  PROPOSED = 'proposed',
  QUARANTINED = 'quarantined',
  BLOCKED = 'blocked',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ACTIVATED = 'activated',
  RETIRED = 'retired',
  /** A curator run: what it read, what it proposed, the release it created. */
  CURATOR_RUN = 'curator_run',
  /** The delegation stage moved (a person, or automatically down). */
  STAGE_CHANGED = 'stage_changed',
  /** The pipeline moved a release on (gate, shadow, canary) on its own. */
  PIPELINE_STEP = 'pipeline_step',
}

export enum AgentShadowStatus {
  RUNNING = 'running',
  PASSED = 'passed',
  FAILED = 'failed',
  /** Too few recent real turns to compare: a person decides. */
  INCONCLUSIVE = 'inconclusive',
  ERROR = 'error',
}

export enum AgentSyntheticRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
}

/** `agent_lessons.kind`: a playbook lesson, a policy tweak or a prompt tweak. */
export const AGENT_LESSON_KINDS = ['lesson', 'policy', 'prompt'] as const;
