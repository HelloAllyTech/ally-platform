/**
 * The seam between the card/state layer and the generation pipeline (lanes, critic, ranker,
 * scheduler). PmAgentRunService provides it (pm-agent.module.ts); the card and state
 * services depend only on this interface, so the pipeline never sits on their import graph.
 */
export const PM_AGENT_RUN_TRIGGER = Symbol('PM_AGENT_RUN_TRIGGER');

export interface PmAgentRunTrigger {
  /** Run now (POST /run). Must respect the kill switch, budget and queue cap itself. */
  runNow(
    userId: number,
  ): Promise<{ runId: string | null; started: boolean; reason?: string }>;

  /**
   * Feedback with "Revise now": run the revisions lane for this feedback row at once,
   * budget permitting. Fire-and-forget from the caller's point of view.
   */
  reviseNow(feedbackId: string, userId: number): Promise<void>;
}
