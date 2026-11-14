import { useMemo } from "react";

import { useSelector } from "react-redux";

import { Permissions } from "@constants";
import { RootState } from "@store";
import { DebriefViewer } from "@types";

/**
 * Who may act in the Debriefs console (build notes "Who can act"; CONSOLE_API.md "Roles"). Everyone
 * who can open the console reads everything; each action is shown only to the roles that may take
 * it, and ally-be enforces the same rules (403). This is the one place the rules live: every
 * console payload carries `viewer`, which wins; until one has loaded, the user's permissions stand
 * in for it.
 */
export interface DebriefAccess {
  /** The Ally team's reviewer work (queue, held debriefs, escalation, PM agent, releases). */
  team: boolean;
  /** The clinical advisor: review rights only. */
  advisor: boolean;
  /** Settings and budgets. */
  owner: boolean;
  /** Gets the "Escalated to you" bar, banner and count. */
  receivesEscalations: boolean;
  /** Comment on selected words; reply, edit, resolve. */
  comment: boolean;
  /** Keep, Correct, Remove on any flag (the advisor only on escalated ones: see `canDecideFlag`). */
  decideFlags: boolean;
  /** Publish as it is, Show today's debrief, Looks fine, correct without a flag. */
  decideHeld: boolean;
  escalate: boolean;
  /** Good / Needs work and the hard fails. */
  verdict: boolean;
  /** Approve, put live, reject, run now, quick checks, questions. */
  pmAgent: boolean;
  approvePinnedRule: boolean;
  testSets: boolean;
  releases: boolean;
  switchOn: boolean;
  emergencyStop: boolean;
  /** Budgets, test thresholds, proposed values, autonomy, steering weights. */
  settings: boolean;
  /** Agent logs: every agent's exact input and reply (the Ally team only). */
  agentLogs: boolean;
}

/** ally-be's `viewer` in the console's words. */
export const accessFromViewer = (viewer: DebriefViewer): DebriefAccess => ({
  team: viewer.roles.allyTeam,
  advisor: viewer.roles.clinicalAdvisor,
  owner: viewer.roles.owner,
  receivesEscalations: viewer.roles.receivesEscalations,
  comment: viewer.can.comment,
  decideFlags: viewer.can.flagDecision && (viewer.roles.allyTeam || viewer.roles.owner),
  decideHeld: viewer.can.heldDebrief,
  escalate: viewer.can.escalate,
  verdict: viewer.can.verdict,
  pmAgent: viewer.can.pmAgent,
  approvePinnedRule: viewer.can.approvePinnedRule,
  testSets: viewer.can.testSets,
  releases: viewer.can.releases,
  switchOn: viewer.can.switchOrgOn,
  emergencyStop: viewer.can.emergencyStop,
  settings: viewer.can.ownerSettings,
  agentLogs: !!viewer.can.agentLogs,
});

/** The same rules from the user's permissions, for before a payload has said. */
export const debriefAccessFor = (permissions: string[] | undefined): DebriefAccess => {
  const has = (p: Permissions) => (permissions ?? []).includes(p);
  const owner = has(Permissions.MANAGE_DEBRIEF_SETTINGS);
  const allyTeam = has(Permissions.SYSTEM_ACCESS);
  const team = allyTeam || owner;
  const advisor = has(Permissions.REVIEW_DEBRIEFS);
  return {
    team,
    advisor,
    owner,
    receivesEscalations: advisor && !allyTeam,
    comment: team || advisor,
    decideFlags: team,
    decideHeld: team,
    escalate: team,
    verdict: advisor,
    pmAgent: team,
    approvePinnedRule: advisor || owner,
    testSets: team,
    releases: team,
    switchOn: owner,
    emergencyStop: team,
    settings: owner,
    agentLogs: allyTeam,
  };
};

/**
 * May this viewer decide on this flag? The team on any flag; the clinical advisor only on one
 * escalated to them. ally-be's per-flag `canDecide` wins when it has one.
 */
export const canDecideFlag = (
  access: DebriefAccess,
  escalated: boolean,
  canDecide?: boolean,
): boolean => canDecide ?? (access.decideFlags || (access.advisor && escalated));

export const useDebriefAccess = (viewer?: DebriefViewer | null): DebriefAccess => {
  const permissions = useSelector((state: RootState) => state.user?.permissions);
  return useMemo(
    () => (viewer ? accessFromViewer(viewer) : debriefAccessFor(permissions)),
    [permissions, viewer],
  );
};
