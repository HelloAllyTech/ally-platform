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

export type IdeaGroup = "needs" | "canary" | "testing" | "live" | "dropped";
export const IDEA_GROUPS: IdeaGroup[] = ["needs", "canary", "testing", "live", "dropped"];

const DROPPED = new Set(["rejected", "retired", "blocked", "quarantined"]);

/** May this viewer decide on this idea now? */
export const needsViewer = (idea: PmAgentIdeaRow, access: DebriefAccess): boolean => {
  if (idea.status !== "proposed" || idea.expired) return false;
  if (idea.change.ideaKind === "pinned_rule") return access.approvePinnedRule;
  const next = stage(idea);
  return access.pmAgent && (next === "canary" || next === "handoff");
};

/**
 * Which list an idea sits in on the Ideas page. "Needs you" is from the viewer's side: an idea
 * waiting on a role the viewer doesn't hold reads as still being tested.
 */
export const ideaGroup = (idea: PmAgentIdeaRow, access: DebriefAccess): IdeaGroup => {
  if (idea.expired || DROPPED.has(idea.status)) return "dropped";
  const c = idea.evidence.canary?.status;
  if (c === "running" || c === "passed") return "canary";
  if (idea.status === "active" || idea.status === "approved" || c === "promoted") return "live";
  if (needsViewer(idea, access)) return "needs";
  return "testing";
};

/** Waiting time from the idea's creation; when it lapses (if ally-be sends an expiry). */
export const daysLeft = (idea: PmAgentIdeaRow, now: number = Date.now()): number | null =>
  idea.expiresAt ? Math.ceil((new Date(idea.expiresAt).getTime() - now) / 86_400_000) : null;

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
