import { useSelector } from "react-redux";

import { FeatureToggleKey, Permissions } from "@constants";
import { RootState } from "@store";
import { hasFeature, hasPermissions } from "@utils";

/**
 * What this admin may do in the Ally Console and on an organisation's Ally tab.
 *
 * Every field is a feature toggle AND a permission, in the pairs ally-be's
 * `GuideAdminController` checks (`@RequireFeatureToggle(KEY, { permissions: [...] })`). The
 * permission alone separates nobody since the platform-admin role collapse — every platform admin
 * carries it — so the toggle is the real gate, and either half missing is a 403 on click.
 *
 * Fails closed: `features` is `[]` while the toggle fetch is loading or after it failed, so every
 * field reads false rather than showing controls that cannot work.
 */
export interface AllyGuideAccess {
  /** The Console: overview, conversations (no content), releases, settings, platform crisis copy. */
  canView: boolean;
  /** Kill switches, promote and rollback, platform crisis copy. Also needs `canView` to be reachable. */
  canEdit: boolean;
  /**
   * Redacted transcripts and the trace payload — the learner's words. A per-person grant on its own
   * toggle and permission; deliberately NOT implied by `canEdit`.
   */
  canReadTranscripts: boolean;
  /** An organisation's Ally tab: support lines, supervisor wording, protocols, crisis copy. */
  canViewOrg: boolean;
  canEditOrg: boolean;
}

export const deriveAllyGuideAccess = (
  permissions: string[] | undefined,
  features: string[] | undefined,
): AllyGuideAccess => {
  const held = permissions ?? [];
  const has = (permission: Permissions) => hasPermissions(held, [permission]);
  return {
    canView: hasFeature(features, FeatureToggleKey.ALLY_GUIDE) && has(Permissions.VIEW_ALLY_GUIDE),
    canEdit: hasFeature(features, FeatureToggleKey.ALLY_GUIDE) && has(Permissions.EDIT_ALLY_GUIDE),
    canReadTranscripts:
      hasFeature(features, FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS) &&
      has(Permissions.REVIEW_ALLY_GUIDE_TRANSCRIPTS),
    canViewOrg:
      hasFeature(features, FeatureToggleKey.ALLY_GUIDE_ORG) && has(Permissions.VIEW_ALLY_GUIDE),
    canEditOrg:
      hasFeature(features, FeatureToggleKey.ALLY_GUIDE_ORG) && has(Permissions.EDIT_ALLY_GUIDE),
  };
};

/**
 * Reads straight from the store, not `useUser`: `useUser` also runs the sign-in checks and fetches,
 * which a page that merely needs to know what to show has no business triggering. `PrivateLayout`
 * is what fills these two slices.
 */
export const useAllyGuideAccess = (): AllyGuideAccess => {
  const permissions = useSelector((state: RootState) => state.user?.permissions);
  const features = useSelector((state: RootState) => state.user?.features);
  return deriveAllyGuideAccess(permissions, features);
};
