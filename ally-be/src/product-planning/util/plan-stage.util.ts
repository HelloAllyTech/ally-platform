import { PlanStage } from '../enum/product-planning.enum';

/**
 * Everything a plan's stage is derived from. Facts, never a model's opinion
 * (plans/roadmap-owns-planning rev 5.2 §B.4): the LLM can propose to move on,
 * but only these decide where a plan is.
 */
export interface PlanStageFacts {
  private: boolean;
  closed: boolean;
  leadUserId: number | null;
  /** PRD readiness as the plan defines it (Builder readiness + success measure + checks). */
  prdReady: boolean;
  /** The technical design is approved and not stale. */
  designApproved: boolean;
  /** A build run exists or has existed for this session. */
  buildStarted: boolean;
  /** The opportunity's work is released (merged and deployed). */
  shipped: boolean;
  /** The launch checklist is complete. */
  launched: boolean;
  /** Outcome reviews scheduled and done. */
  reviewsDue: number;
  reviewsDone: number;
}

/**
 * The stage a plan is in. Pure; the order of the checks IS the definition.
 *
 * - CLOSED wins over everything: a closed plan stays closed until reopened.
 * - A private session is an IDEA whatever else is true of it.
 * - After release: LAUNCHING until the checklist is done, then MEASURING until
 *   every scheduled outcome review has run, then LEARNED.
 * - Before release: BUILDING once any build exists, READY once the design is
 *   approved, DESIGN once the PRD is ready, PRD once a lead holds it, FILED
 *   otherwise.
 */
export function derivePlanStage(facts: PlanStageFacts): PlanStage {
  if (facts.closed) return PlanStage.CLOSED;
  if (facts.private) return PlanStage.IDEA;
  if (facts.shipped) {
    if (!facts.launched) return PlanStage.LAUNCHING;
    if (facts.reviewsDue > 0 && facts.reviewsDone >= facts.reviewsDue) {
      return PlanStage.LEARNED;
    }
    return PlanStage.MEASURING;
  }
  if (facts.buildStarted) return PlanStage.BUILDING;
  if (facts.designApproved) return PlanStage.READY;
  if (facts.prdReady) return PlanStage.DESIGN;
  if (facts.leadUserId) return PlanStage.PRD;
  return PlanStage.FILED;
}

/** The stages a plan moves through, in order, for the progress bar. */
export const PLAN_PROGRESS: PlanStage[] = [
  PlanStage.IDEA,
  PlanStage.FILED,
  PlanStage.PRD,
  PlanStage.DESIGN,
  PlanStage.READY,
  PlanStage.BUILDING,
  PlanStage.LAUNCHING,
  PlanStage.MEASURING,
  PlanStage.LEARNED,
];
