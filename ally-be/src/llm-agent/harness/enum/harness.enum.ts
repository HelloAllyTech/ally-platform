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
}

export enum AgentReleaseAuditAction {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  PROMOTED = 'promoted',
  ROLLED_BACK = 'rolled_back',
  EMERGENCY_ROLLBACK = 'emergency_rollback',
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
