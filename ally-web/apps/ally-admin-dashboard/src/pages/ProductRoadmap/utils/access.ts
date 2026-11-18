import { FeatureToggleKey, Permissions } from "@constants";
import { hasFeature } from "@utils";

import type { RoadmapRole } from "../../../types/roadmapV2";

/**
 * Whether this reader gets the roadmap's manage affordances: stage transitions, editing or
 * deleting anyone's opportunity, the goal taxonomy, split/merge, month-board lane moves, pinning
 * a view for everyone. NOT opening a card in Builder — see canOpenRoadmapBuilder.
 *
 * BOTH halves, in the order ally-be checks them. Every manage endpoint carries
 * `@RequireFeatureToggle(PRODUCT_ROADMAP_MANAGE, { permissions: [EDIT_PRODUCT_ROADMAP] })` — the
 * permission AND the per-user toggle, never either.
 *
 * The permission on its own stopped separating anyone at the role collapse
 * (CreatePlatformAdminRole1895000000001): PLATFORM_ADMIN carries what SUPER_DUPER_ADMIN used to,
 * so EDIT_PRODUCT_ROADMAP now sits on every platform admin and the toggle is the entire
 * distinction. Checking only the permission showed every manage control to every admin and let a
 * 403 be the first news of it.
 *
 * Extracted rather than inlined for the same reason as seedForHandle: it is one `&&`, and it is
 * the only thing between a read-only admin and a board full of buttons that answer 403.
 */
export const canManageRoadmap = (
  permissions: string[] | undefined,
  features: string[] | undefined,
): boolean =>
  !!permissions?.includes(Permissions.EDIT_PRODUCT_ROADMAP) &&
  // Empty when the toggle fetch failed (see useUser) — so this fails closed to a read-only
  // board rather than open to controls that cannot work.
  hasFeature(features, FeatureToggleKey.PRODUCT_ROADMAP_MANAGE);

/**
 * Whether this reader gets "Open in Builder Agent" on an opportunity.
 *
 * Builder access, NOT roadmap management — the same pair ally-be's
 * `POST opportunities/:id/builder-session` checks: the BUILDER toggle AND EDIT_BUILDER. It used
 * to ride `canManageRoadmap`, which meant a curator without Builder saw an icon that could only
 * 403, and nobody could be given the Builder hand-off without also getting the whole board.
 *
 * Fails closed the same way: an empty `features` (toggle fetch failed) hides the icon.
 */
export const canOpenRoadmapBuilder = (
  permissions: string[] | undefined,
  features: string[] | undefined,
): boolean =>
  !!permissions?.includes(Permissions.EDIT_BUILDER) &&
  hasFeature(features, FeatureToggleKey.BUILDER);

/**
 * The Roadmap role these toggles and permissions resolve to, read the way ally-be's
 * RoadmapRoleService reads them (roleFromGrants): Owner is Manage, Builder is Builder, Idea is
 * the board's tab, each paired with its permission, and the highest one held wins. An
 * org-restricted admin is a Viewer at most, whatever else they hold.
 *
 * Mirrors the server because `GET /v1/roadmap/me/role` answers 404 while `roadmap_v2` is off,
 * and the filing, quick-add and lead doors need the role either way. The server re-checks every
 * door; this only decides what is shown. Fails closed: an empty `features` is "none".
 */
export const roadmapRoleFor = (
  permissions: string[] | undefined,
  features: string[] | undefined,
  restricted = false,
): RoadmapRole => {
  const roadmap =
    !!permissions?.includes(Permissions.VIEW_PRODUCT_ROADMAP) &&
    hasFeature(features, FeatureToggleKey.PRODUCT_ROADMAP);
  const builder = canOpenRoadmapBuilder(permissions, features);
  const manage = canManageRoadmap(permissions, features);
  if (restricted) return roadmap || builder || manage ? "viewer" : "none";
  if (manage) return "owner";
  if (builder) return "builder";
  if (roadmap) return "idea";
  return "none";
};

const ROLE_RANK: Record<RoadmapRole, number> = {
  none: 0,
  viewer: 1,
  idea: 2,
  builder: 3,
  owner: 4,
};

const atLeast = (role: RoadmapRole, floor: RoadmapRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[floor];

/**
 * Whether this reader gets the header's quick-add door: a plain form that files straight onto
 * the board, skipping the guided interview and its readiness check.
 *
 * The VOTE permission (the tier that may file at all) AND the Owner role, the pair ally-be's
 * `POST opportunities/quick` checks. Fails closed the same way as the others: an empty `features`
 * (toggle fetch failed) hides the button rather than showing one that answers 403.
 */
export const canQuickAddRoadmap = (
  permissions: string[] | undefined,
  features: string[] | undefined,
  restricted = false,
): boolean =>
  !!permissions?.includes(Permissions.VOTE_PRODUCT_ROADMAP) &&
  atLeast(roadmapRoleFor(permissions, features, restricted), "owner");

/**
 * Whether this reader may file an idea at all: the guided interview, idea capture (park it) and
 * quick add.
 *
 * The VOTE permission AND the Idea role (or above), the pair ally-be checks on every filing
 * door. An org-restricted admin, or one with no Roadmap role, sees no filing button rather than
 * one that answers 403. Viewing and voting are unaffected.
 *
 * Fails closed: an empty `features` (toggle fetch failed) hides the doors.
 */
export const canFileIdeas = (
  permissions: string[] | undefined,
  features: string[] | undefined,
  restricted = false,
): boolean =>
  !!permissions?.includes(Permissions.VOTE_PRODUCT_ROADMAP) &&
  atLeast(roadmapRoleFor(permissions, features, restricted), "idea");

/**
 * Whether this reader gets the planning lead's tabs (Needs a lead, Signals) and actions: the
 * Builder role or above. Every lead action is checked again on the server; this only decides
 * what is shown. Fails closed on an empty `features`.
 */
export const canLeadRoadmapPlans = (
  permissions: string[] | undefined,
  features: string[] | undefined,
  restricted = false,
): boolean => atLeast(roadmapRoleFor(permissions, features, restricted), "builder");
