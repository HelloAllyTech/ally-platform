export enum ScenarioSessionLeaderboardEvent {
  SCENARIO_SESSION_ENDED = 'SCENARIO_SESSION_ENDED',
}

export interface ScenarioSessionLeaderboardEndedEventParams {
  userId: number;
  tenantId: string;
  date: Date;
  durationMinutes: number;
  /**
   * The session these minutes came from. Consumers that must not double-count a
   * redelivered event key their idempotency on it — the emit itself is already gated on
   * winning the IN_PROGRESS -> COMPLETED compare-and-set, but a consumer that writes its
   * own ledger needs a stable identity for the row, not just the promise of one caller.
   */
  scenarioSessionId: string;
}

/**
 * A roleplay finished: emitted once per session by whichever path wins the
 * IN_PROGRESS -> COMPLETED compare-and-set, whatever its recorded duration.
 * The Debrief agent starts the learner's debrief from it (PRD NFR-1: visible
 * within 75 s p50 of session end). Kept apart from SCENARIO_SESSION_ENDED,
 * which is about practice minutes and is skipped when none were recorded.
 */
export enum ScenarioSessionCompletionEvent {
  SCENARIO_SESSION_COMPLETED = 'SCENARIO_SESSION_COMPLETED',
}

export interface ScenarioSessionCompletedEventParams {
  scenarioSessionId: string;
  tenantId: string | null;
}

export enum LeaderboardActionEvent {
  MINUTES_PLAYED_UPDATED = 'MINUTES_PLAYED_UPDATED',
}

export interface MinutesPlayedUpdatedEventParams {
  userId: number;
  tenantId: string;
  /** Business-timezone calendar day (YYYY-MM-DD) the minutes were credited to. */
  businessDate: string;
  /**
   * True when this write pushed the day across the 1.00-minute active-day line.
   * A day can only cross once, so consumers can use it to run once-per-active-day
   * work (streak badges) without a pre-read.
   */
  crossedActiveThreshold: boolean;
}
