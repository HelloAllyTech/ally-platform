import { PmCardStatus } from '../enum/pm-agent.enum';

/** The 10-second undo window after Accept (plan §2.3); the card is filed when it closes. */
export const PM_UNDO_WINDOW_MS = 10_000;

/** A reason may be added or replaced this long after a reject (the reason toast). */
export const PM_REJECT_REASON_WINDOW_MS = 30_000;

/** A skipped question is not asked again for this long. */
export const PM_SKIP_SUPPRESSION_MS = 14 * 24 * 60 * 60 * 1000;

/** How long a parked outbox row (a transient filing failure) waits before the next try. */
export const PM_OUTBOX_RETRY_MS = 5 * 60 * 1000;

/** A claimed outbox row is locked this long; a crashed worker's row is retaken after. */
export const PM_OUTBOX_LOCK_MS = 2 * 60 * 1000;

/** Attempts at one step before the card goes to needs_attention. */
export const PM_OUTBOX_MAX_ATTEMPTS = 5;

/** Settings validation bounds (docs/pm-agent.md). */
export const PM_SETTINGS_LIMITS = {
  QUEUE_CAP_MIN: 1,
  QUEUE_CAP_MAX: 10,
  RUN_HOUR_MIN: 0,
  RUN_HOUR_MAX: 23,
  LESSONS_WEEKDAY_MIN: 0,
  LESSONS_WEEKDAY_MAX: 6,
  MANDATE_MAX: 4000,
  MEMORY_VALUE_MAX: 2000,
  FEEDBACK_TEXT_MAX: 2000,
  REASON_MAX: 500,
  CUSTOM_ANSWER_MAX: 500,
} as const;

/** IST is UTC+05:30 with no DST: the month and run-hour boundaries use it. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Builder's userId for platform actions nobody clicked (auto-merge uses the same). */
export const PM_PLATFORM_USER_ID = 0;

/** The open review queue: what counts towards the cap. */
export const PM_QUEUE_STATUSES: PmCardStatus[] = [PmCardStatus.OPEN];

/** Accepted work still moving: waiting out the undo window, being filed, or on the roadmap. */
export const PM_IN_PROGRESS_STATUSES: PmCardStatus[] = [
  PmCardStatus.ACCEPTED_PENDING,
  PmCardStatus.QUEUED,
  PmCardStatus.FILED,
];

/**
 * Accepted work that stopped in front of a person (unless dismissed). FAILED and
 * MERGED_NOT_RELEASED are legacy Builder statuses; migration 1982100000100 moved every such
 * card to handed_off, so in practice this is NEEDS_ATTENTION.
 */
export const PM_NEEDS_YOU_STATUSES: PmCardStatus[] = [
  PmCardStatus.FAILED,
  PmCardStatus.NEEDS_ATTENTION,
  PmCardStatus.MERGED_NOT_RELEASED,
];

/** Statuses the reconcile job re-reads from the roadmap: a filed card follows its opportunity. */
export const PM_RECONCILED_STATUSES: PmCardStatus[] = [PmCardStatus.FILED];

/** The Agent › History view. */
export const PM_HISTORY_STATUSES: PmCardStatus[] = [
  PmCardStatus.REJECTED,
  PmCardStatus.FEEDBACK_CLOSED,
  PmCardStatus.ANSWERED,
  PmCardStatus.SKIPPED,
  PmCardStatus.EXPIRED,
];

/** Scheduler task names (scheduledTaskRegistry). */
export const PM_AGENT_RECONCILE_TASK = 'pm-agent-reconcile';
export const PM_AGENT_RECONCILE_INTERVAL = '5min';

/**
 * Advisory-lock namespace for the outbox worker. Not 4919 (scheduler), 4920 (UX Signals /
 * Debrief schedules) or 4921 (global scenario tenant): a shared namespace would make
 * unrelated jobs skip or block each other.
 */
export const PM_OUTBOX_LOCK_NAMESPACE = 1982000;
export const PM_OUTBOX_LOCK_KEY = 1;
