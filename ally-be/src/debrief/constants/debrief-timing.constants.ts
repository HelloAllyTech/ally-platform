/**
 * The agent's timing and batch numbers, in one place (they were scattered through
 * debrief-agent.service.ts). They interlock: ally-ai cuts calls off at deadline + margin,
 * ally-be gives up at the same point, a run is resumed only after that, called stuck only after
 * it could have been resumed, and a debrief is published again only after the run has long
 * finished. `debrief-timing-invariants.spec.ts` checks the order, so changing one in isolation
 * fails a test.
 */
export const DEBRIEF_TIMING = {
  /** Sessions per 5-minute drain tick; at today's volume the backlog clears in one or two ticks. */
  drainBatch: 8,
  drainConcurrency: 2,
  /**
   * How long after a live session ends its debrief starts: long enough for the last turns to
   * land, short enough that the learner is still on the page. The drain is the backstop.
   */
  liveStartDelayMs: 45_000,
  /** Only recent sessions: a debrief days late is not what a learner waits for. */
  drainWindowHours: 48,
  /**
   * A run still "running" this long is past every deadline (150 s, 180 s with a risk cue, plus the
   * 60 s margin), so its worker is gone: it is resumed once.
   */
  resumeAfterMinutes: 5,
  maxResumes: 1,
  /** Well past the longest deadline (risk cue: 3 min) plus a slow drain: swept as stuck. */
  stuckAfterMinutes: 10,
  /**
   * A session no run has started for this long after it ended is not going to get one soon: the
   * learner gets today's debrief instead of "working".
   */
  noRunGiveUpMinutes: 30,
  /** A live run that ended without a draft is run again this many times (Gopi, 2026-11-16). */
  maxRetries: 1,
  /** A published run still not written into its session this long after it finished is published again. */
  republishAfterMinutes: 5,
  republishBatch: 20,
  /** "Your debrief is ready" is only sent for a run that finished within this long. */
  announceWithinMs: 2 * 60 * 1000,
} as const;
