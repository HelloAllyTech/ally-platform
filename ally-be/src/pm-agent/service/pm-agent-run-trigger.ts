/**
 * The seam between the card/state layer (this module's foundations) and the generation
 * pipeline (lanes, critic, ranker, scheduler), which is built separately.
 *
 * The pipeline provides an implementation under PM_AGENT_RUN_TRIGGER; until then the
 * no-op default answers "not started" and records nothing, so every endpoint works and
 * nothing is spent.
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

export class NoopPmAgentRunTrigger implements PmAgentRunTrigger {
  async runNow(): Promise<{
    runId: string | null;
    started: boolean;
    reason?: string;
  }> {
    return { runId: null, started: false, reason: 'pipeline_unavailable' };
  }

  async reviseNow(): Promise<void> {
    // The revision runs first on the next scheduled run instead.
  }
}
