import { RoadmapOpportunity, RoadmapOpportunityStage } from "@types";

/** The fields triage edits in place. Anything else goes through the drawer. */
export type TriagePatch = Partial<
  Pick<RoadmapOpportunity, "stage" | "effort" | "productGoal" | "ownerUserId" | "plannedMonth">
>;

/** How long the Undo toast stays up. Long enough to notice a slip, short enough not to nag. */
export const UNDO_WINDOW_MS = 8000;

/** The one-tap reasons for a rejection, in display order. Stored as a comment. */
export const REJECT_REASONS = [
  { id: "duplicate", key: "duplicate" },
  { id: "outOfScope", key: "outOfScope" },
  { id: "notNow", key: "notNow" },
  { id: "needsInfo", key: "needsInfo" },
] as const;
export type RejectReasonId = (typeof REJECT_REASONS)[number]["id"];

/**
 * The values to send to put a patch back the way it was.
 *
 * Read from the opportunity AS IT WAS when the change was made, not refetched later, so an undo
 * restores exactly what the person saw. A legacy `under_development` stage is restored as
 * Prioritised — it is the same thing on screen, and the stage is retired.
 */
export const inversePatch = (opportunity: RoadmapOpportunity, patch: TriagePatch): TriagePatch => {
  const inverse: TriagePatch = {};
  (Object.keys(patch) as (keyof TriagePatch)[]).forEach(key => {
    if (key === "stage") {
      inverse.stage =
        opportunity.stage === RoadmapOpportunityStage.UNDER_DEVELOPMENT
          ? RoadmapOpportunityStage.PRIORITISED
          : opportunity.stage;
    } else if (key === "ownerUserId") {
      inverse.ownerUserId = opportunity.ownerUserId ?? null;
    } else if (key === "effort") {
      inverse.effort = opportunity.effort ?? null;
    } else if (key === "plannedMonth") {
      inverse.plannedMonth = opportunity.plannedMonth ?? null;
    } else {
      inverse.productGoal = opportunity.productGoal;
    }
  });
  return inverse;
};

/** Where a stage goes on Accept, or null when Accept does not apply (already past Idea). */
export const acceptTarget = (stage: string): RoadmapOpportunityStage | null =>
  stage === RoadmapOpportunityStage.NEW ? RoadmapOpportunityStage.PRIORITISED : null;
