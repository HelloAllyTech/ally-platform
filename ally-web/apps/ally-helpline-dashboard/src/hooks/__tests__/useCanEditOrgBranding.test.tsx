import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTenantQuery = vi.fn();
let mockPermissions: string[] = [];

vi.mock("@api", () => ({
  useGetLogoUrlQuery: (arg: unknown, opts: unknown) => mockTenantQuery(arg, opts),
}));

vi.mock("@constants", () => ({
  Permissions: { EDIT_TENANT_BRANDING: "edit:tenant-branding" },
}));

vi.mock("@hooks", () => ({
  useUser: () => ({ permissions: mockPermissions }),
}));

vi.mock("@utils", () => ({
  hasPermissions: (permissions: string[] | null | undefined, required: string) =>
    Array.isArray(permissions) && permissions.includes(required),
}));

import { useCanEditOrgBranding } from "../useCanEditOrgBranding";

const branded = { id: "t1", name: "Acme", logoUrl: "", branding: { enabled: true } };

describe("useCanEditOrgBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions = [];
    mockTenantQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("hides the tab, and never asks for the tenant, without the permission", () => {
    mockTenantQuery.mockReturnValue({ data: branded, isLoading: false });
    const { result } = renderHook(() => useCanEditOrgBranding());

    expect(result.current.canEdit).toBe(false);
    expect(mockTenantQuery).toHaveBeenCalledWith(undefined, { skip: true });
  });

  it("hides the tab while the org's branding switch is off", () => {
    mockPermissions = ["edit:tenant-branding"];
    mockTenantQuery.mockReturnValue({
      data: { ...branded, branding: { enabled: false } },
      isLoading: false,
    });
    const { result } = renderHook(() => useCanEditOrgBranding());

    expect(result.current.canEdit).toBe(false);
  });

  it("shows the tab with the permission and the switch on", () => {
    mockPermissions = ["edit:tenant-branding"];
    mockTenantQuery.mockReturnValue({ data: branded, isLoading: false });
    const { result } = renderHook(() => useCanEditOrgBranding());

    expect(result.current.canEdit).toBe(true);
    expect(mockTenantQuery).toHaveBeenCalledWith(undefined, { skip: false });
  });

  it("reports loading only while the permission holder's tenant is in flight", () => {
    mockPermissions = ["edit:tenant-branding"];
    mockTenantQuery.mockReturnValue({ data: undefined, isLoading: true });
    expect(renderHook(() => useCanEditOrgBranding()).result.current.isLoading).toBe(true);

    mockPermissions = [];
    expect(renderHook(() => useCanEditOrgBranding()).result.current.isLoading).toBe(false);
  });
});
