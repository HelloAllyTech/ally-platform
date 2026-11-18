import type { RoadmapItemDetail } from "@types";

/**
 * The idea page holds exactly one primary action for you, chosen by stage and role (§4.5), in the
 * lifecycle's order (2026-11-18): Start planning (an Owner; accepts an idea still waiting) · Close
 * plan (an Owner) · Pick a builder (an Owner, once the plan is closed) · then the builder's own:
 * Approve design · Build ▾ · Merge · Release · Mark released. `can` decides: a control you can't use
 * is absent, never greyed out (§4.0 #14, §4.5c). When nothing is yours to do the slot holds the
 * quiet line instead.
 */
export type PrimaryActionKind =
  | "startPlanning"
  | "closePlan"
  | "pickLead"
  | "approveDesign"
  | "build"
  | "merge"
  | "release"
  | "markReleased";

const parts = (item: Pick<RoadmapItemDetail, "statusParts">): Record<string, unknown> =>
  item.statusParts && typeof item.statusParts === "object"
    ? (item.statusParts as Record<string, unknown>)
    : {};

export const primaryActionFor = (
  item: Pick<RoadmapItemDetail, "shownStage" | "statusParts" | "can" | "lead" | "reviewState">,
): PrimaryActionKind | null => {
  const can = item.can ?? {};
  const p = parts(item);
  switch (item.shownStage) {
    case "submitted":
    case "accepted":
      if (can.startPlanning) return "startPlanning";
      // An idea given a builder before plans closed: the Owner can still change the builder.
      return null;
    case "planning":
      if (!item.lead) {
        if (can.closePlan) return "closePlan";
        if (p.planClosed && can.pickLead) return "pickLead";
      }
      if (p.designAwaitingApproval && can.approveDesign) return "approveDesign";
      // Build ▾ holds Build here (startBuild) and the brief (exportBrief): either one is enough,
      // so a paused agent still leaves Open in Claude Code (§4.7). Only once a builder is assigned.
      if (item.lead && (can.startBuild || can.exportBrief)) return "build";
      return null;
    case "building":
      if (p.heldReason && can.release) return "release";
      if (can.merge) return "merge";
      if (can.markReleased) return "markReleased";
      return null;
    default:
      return null;
  }
};

/**
 * Which of those exist in P2. The rest arrive with their phases and render nothing until then:
 * Pick a lead (P3), Start planning (P3b), Build ▾ (P4), Merge and Release (P4/P5, with the
 * release policy). Approve design is live: the Design tab's existing panel does the approving.
 */
export const PRIMARY_ACTIONS_BUILT: PrimaryActionKind[] = ["approveDesign"];
