import { useSelector } from "react-redux";

import { FeatureToggleKey } from "@constants";
import type { RootState } from "@store";
import { hasFeature } from "@utils";

export interface ContentAuthoring {
  canAuthorRoleplays: boolean;
  canAuthorCases: boolean;
  canAuthorCourses: boolean;
}

/**
 * Which content types this admin may create, duplicate, edit and delete — the
 * Create Roleplays / Cases / Courses toggles (ON by default). A type whose
 * toggle is off is view-only: its items still open, read-only, and ally-be
 * refuses every write (ContentAccessService). Tracks have no toggle.
 *
 * Which items are listed at all is decided by ally-be (See All Content), so
 * nothing here filters lists.
 *
 * `features` is `[]` until loaded and on a fetch error, so these fail closed:
 * write controls stay hidden rather than flash on and then 403.
 */
export const useContentAuthoring = (): ContentAuthoring => {
  const features = useSelector((state: RootState) => state.user.features);
  return {
    canAuthorRoleplays: hasFeature(features, FeatureToggleKey.CREATE_ROLEPLAYS),
    canAuthorCases: hasFeature(features, FeatureToggleKey.CREATE_CASES),
    canAuthorCourses: hasFeature(features, FeatureToggleKey.CREATE_COURSES),
  };
};
