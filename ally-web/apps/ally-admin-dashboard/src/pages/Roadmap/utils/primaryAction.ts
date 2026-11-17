import type { RoadmapItemDetail } from "@types";

/**
 * The idea page holds exactly one primary action for you, chosen by stage and role (§4.5), in the
 * plan's order: Accept (Owner) · Pick a lead (Owner) · Start planning (lead or Owner) · Approve
 * design · Build ▾ · Merge · Release. `can` decides: a control you can't use is absent, never
 * greyed out (§4.0 #14, §4.5c). When nothing is yours to do the slot holds the quiet line instead.
 */
export type PrimaryActionKind =
  | "accept"
  | "pickLead"
  | "startPlanning"
  | "approveDesign"
  | "build"
  | "merge"
  | "release";

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
      return can.review ? "accept" : null;
    case "accepted":
      if (!item.lead && can.pickLead) return "pickLead";
      return can.startPlanning ? "startPlanning" : null;
    case "planning":
      if (p.designAwaitingApproval && can.approveDesign) return "approveDesign";
      // Build ▾ holds Build here (startBuild) and the brief (exportBrief): either one is enough,
      // so a paused agent still leaves Open in Claude Code (§4.7).
      if (p.step === "ready" && (can.startBuild || can.exportBrief)) return "build";
      return null;
    case "building":
      if (p.heldReason && can.release) return "release";
      if (can.merge) return "merge";
      return null;
    default:
      return null;
  }
};

/**
 * Which of those exist in P2. The rest arrive with their phases and render nothing until then:
 * Accept / Pick a lead (P3), Start planning (P3b), Build ▾ (P4), Merge and Release (P4/P5, with the
 * release policy). Approve design is live: the Design tab's existing panel does the approving.
 */
export const PRIMARY_ACTIONS_BUILT: PrimaryActionKind[] = ["approveDesign"];
