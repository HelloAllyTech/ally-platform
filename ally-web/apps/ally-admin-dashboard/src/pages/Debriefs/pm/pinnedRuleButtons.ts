import { PmAgentIdeaRow } from "@types";

import { DebriefAccess } from "../debriefAccess";

export type PinnedRuleButton = "approve" | "reject" | "withdraw" | "ask";

/** What kind of pinned-rule item this is, for the viewer. */
export const pinnedRuleItemKind = (
  idea: PmAgentIdeaRow,
): "first_version" | "mine" | "someone_else" =>
  idea.change.firstVersion || idea.pinnedRule?.firstVersion
    ? "first_version"
    : idea.pinnedRule?.mine
      ? "mine"
      : "someone_else";

/**
 * The buttons on an open pinned-rule item (debrief-console-redesign-notes.md, "Pinned rules:
 * approval flow"), in order:
 * - a first version: Approve · Ask for a change (no Reject: a base version must exist);
 * - the viewer's own proposal: Approve · Withdraw;
 * - from the PM agent or another person: Approve · Reject · Ask for a change.
 * ally-be's `can` decides; without it, the clinical advisor or the owner gets the set.
 */
export const pinnedRuleButtons = (
  idea: PmAgentIdeaRow,
  access: Pick<DebriefAccess, "approvePinnedRule">,
): PinnedRuleButton[] => {
  if (idea.change.ideaKind !== "pinned_rule" || idea.status !== "proposed") return [];
  const kind = pinnedRuleItemKind(idea);
  const may = access.approvePinnedRule;
  const can = idea.can;
  const approve = can ? can.approve : may;
  const reject = can ? !!can.reject && kind === "someone_else" : may && kind === "someone_else";
  const withdraw = can ? !!can.withdraw : may && kind === "mine";
  const ask = can ? !!can.askForChange : may && kind !== "mine";
  return [approve && "approve", reject && "reject", withdraw && "withdraw", ask && "ask"].filter(
    Boolean,
  ) as PinnedRuleButton[];
};

/** Why a passage can't be proposed against this text; null when it can (mirrors ally-be). */
export const passageProblem = (
  text: string,
  passage: string,
): "empty" | "notFound" | "notUnique" | null => {
  if (!passage.trim()) return "empty";
  const at = text.indexOf(passage);
  if (at < 0) return "notFound";
  if (text.indexOf(passage, at + 1) >= 0) return "notUnique";
  return null;
};
