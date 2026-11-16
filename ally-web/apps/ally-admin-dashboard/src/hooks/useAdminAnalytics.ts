import { useCallback, useEffect } from "react";

import { useSelector } from "react-redux";

import { ANALYTICS_EVENTS, ANALYTICS_PROPS, useAnalytics } from "@ally-ui-mono/ui-shared";
import { UserRole } from "@constants";

const PLATFORM_ROLES: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
  UserRole.MULTI_TENANT_ADMIN,
];

/** "platform" for Ally-internal super tiers, "tenant" for everyone scoped to one org. */
export const resolveTenantTier = (role?: string | null): "platform" | "tenant" =>
  role && PLATFORM_ROLES.includes(role) ? "platform" : "tenant";

/** Replace numeric / uuid path segments so the route is a pattern, never an id. */
export const toRoutePattern = (pathname: string): string =>
  pathname
    .split("/")
    .map(seg => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) ? ":id" : seg))
    .join("/") || "/";

/**
 * Fires `admin_page_viewed` once per route change. Call it once from the authenticated shell
 * (e.g. the layout that renders <Outlet/>) with `useLocation().pathname`.
 */
export const useAdminPageView = (pathname: string) => {
  const { track } = useAnalytics();
  const role = useSelector((s: any) => s.user?.user?.role as string | undefined);
  useEffect(() => {
    track(ANALYTICS_EVENTS.ADMIN_PAGE_VIEWED, {
      [ANALYTICS_PROPS.ROUTE]: toRoutePattern(pathname),
      [ANALYTICS_PROPS.TENANT_TIER]: resolveTenantTier(role),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
};

/** Helpers for per-screen usage events. */
export const useAdminActionTracking = () => {
  const { track } = useAnalytics();
  const trackAdminAction = useCallback(
    (screen: string, action: string) =>
      track(ANALYTICS_EVENTS.ADMIN_ACTION, {
        [ANALYTICS_PROPS.HELPLINE_SCREEN]: screen,
        [ANALYTICS_PROPS.ACTION]: action,
      }),
    [track],
  );
  const trackAdminSearch = useCallback(
    (screen: string, query: string) =>
      track(ANALYTICS_EVENTS.ADMIN_SEARCH_USED, {
        [ANALYTICS_PROPS.HELPLINE_SCREEN]: screen,
        [ANALYTICS_PROPS.QUERY_LENGTH]: query.length,
      }),
    [track],
  );
  return { trackAdminAction, trackAdminSearch };
};
