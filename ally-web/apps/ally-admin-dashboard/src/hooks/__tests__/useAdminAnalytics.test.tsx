import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("@ally-ui-mono/ui-shared", () => ({
  useAnalytics: () => ({ track }),
  ANALYTICS_EVENTS: {
    ADMIN_PAGE_VIEWED: "admin_page_viewed",
    ADMIN_ACTION: "admin_action",
    ADMIN_SEARCH_USED: "admin_search_used",
  },
  ANALYTICS_PROPS: {
    ROUTE: "route",
    TENANT_TIER: "tenant_tier",
    HELPLINE_SCREEN: "screen",
    ACTION: "action",
    QUERY_LENGTH: "query_length",
  },
}));
vi.mock("react-redux", () => ({
  useSelector: (fn: any) => fn({ user: { user: { role: "SUPER_ADMIN" } } }),
}));

// eslint-disable-next-line import/first
import {
  resolveTenantTier,
  toRoutePattern,
  useAdminActionTracking,
  useAdminPageView,
} from "../useAdminAnalytics";

describe("useAdminAnalytics", () => {
  it("strips ids from routes", () => {
    expect(toRoutePattern("/users/123/logs/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "/users/:id/logs/:id",
    );
  });
  it("maps roles to tier", () => {
    expect(resolveTenantTier("SUPER_ADMIN")).toBe("platform");
    expect(resolveTenantTier("ADMIN")).toBe("tenant");
    expect(resolveTenantTier(undefined)).toBe("tenant");
  });
  it("tracks page views with route + tier", () => {
    renderHook(() => useAdminPageView("/users/5"));
    expect(track).toHaveBeenCalledWith("admin_page_viewed", {
      route: "/users/:id",
      tenant_tier: "platform",
    });
  });
  it("tracks actions and searches without query text", () => {
    const { result } = renderHook(() => useAdminActionTracking());
    result.current.trackAdminAction("users", "bulk_add");
    result.current.trackAdminSearch("users", "alice");
    expect(track).toHaveBeenCalledWith("admin_action", { screen: "users", action: "bulk_add" });
    expect(track).toHaveBeenCalledWith("admin_search_used", { screen: "users", query_length: 5 });
  });
});
