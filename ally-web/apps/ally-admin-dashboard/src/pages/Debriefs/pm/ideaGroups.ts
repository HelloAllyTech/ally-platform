import { PmAgentIdeaRow } from "@types";

import { DebriefAccess } from "../debriefAccess";

export const SCREENABLE = new Set(["prompt_edit", "setting"]);
export const HANDOFF_KINDS = new Set(["needs_code", "defect", "needs_person"]);

/**
 * What approving does next: for a change, start the canary after a passed trial or promote
 * after a passed canary; for Builder, Bug Hunter or a person, act on the hand-off once the PM
 * agent has written it.
 */
export const stage = (idea: PmAgentIdeaRow): "canary" | "promote" | "handoff" | null => {
  if (HANDOFF_KINDS.has(idea.change.ideaKind)) {
    return idea.evidence.handoff?.status === "waiting" ? "handoff" : null;
  }
  if (idea.evidence.canary?.status === "passed") return "promote";
  if (idea.evidence.canary?.status === "running") return null;
  return idea.evidence.trial?.status === "passed" ? "canary" : null;
};

export type IdeaGroup =
  | "needs"
  | "canary"
  | "testing"
  | "promoted"
  | "rejected"
  | "expired"
  | "reverted";
export const OPEN_GROUPS: IdeaGroup[] = ["needs", "canary", "testing"];
export const CLOSED_GROUPS: IdeaGroup[] = ["promoted", "rejected", "expired", "reverted"];
export const IDEA_GROUPS: IdeaGroup[] = [...OPEN_GROUPS, ...CLOSED_GROUPS];

const expired = (idea: PmAgentIdeaRow) =>
  !!idea.expired || !!idea.approval?.expired || idea.notTakenForwardReason === "no_decision";

/** May this viewer decide on this idea now? ally-be's `can` wins when it sends one. */
export const needsViewer = (idea: PmAgentIdeaRow, access: DebriefAccess): boolean => {
  if (idea.status !== "proposed" || expired(idea)) return false;
  if (idea.can) {
    if (idea.approval?.wait === "promote") return false;
    return idea.can.approve || (idea.change.ideaKind === "pinned_rule" && access.approvePinnedRule);
  }
  if (idea.change.ideaKind === "pinned_rule") return access.approvePinnedRule;
  const next = stage(idea);
  return access.pmAgent && (next === "canary" || next === "handoff");
};

/**
 * Which list an idea sits in on the Ideas page. "Needs you" is from the viewer's side: an idea
 * waiting on a role the viewer doesn't hold reads as still being tested.
 */
const CLOSED_AS: Record<string, IdeaGroup> = {
  promoted: "promoted",
  signed_off: "promoted",
  handed_off: "promoted",
  answered: "promoted",
  rejected: "rejected",
  did_not_pass: "rejected",
  retired: "rejected",
  expired: "expired",
  reverted: "reverted",
};

export const ideaGroup = (idea: PmAgentIdeaRow, access: DebriefAccess): IdeaGroup => {
  // ally-be says open or closed, and why it closed; the rest is worked out for an older backend.
  if (idea.state === "closed") return CLOSED_AS[idea.closedReason ?? ""] ?? "rejected";
  const c = idea.evidence.canary?.status;
  if (idea.state === "open") {
    if (c === "running" || c === "passed") return "canary";
    return needsViewer(idea, access) ? "needs" : "testing";
  }
  if (c === "reverted") return "reverted";
  if (expired(idea)) return "expired";
  if (c === "promoted" || idea.status === "active" || idea.status === "approved") {
    return "promoted";
  }
  if (["rejected", "retired", "blocked", "quarantined"].includes(idea.status)) return "rejected";
  if (c === "running" || c === "passed") return "canary";
  if (needsViewer(idea, access)) return "needs";
  return "testing";
};

export const isOpenGroup = (g: IdeaGroup) => OPEN_GROUPS.includes(g);

/** Waiting time from the idea's creation; when it lapses (if ally-be sends an expiry). */
export const daysLeft = (idea: PmAgentIdeaRow, now: number = Date.now()): number | null =>
  idea.approval?.expiresAt
    ? Math.ceil((new Date(idea.approval.expiresAt).getTime() - now) / 86_400_000)
    : null;

/** Expiry within this many days turns the wait amber and raises the PM agent banner. */
export const EXPIRY_WARNING_DAYS = 3;

/** A canary that reverted on its own within this window still raises the red banner. */
export const REVERT_BANNER_DAYS = 7;

export const recentlyReverted = (ideas: PmAgentIdeaRow[], now: number = Date.now()) =>
  ideas.filter(
    i =>
      i.evidence.canary?.status === "reverted" &&
      now - new Date(i.evidence.canary.startedAt).getTime() < REVERT_BANNER_DAYS * 86_400_000,
  );
