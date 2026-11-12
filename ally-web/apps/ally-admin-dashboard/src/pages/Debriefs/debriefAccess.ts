import { useMemo } from "react";

import { useSelector } from "react-redux";

import { Permissions } from "@constants";
import { RootState } from "@store";

/**
 * Who may act in the Debriefs console (build notes, "Who can act"). Everyone who can open the
 * console reads everything; each action is shown only to the roles that may take it, and ally-be
 * enforces the same rules. This is the one place the rules live: when ally-be sends a payload's
 * own `can` object, pass it in and it wins over what the permissions say.
 */
export interface DebriefAccess {
  /** The Ally team's reviewer work (queue, held debriefs, escalation, PM agent, releases). */
  team: boolean;
  /** The clinical advisor: review rights only. */
  advisor: boolean;
  /** Settings and budgets; also does Ally team work. */
  owner: boolean;
  /** Comment on selected words; reply, edit, resolve. */
  comment: boolean;
  /** Keep, Correct, Remove on any flag (the advisor only on escalated ones: see `decideFlag`). */
  decideFlags: boolean;
  /** Publish as it is, Show today's debrief, Looks fine. */
  decideHeld: boolean;
  escalate: boolean;
  /** Good / Needs work and the hard fails. */
  verdict: boolean;
  /** Score by hand, the "To score" category and the "!" badge. */
  score: boolean;
  /** Approve, promote, reject, run now, quick tests, questions. */
  pmAgent: boolean;
  approvePinnedRule: boolean;
  testSets: boolean;
  releases: boolean;
  switchOn: boolean;
  emergencyStop: boolean;
  /** Budgets, test thresholds, proposed values, autonomy unlocks, steering weights. */
  settings: boolean;
}

export type DebriefCan = Partial<Record<keyof DebriefAccess, boolean>>;

export const debriefAccessFor = (
  permissions: string[] | undefined,
  can?: DebriefCan | null,
): DebriefAccess => {
  const has = (p: Permissions) => (permissions ?? []).includes(p);
  const owner = has(Permissions.OWN_DEBRIEFS);
  const team = owner || has(Permissions.MANAGE_DEBRIEFS);
  const advisor = has(Permissions.REVIEW_DEBRIEFS);
  const derived: DebriefAccess = {
    team,
    advisor,
    owner,
    comment: team || advisor,
    decideFlags: team,
    decideHeld: team,
    escalate: team,
    verdict: advisor,
    score: advisor,
    pmAgent: team,
    approvePinnedRule: advisor || owner,
    testSets: team,
    releases: team,
    switchOn: owner,
    emergencyStop: team,
    settings: owner,
  };
  return { ...derived, ...(can ?? {}) };
};

/**
 * May this viewer decide on this flag? The team on any flag; the clinical advisor only on one
 * escalated to them.
 */
export const canDecideFlag = (access: DebriefAccess, escalated: boolean): boolean =>
  access.decideFlags || (access.advisor && escalated);

export const useDebriefAccess = (can?: DebriefCan | null): DebriefAccess => {
  const permissions = useSelector((state: RootState) => state.user?.permissions);
  return useMemo(() => debriefAccessFor(permissions, can), [permissions, can]);
};
