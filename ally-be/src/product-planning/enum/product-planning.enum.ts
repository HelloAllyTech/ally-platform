/**
 * Where a plan is in its life (plans/roadmap-owns-planning rev 5.2 §B.4).
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
  /**
   * An inline edit on the Roadmap v2 idea page (§4.11): title, goal, summary,
   * lead or planned month. `detail` is { field, from?, to? }.
   */
  ITEM_EDITED = 'item_edited',
  /** The Owner accepted, declined or reopened a submitted idea (D10). detail: { decision, undo? }. */
  REVIEWED = 'reviewed',
  /** The Owner picked or changed the lead (D11). detail: { from, to }. */
  LEAD_ASSIGNED = 'lead_assigned',
  /** The lead handed the idea back to the Owner (D11). detail: { note? }. */
  LEAD_HANDED_BACK = 'lead_handed_back',
  /** Start planning: the plan interview begins in the same session (§2.1a). */
  PLANNING_STARTED = 'planning_started',
  /** "Use this answer": the settler chose between conflicting answers (D13). */
  ANSWER_SETTLED = 'answer_settled',
  /**
   * The build brief went to Claude Code (D18, §4.5b). `detail` is { tool }.
   * The idea's PRs carrying its code then drive release (linkDrivesRelease).
   */
  EXTERNAL_BUILD = 'external_build',
}

/** What a plan notification says (plan_notifications.kind). */
export enum PlanNotificationKind {
  ARCHIVE_SOON = 'archive_soon',
  ARCHIVED = 'archived',
  PURGE_SOON = 'purge_soon',
  TAKEN_ON = 'taken_on',
  HANDED_BACK = 'handed_back',
  NUDGE = 'nudge',
  AUTO_RELEASED = 'auto_released',
  PRD_READY = 'prd_ready',
  SENT_TO_BUILD = 'sent_to_build',
  LAUNCHED = 'launched',
  OUTCOME = 'outcome',
  CLOSED = 'closed',
  CLOSE_CONFIRM = 'close_confirm',
  AUTHOR_QUESTION = 'author_question',
  AUTHOR_ANSWERED = 'author_answered',
  CEILING_WARNING = 'ceiling_warning',
  CHECK_FINDING = 'check_finding',
}

/**
 * What a Roadmap v2 notification is about (roadmap_notifications.kind): the
 * §4.8 events, plus `budget` (a ceiling reached) and `activity` (anything
 * else an older writer reports, delivered to its original recipient only).
 */
export enum RoadmapNotificationKind {
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  LEAD_ASSIGNED = 'lead_assigned',
  ASSIGNED_TO_YOU = 'assigned_to_you',
  HANDED_BACK = 'handed_back',
  AGENT_QUESTION = 'agent_question',
  MENTION = 'mention',
  ANSWERS_CONFLICT = 'answers_conflict',
  DECISION_NEEDED = 'decision_needed',
  SHIPPED = 'shipped',
  OUTCOME_REVIEWED = 'outcome_reviewed',
  RELEASE_HELD = 'release_held',
  RELEASE_FAILED = 'release_failed',
  BREAKER_OPEN = 'breaker_open',
  BUDGET = 'budget',
  ACTIVITY = 'activity',
}

/** How closely someone follows one idea (§4.8). */
export enum RoadmapWatchLevel {
  ALL = 'all',
  MILESTONES = 'milestones',
  NONE = 'none',
}
