import { createContext, useContext } from "react";

import { useSelector } from "react-redux";

import { FeatureToggleKey, Permissions } from "@constants";
import type { RootState } from "@store";
import { hasFeature, hasPermissions } from "@utils";

/**
 * Who is looking at the Context Library (docs/context-library/PLAN.md §10.2):
 *
 * - `platform`: an admin with the Context Library toggle and its view permission. Every
 *   collection, every organisation's entries, Settings. The toggle is platform-only, so an admin
 *   restricted to some organisations never has it.
 * - `organisation`: an organisation's admin — the Ally organisation-settings toggle with the Ally
 *   guide's view permission, the gate the guide library's organisation screen had. Only
 *   collections that take organisation entries; there, their own entries (editable) and the
 *   global ones (read-only). No Settings, documents or loop changes.
 *
 * Fails closed like `useAllyGuideAccess`: `features` is `[]` until the toggles load.
 */
export type ContextLibraryMode = "platform" | "organisation";

export interface ContextLibraryAccess {
  mode: ContextLibraryMode | null;
  canEdit: boolean;
  /** Organisation mode: the organisations this admin may choose; null means any. */
  orgIds: string[] | null;
}

export const deriveContextLibraryAccess = (
  permissions: string[] | undefined,
  features: string[] | undefined,
  restrictedTenantIds: string[] | null | undefined,
): ContextLibraryAccess => {
  const held = permissions ?? [];
  const has = (permission: Permissions) => hasPermissions(held, [permission]);
  if (
    hasFeature(features, FeatureToggleKey.CONTEXT_LIBRARY) &&
    has(Permissions.VIEW_CONTEXT_LIBRARY)
  ) {
    return { mode: "platform", canEdit: has(Permissions.EDIT_CONTEXT_LIBRARY), orgIds: null };
  }
  if (hasFeature(features, FeatureToggleKey.ALLY_GUIDE_ORG) && has(Permissions.VIEW_ALLY_GUIDE)) {
    return {
      mode: "organisation",
      canEdit: has(Permissions.EDIT_ALLY_GUIDE),
      orgIds: restrictedTenantIds ?? null,
    };
  }
  return { mode: null, canEdit: false, orgIds: null };
};

/** Reads straight from the store, as `useAllyGuideAccess` does: no sign-in checks or fetches. */
export const useContextLibraryAccess = (): ContextLibraryAccess => {
  const permissions = useSelector((state: RootState) => state.user?.permissions);
  const features = useSelector((state: RootState) => state.user?.features);
  const restricted = useSelector(
    (state: RootState) => state.user?.user?.restrictedTenantIds ?? null,
  );
  return deriveContextLibraryAccess(permissions, features, restricted);
};

/**
 * The organisation an organisation admin is looking at, and the names the audience badges show.
 * `tenantId` is set only in organisation mode; every request then goes to the organisation routes.
 */
export interface ContextLibraryScope {
  tenantId?: string;
  orgNames: Record<string, string>;
}

export const ContextLibraryScopeContext = createContext<ContextLibraryScope>({ orgNames: {} });

export const useContextLibraryScope = (): ContextLibraryScope =>
  useContext(ContextLibraryScopeContext);
