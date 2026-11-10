import React, { useEffect, useState } from "react";

import { Navigate } from "react-router-dom";

import {
  useGetUserQuery,
  useGetPermissionsQuery,
  useGetUserPreferencesQuery,
  useGetCharacterLibraryEnabledQuery,
  useGetFeatureTogglesQuery,
} from "@api";
import { LOCAL_STORAGE_KEYS, ROUTES, OrgToggle } from "@constants";
// Import the specific module rather than the "@utils" barrel: the barrel pulls
// in Redux-logger and component dependencies that this root-path redirect has no
// need for, and would otherwise bloat its chunk.
import { deriveNavigationItems } from "@utils/navigation";

/**
 * Resolves the post-login landing route to the current user's FIRST sidebar tab
 * (the top item of their personalized, permission/role-gated nav), instead of a
 * hardcoded route. Used as the element for the "/" route.
 *
 * It reads the user/permissions/preferences straight from the RTK Query cache
 * (the same auto-fetching, app-deduped queries PrivateLayout uses) and computes
 * the first tab from that data directly — so it never depends on Redux's
 * dispatch-on-data effect having landed, avoiding any one-render race. On a hard
 * refresh at "/" these queries kick off the fetch (since "/" isn't wrapped in
 * PrivateLayout); after the post-login navigate("/") they resolve instantly from
 * the cache checkAuth already populated.
 */
export const DefaultRedirect: React.FC = () => {
  const isAuthenticated =
    localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";

  // Kept for its isLoading gate below — the tab list itself is derived from
  // permissions and toggles, not from the user record.
  const { isLoading: isUserLoading } = useGetUserQuery(undefined, {
    skip: !isAuthenticated,
  });
  const { data: permissions, isLoading: isPermsLoading } = useGetPermissionsQuery(undefined, {
    skip: !isAuthenticated,
  });
  // Preferences may 403 for non-super-admins. Wait until they SETTLE (success or
  // error) so a super-admin's saved order is applied before we pick the first
  // tab; on error we proceed with no saved order (default → first accessible tab).
  const {
    data: preferences,
    isLoading: isPrefsLoading,
    isUninitialized: isPrefsUninitialized,
  } = useGetUserPreferencesQuery(undefined, { skip: !isAuthenticated });
  // Org-level Character Library switch: for a tenant admin whose only other
  // tabs are permission-gated, this can decide the landing tab.
  const { data: isCharacterLibraryOrgEnabled } = useGetCharacterLibraryEnabledQuery(undefined, {
    skip: !isAuthenticated,
  });
  // Per-user feature toggles. Required, not optional: every feature-gated tab
  // is invisible to deriveNavigationItems without them, so passing undefined
  // (as this screen used to) silently excludes them all from being the landing
  // tab — including Simulation Studio, which is the default landing for almost
  // every admin now that content_management gates it.
  const { data: features, isLoading: isFeaturesLoading } = useGetFeatureTogglesQuery(undefined, {
    skip: !isAuthenticated,
  });

  // Post-login, these gates have been seen to never clear (white page at "/",
  // reported 2026-11-10): rather than render nothing forever, show a spinner
  // and after 5s proceed with whatever data has arrived — worst case the user
  // lands on the fallback tab instead of a blank screen. The warn names the
  // stuck gate so the next report diagnoses itself from the console.
  const settled =
    !isUserLoading &&
    !isPermsLoading &&
    !isFeaturesLoading &&
    !isPrefsUninitialized &&
    !isPrefsLoading;
  const [forceProceed, setForceProceed] = useState(false);
  useEffect(() => {
    if (settled || !isAuthenticated) {
      return undefined;
    }
    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn("[DefaultRedirect] startup queries did not settle in 5s; proceeding anyway", {
        isUserLoading,
        isPermsLoading,
        isFeaturesLoading,
        isPrefsUninitialized,
        isPrefsLoading,
      });
      setForceProceed(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [
    settled,
    isAuthenticated,
    isUserLoading,
    isPermsLoading,
    isFeaturesLoading,
    isPrefsUninitialized,
    isPrefsLoading,
  ]);

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  // Never decide while core data is loading — prevents a premature bounce to the
  // fallback before the per-user tab list is known.
  if (!settled && !forceProceed) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        data-testid="default-redirect-loading"
      >
        <div className="w-8 h-8 border-2 border-gray-300 border-t-typography-800 rounded-full animate-spin" />
      </div>
    );
  }

  const items = deriveNavigationItems({
    permissions: permissions ?? [],
    features: features ?? [],
    savedOrder: preferences?.admin_sidebar_order,
    orgToggles: {
      [OrgToggle.CHARACTER_LIBRARY]: Boolean(isCharacterLibraryOrgEnabled),
    },
  });

  return <Navigate to={items[0]?.path ?? ROUTES.SIMULATION_STUDIO} replace />;
};
