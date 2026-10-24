/**
 * Enums for the reusable agent harness (`agent_*` tables). Every one backs a
 * varchar column with a CHECK constraint listed in
 * database/migrations/check-constraints-cover-enums.spec.ts.
 * Plan: plans/ally-guide/plan.md §7.3–§7.5.
 */

/** A release's place in the pipeline (plan §7.4). Exactly one GA per agent. */
export enum AgentReleaseStatus {
  DRAFT = 'draft',
  EVALUATING = 'evaluating',
  CANDIDATE = 'candidate',
  SHADOW = 'shadow',
  CANARY = 'canary',
  GA = 'ga',
  RETIRED = 'retired',
}

/** Who authored a release. */
export enum AgentReleaseAuthorKind {
  SEED = 'seed',
  HUMAN = 'human',
  CURATOR = 'curator',
  /**
   * The learning loop acting on its own (plan §7.13 progressive delegation):
   * an automatic gate, shadow, canary start, canary decision, promotion or
   * revert. Never a person; a person is always HUMAN.
   */
  SYSTEM = 'system',
}

export enum AgentReleaseAuditAction {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  PROMOTED = 'promoted',
  ROLLED_BACK = 'rolled_back',
  EMERGENCY_ROLLBACK = 'emergency_rollback',
  CANARY_STARTED = 'canary_started',
  CANARY_STOPPED = 'canary_stopped',
  /** Shadow replay started / finished (plan §7.4 lifecycle). */
  SHADOW_STARTED = 'shadow_started',
  SHADOW_COMPLETED = 'shadow_completed',
  /** The canary monitor's decision changed: wait, promote or revert, with its evidence. */
  CANARY_DECIDED = 'canary_decided',
  /** The canary was reverted automatically (auto-revert is always on). */
  CANARY_REVERTED = 'canary_reverted',
  NOTE = 'note',
}

/** The layer an override belongs to (plan §7.5). Learner prefs live with the agent. */
export enum AgentConfigLayer {
  ORG = 'org',
  COURSE = 'course',
}

/** Turn state machine (plan §7.3). */
export enum AgentTurnStatus {
  RECEIVED = 'received',
  ADMITTED = 'admitted',
  STREAMING = 'streaming',
  TOOL_WAIT = 'tool_wait',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  INTERRUPTED = 'interrupted',
}

/** What started a turn. Mirrors GuideEventTurnStarted.data.trigger. */
export enum AgentTurnTrigger {
  LEARNER_MESSAGE = 'learner_message',
  CARD_EVENT = 'card_event',
  PLATFORM_EVENT = 'platform_event',
  RESUME = 'resume',
  INTENT = 'intent',
}

export enum AgentChannel {
  TEXT = 'text',
  VOICE = 'voice',
  EVENT = 'event',
}
