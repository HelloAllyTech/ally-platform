/**
 * PM Agent enums. The string values are the contract (docs/pm-agent.md) and are
 * mirrored by CHECK constraints in migration 1982000000000 — change both together,
 * in a new migration.
 */

export enum PmCardKind {
  RECOMMENDATION = 'recommendation',
  QUESTION = 'question',
}

export enum PmCardCategory {
  UI_UX = 'ui_ux',
  PRODUCT = 'product',
  ARCHITECTURE = 'architecture',
  CODE_HEALTH = 'code_health',
  INFRA = 'infra',
  COST = 'cost',
  STRATEGY_CONTENT = 'strategy_content',
}

export enum PmCardStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  ACCEPTED_PENDING = 'accepted_pending',
  QUEUED = 'queued',
  DESIGNING = 'designing',
  BUILDING = 'building',
  PR_OPEN = 'pr_open',
  MERGED = 'merged',
  RELEASED = 'released',
  FAILED = 'failed',
  NEEDS_ATTENTION = 'needs_attention',
  MERGED_NOT_RELEASED = 'merged_not_released',
  HANDED_OFF = 'handed_off',
  REJECTED = 'rejected',
  FEEDBACK_CLOSED = 'feedback_closed',
  ANSWERED = 'answered',
  SKIPPED = 'skipped',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded',
}

/** Derived for the UI; never stored. */
export enum PmAgentState {
  DISABLED = 'disabled',
  IDLE = 'idle',
  RUNNING = 'running',
  QUEUE_FULL = 'queue_full',
  BUDGET_EXHAUSTED = 'budget_exhausted',
  PAUSED = 'paused',
}

export enum PmRiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum PmCardSize {
  S = 'S',
  M = 'M',
}

/** Repos a card may target: each has a release pipeline (not ally-mobile). */
export enum PmRepo {
  ALLY_BE = 'ally-be',
  ALLY_WEB = 'ally-web',
  ALLY_AI = 'ally-ai',
  ALLY_AI_LEARN = 'ally-ai-learn',
}

export enum PmQuestionScope {
  GLOBAL = 'global',
  FEATURE = 'feature',
  TENANT = 'tenant',
}

export enum PmAcceptPath {
  BUILDER = 'builder',
  DOWNLOAD = 'download',
}

export enum PmRejectReasonChip {
  NOT_PRIORITY = 'not_priority',
  ALREADY_PLANNED = 'already_planned',
  WRONG_IDEA = 'wrong_idea',
  TOO_RISKY = 'too_risky',
  OTHER = 'other',
}

export enum PmRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum PmRunTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
  REVISION = 'revision',
}

export enum PmLane {
  ANALYTICS = 'analytics',
  UX_SIGNALS = 'ux_signals',
  CODE_HEALTH = 'code_health',
  INFRA_COST = 'infra_cost',
  STRATEGY_CONTENT = 'strategy_content',
  REVISIONS = 'revisions',
}

export enum PmMemoryKind {
  FACT = 'fact',
  LESSON = 'lesson',
}

export enum PmMemorySource {
  CARD = 'card',
  ANSWER = 'answer',
  REJECTION = 'rejection',
  FEEDBACK = 'feedback',
  MANUAL = 'manual',
}

export enum PmFeedbackStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum PmOutboxAction {
  BUILD = 'build',
}

export enum PmOutboxStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  /** Parked: Builder busy, paused, or a design still drafting. Retried when due. */
  WAITING = 'waiting',
  DONE = 'done',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** The Accept → Builder chain, one durable step at a time (docs/pm-agent.md). */
export enum PmOutboxStep {
  CREATE_SESSION = 'create_session',
  FILE_ROADMAP = 'file_roadmap',
  PATCH_PRD = 'patch_prd',
  SET_REPOS = 'set_repos',
  START_DESIGN = 'start_design',
  AWAIT_DESIGN = 'await_design',
  START_BUILD = 'start_build',
  DONE = 'done',
}

export enum PmSignalStatus {
  NEW = 'new',
  USED = 'used',
  DISMISSED = 'dismissed',
}

export enum PmLaneStatDimension {
  CATEGORY = 'category',
  LANE = 'lane',
  SOURCE = 'source',
}

/** What a person decided about a card, as recorded in pm_agent_outcomes. */
export enum PmDecision {
  ACCEPTED = 'accepted',
  HANDED_OFF = 'handed_off',
  REJECTED = 'rejected',
  FEEDBACK = 'feedback',
  ANSWERED = 'answered',
  SKIPPED = 'skipped',
}
