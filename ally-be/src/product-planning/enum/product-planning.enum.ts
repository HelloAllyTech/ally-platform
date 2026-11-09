/**
 * Where a plan is in its life (plans/roadmap-owns-planning rev 5.1 §B.4).
 *
 * DERIVED by code from facts, never declared by a model: the stage is what the
 * plan's session, readiness, design, runs and reviews add up to. Only the
 * stage-sync service writes it (from P3); until then it is used to tag spend.
 */
export enum PlanStage {
  IDEA = 'idea',
  FILED = 'filed',
  PRD = 'prd',
  DESIGN = 'design',
  READY = 'ready',
  BUILDING = 'building',
  LAUNCHING = 'launching',
  MEASURING = 'measuring',
  LEARNED = 'learned',
  CLOSED = 'closed',
}

/**
 * Append-only history of who did what to a plan, beside the transcript
 * (builder_messages) and decisions (builder_history). The plan's timeline is
 * the merge of all three.
 */
export enum PlanEventKind {
  PARKED = 'parked',
  FILED = 'filed',
  TAKEN_ON = 'taken_on',
  HANDED_BACK = 'handed_back',
  AUTO_RELEASED = 'auto_released',
  STAGE_CHANGED = 'stage_changed',
  ARCHIVED = 'archived',
  RESTORED = 'restored',
  VISIBILITY_CHANGED = 'visibility_changed',
  AUTHOR_ASKED = 'author_asked',
  BUDGET_CHANGED = 'budget_changed',
  CHECK_REQUIRED = 'check_required',
  CHECK_RESOLVED = 'check_resolved',
  FINDING_DISMISSED = 'finding_dismissed',
  SIGNOFF_REQUESTED = 'signoff_requested',
  SIGNOFF_GIVEN = 'signoff_given',
  MEASURE_FROZEN = 'measure_frozen',
  MEASURE_CHANGED = 'measure_changed',
  DESIGN_STARTED = 'design_started',
  DESIGN_APPROVED = 'design_approved',
  BUILD_SENT = 'build_sent',
  EXPORTED = 'exported',
  LAUNCHED = 'launched',
  OUTCOME_REVIEWED = 'outcome_reviewed',
  CLOSED = 'closed',
  REOPENED = 'reopened',
}

/** The two sign-offs a named person, not a toggle, gives (rev 5.1 §B.12). */
export enum PlanSignOffKind {
  CLINICAL = 'clinical',
  PRIVACY = 'privacy',
}
