import type { PlanCloseReadiness } from '../util/plan-close-readiness.util';

/**
 * What the plan flow (product-roadmap) offers Builder's interview and session
 * code, which cannot import it: ProductRoadmapModule imports BuilderModule,
 * so the reverse import would be a cycle. The roadmap registers its handlers
 * at module init (PlanCloseReadinessService); Builder calls through here.
 * With nothing registered (a unit fixture, the eval sandbox) every call is a
 * no-op, so Builder behaves exactly as it did before.
 */
export interface PlanGateHandlers {
  /**
   * The open blockers to closing this session's plan, from the one
   * definition (plan-close-readiness.util). Null when the session is not a
   * shared plan that is being planned.
   */
  readiness(sessionId: string): Promise<PlanCloseReadiness | null>;
  /**
   * The PRD has just read ready for the first time (INTERVIEWING ->
   * PRD_READY): run the specialist reviewers the plan needs. Fire and forget.
   */
  prdReadied(sessionId: string): Promise<void>;
}

class PlanGateRegistry {
  private handlers: PlanGateHandlers | null = null;

  register(handlers: PlanGateHandlers): void {
    this.handlers = handlers;
  }

  /** For tests. */
  clear(): void {
    this.handlers = null;
  }

  /** Never throws: a gate that cannot be read leaves the caller as it was. */
  async readiness(sessionId: string): Promise<PlanCloseReadiness | null> {
    if (!this.handlers) return null;
    try {
      return await this.handlers.readiness(sessionId);
    } catch {
      return null;
    }
  }

  prdReadied(sessionId: string): void {
    if (!this.handlers) return;
    void this.handlers.prdReadied(sessionId).catch(() => undefined);
  }
}

export const planGateRegistry = new PlanGateRegistry();
