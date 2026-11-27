import { useSelector } from "react-redux";

import { UserRole } from "@constants";
import { RootState } from "@store";

/**
 * Whether the signed-in user holds PLATFORM_ADMIN. Reads the `roles` array, never the legacy
 * single `role` (a lossy collapse of the user's groups).
 */
export const useIsPlatformAdmin = (): boolean =>
  useSelector((state: RootState) => {
    const roles = (state.user?.user as { roles?: unknown } | null | undefined)?.roles;
    return Array.isArray(roles) && roles.includes(UserRole.PLATFORM_ADMIN);
  });
