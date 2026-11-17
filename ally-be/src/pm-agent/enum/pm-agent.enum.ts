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
  /** Accepted, undo window closed, being filed to the roadmap (was: waiting for Builder). */
  QUEUED = 'queued',
  /** On the roadmap as an opportunity, filed by the Product Manager Agent. */
  FILED = 'filed',
  /** Its roadmap opportunity was archived or removed. A soft negative for learning. */
  ROADMAP_ARCHIVED = 'roadmap_archived',
  /*
   * Legacy (Accept → Builder, removed 2026-11-17 by migration 1982100000100): designing,
   * building, pr_open, merged, merged_not_released, failed and handed_off are never written
   * any more; they stay so rows written before then still read.
   */
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

/** Repos an idea touches (context for whoever picks the opportunity up). */
export enum PmRepo {
  ALLY_BE = 'ally-be',
  ALLY_WEB = 'ally-web',
  ALLY_AI = 'ally-ai',
  ALLY_AI_LEARN = 'ally-ai-learn',
  ALLY_MOBILE = 'ally-mobile',
}

export enum PmQuestionScope {
  GLOBAL = 'global',
  FEATURE = 'feature',
  TENANT = 'tenant',
}

export enum PmAcceptPath {
  /** File the card to the roadmap as a Product Manager Agent opportunity. The only path now. */
  ROADMAP = 'roadmap',
  /** Legacy, read-only: accepted into Builder before 2026-11-17. */
  BUILDER = 'builder',
  /** Legacy, read-only: plan.md handed off before 2026-11-17. */
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
  /** A lesson derived by the weekly lessons job (src/pm-agent/lessons/). */
  WEEKLY_JOB = 'weekly_job',
}

/** A lesson's lifecycle (migration 1982000000600). Facts leave it NULL. */
export enum PmLessonStatus {
  PROPOSED = 'proposed',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REMOVED = 'removed',
}

/** What a lesson applies to; stored in pm_agent_memory.scope. */
export enum PmLessonScope {
  GLOBAL = 'global',
  CATEGORY = 'category',
  LANE = 'lane',
}

export enum PmFeedbackStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum PmOutboxAction {
  /** Legacy: Accept → Builder. Migration 1982100000100 cancelled every open row. */
  BUILD = 'build',
  FILE_ROADMAP = 'file_roadmap',
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

/**
 * Outbox steps. A `file_roadmap` row runs FILE_ROADMAP → DONE; the rest are the legacy
 * Accept → Builder chain, kept so old rows still read.
 */
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
