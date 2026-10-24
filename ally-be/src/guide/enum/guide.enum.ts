/**
 * Enums for the Ally guide's own tables (`guide_*`). Each backs a varchar
 * column with a CHECK constraint listed in
 * database/migrations/check-constraints-cover-enums.spec.ts. Where a value
 * also crosses the wire, guide.enum.spec.ts pins it to the generated contract.
 * Plan: plans/ally-guide/plan.md §8.
 */

export enum GuideThreadStatus {
  ACTIVE = 'active',
  MERGED = 'merged',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

/** Safety mode (plan §6.2). Same values as the contract's GuideMode. */
export enum GuideMode {
  NORMAL = 'NORMAL',
  CARE = 'CARE',
  CRISIS = 'CRISIS',
  CRISIS_FOLLOWUP = 'CRISIS_FOLLOWUP',
}

export enum GuideMessageRole {
  LEARNER = 'learner',
  ALLY = 'ally',
  SYSTEM_NOTE = 'system_note',
}

/** What produced a message. FIXED rows are pre-written copy, never model text. */
export enum GuideMessageKind {
  CHAT = 'chat',
  CRISIS_FIXED = 'crisis_fixed',
  FIXED = 'fixed',
  RECAP = 'recap',
  NUDGE = 'nudge',
}

export enum GuideCardKind {
  COURSE_INFO = 'course_info',
  COURSE_ITEM = 'course_item',
  MICRO_ACTIVITY = 'micro_activity',
  CHAPTER_TITLE = 'chapter_title',
  SCENE_RECEIPT = 'scene_receipt',
  CLOSING_RITUAL = 'closing_ritual',
  FINALE = 'finale',
  RESOURCE = 'resource',
  CRISIS_RESOURCES = 'crisis_resources',
  SIGN_IN = 'sign_in',
  ACCESS_DENIED = 'access_denied',
}

export enum GuideCardPresentation {
  INLINE = 'inline',
  SHELF = 'shelf',
  THEATRE = 'theatre',
}

export enum GuideCardState {
  ANNOUNCED = 'announced',
  READY = 'ready',
  ACTIVE = 'active',
  DONE = 'done',
  FAILED = 'failed',
  SUPERSEDED = 'superseded',
  DISMISSED = 'dismissed',
}

export enum GuideTone {
  QUIET = 'quiet',
  WARM = 'warm',
  FESTIVE = 'festive',
}

export enum GuideTriggerStatus {
  PENDING = 'pending',
  CONSUMED = 'consumed',
  DISCARDED = 'discarded',
}

export enum GuideMemoryKind {
  PREFERENCE = 'preference',
  GOAL = 'goal',
  POSSIBLE_SELF = 'possible_self',
  STRENGTH = 'strength',
  STRUGGLE = 'struggle',
  CONTEXT = 'context',
  COMMITMENT = 'commitment',
  UNIQUE_OUTCOME = 'unique_outcome',
}

export enum GuideMemoryStatus {
  ACTIVE = 'active',
  /** The learner forgot it: a tombstone, never written again. */
  DELETED = 'deleted',
  /** The Memory Curator retired it as out of date: may come back. */
  RETIRED = 'retired',
}

/** Same values as the contract's notebook.added kind. */
export enum GuideNotebookKind {
  FIRST_MOVE = 'first_move',
  POSSIBLE_SELF = 'possible_self',
  JOURNAL_LINE = 'journal_line',
  REHEARSED_LINE = 'rehearsed_line',
  REFLECTION = 'reflection',
  NOTICING = 'noticing',
}

export enum GuideAppointmentStatus {
  SCHEDULED = 'scheduled',
  SENT = 'sent',
  CANCELLED = 'cancelled',
  MISSED = 'missed',
}

export enum GuideCrisisScope {
  PLATFORM = 'platform',
  TENANT = 'tenant',
}

/** How a learner reached a course (plan §4.13 measurement). */
export enum TrackEntrySource {
  PUBLIC_LINK = 'public_link',
  IN_APP = 'in_app',
  GUIDED = 'guided',
  OUTREACH = 'outreach',
}
