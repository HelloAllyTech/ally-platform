import { FeatureToggleKey, Permissions } from "@constants";
import { hasFeature, hasPermissions } from "@utils";

import { useUser } from "./useUser";

/**
 * Whether this admin can use Course Copilot at all: the per-user feature toggle, Create Courses,
 * AND the edit grant. One gate rather than view/edit tiers — a read-only session list has nothing to show
 * without the chat that produced the sessions. Decides the sidebar entry, the Simulation Studio
 * "Course with Copilot" option and CreateTrack's "Ask Copilot" button; the routes enforce the
 * same pair through PrivateLayout.
 *
 * Both halves are required for the same reason as `deriveNavigationItems`'s Simulation Studio
 * case: the toggle alone would surface the entry for a role that cannot call the endpoints.
 */
export const useCanUseCourseCopilot = (): boolean => {
  const { permissions, features } = useUser();
  return (
    hasFeature(features, FeatureToggleKey.COURSE_COPILOT) &&
    // Copilot builds and edits courses, so an admin for whom courses are
    // view-only cannot use it; ally-be refuses the session the same way.
    hasFeature(features, FeatureToggleKey.CREATE_COURSES) &&
    hasPermissions(permissions, [Permissions.EDIT_COURSE_COPILOT])
  );
};
