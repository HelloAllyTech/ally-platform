import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * Who may act in the Debrief console (debrief-console-redesign-notes.md, "Who
 * can act"). Reading stays open to everyone with console access; every action
 * names the permissions that may take it, enforced by PermissionsGuard (OR)
 * and mirrored in the `can` objects the payloads carry so the UI shows only
 * the buttons a viewer may press. No new roles: existing groups plus one
 * permission.
 *
 * - TEAM: the Ally team, the platform tier that already reaches the console
 *   (`system:access`: PLATFORM_ADMIN, SUPER_ADMIN, SUPER_DUPER_ADMIN).
 * - ADVISOR: the clinical advisor, `review:admin:debriefs`, granted person by
 *   person; no group holds it (1981900780000 revoked it from the platform
 *   groups). Advisor routes accept it on its own, without `system:access`.
 * - OWNER: `manage:admin:debrief-settings` (SUPER_DUPER_ADMIN, or person by
 *   person).
 */
const TEAM = PERMISSIONS.SYSTEM_ACCESS;
const ADVISOR = PERMISSIONS.REVIEW_DEBRIEFS;
const OWNER = PERMISSIONS.MANAGE_DEBRIEF_SETTINGS;

export const DEBRIEF_ACTIONS = {
  /** Comment on selected words; reply, edit, resolve. */
  comment: [TEAM, ADVISOR, OWNER],
  /** Keep / Correct / Remove a flag (an advisor alone: only flags escalated to them). */
  flagDecision: [TEAM, OWNER, ADVISOR],
  /** Held or below-the-bar debrief: Publish as it is, Show today's, Looks fine, Correct. */
  heldDebrief: [TEAM, OWNER],
  escalate: [TEAM, OWNER],
  /** Expert verdict and hard fails. */
  verdict: [ADVISOR],
  /** PM agent: approve, promote, reject, try it, ask a question, run now; propose a pinned rule. */
  pmAgent: [TEAM, OWNER],
  approvePinnedRule: [ADVISOR, OWNER],
  testSets: [TEAM, OWNER],
  /** Roll back, change step models, make a release, shadow-run a session. */
  releases: [TEAM, OWNER],
  switchOrgOn: [OWNER],
  /** Urgent, so not owner-only. */
  emergencyStop: [TEAM, OWNER],
  /** Budgets, test thresholds, accepting proposed values, autonomy unlocks, steering weights. */
  ownerSettings: [OWNER],
} as const satisfies Record<string, readonly string[]>;

export type DebriefAction = keyof typeof DEBRIEF_ACTIONS;

/** The permissions that let someone read the console: platform access, the advisor's or the owner's. */
const READ = [TEAM, ADVISOR, OWNER];

/**
 * Read routes: the Analytics toggle (or the clinical advisor's toggle), and
 * platform access or the advisor permission.
 */
export function DebriefRead() {
  return RequireFeatureToggle(FeatureToggleKey.ANALYTICS, {
    permissions: READ,
    operator: 'OR',
    alsoAllowedBy: FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF,
  });
}

/** An action route: console access plus one of the action's permissions. */
export function DebriefAct(action: DebriefAction) {
  return RequireFeatureToggle(FeatureToggleKey.ANALYTICS, {
    permissions: [...DEBRIEF_ACTIONS[action]],
    operator: 'OR',
    alsoAllowedBy: FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF,
  });
}

export interface DebriefViewerRoles {
  /** Platform access: the Ally team. */
  allyTeam: boolean;
  /** Holds `review:admin:debriefs`. */
  clinicalAdvisor: boolean;
  owner: boolean;
  /**
   * Escalations are addressed to this viewer: a clinical advisor named with
   * the "Debriefs — Clinical advisor" toggle (who is notified), or one who is
   * not also on the Ally team (a team member granted `review:admin:debriefs`
   * by hand does not see "Escalated to you" unless named).
   */
  receivesEscalations: boolean;
}

export type DebriefCan = Record<DebriefAction, boolean>;

/** What a viewer may do, from their permissions. */
export function debriefCan(permissions: readonly string[]): DebriefCan {
  const has = new Set(permissions);
  return Object.fromEntries(
    Object.entries(DEBRIEF_ACTIONS).map(([action, allowed]) => [
      action,
      allowed.some((p) => has.has(p)),
    ]),
  ) as DebriefCan;
}

export function debriefRoles(
  permissions: readonly string[],
  namedClinicalAdvisor = false,
): DebriefViewerRoles {
  const has = new Set(permissions);
  const allyTeam = has.has(TEAM);
  const clinicalAdvisor = has.has(ADVISOR);
  return {
    allyTeam,
    clinicalAdvisor,
    owner: has.has(OWNER),
    receivesEscalations: clinicalAdvisor && (namedClinicalAdvisor || !allyTeam),
  };
}

export interface DebriefViewer {
  userId: number;
  roles: DebriefViewerRoles;
  can: DebriefCan;
}

/**
 * May this viewer decide this flag? The Ally team and the owner decide any
 * open or escalated flag; a clinical advisor only one escalated to them.
 */
export function canDecideFlag(
  viewer: Pick<DebriefViewer, 'roles'>,
  flagStatus: string,
): boolean {
  if (viewer.roles.allyTeam || viewer.roles.owner) return true;
  return viewer.roles.clinicalAdvisor && flagStatus === 'escalated';
}
