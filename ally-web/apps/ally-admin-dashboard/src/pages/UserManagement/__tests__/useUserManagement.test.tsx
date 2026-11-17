import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";

import { UserRole } from "@constants";

import { useUserManagement } from "../useUserManagement";

// Search/filters are URL-backed; a plain stateful stand-in keeps these hook tests router-free.
vi.mock("react-router-dom", async importOriginal => {
  const React = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useSearchParams: () => {
      const [params, setParams] = React.useState(new URLSearchParams());
      const set = (next: any) =>
        setParams(prev => (typeof next === "function" ? next(prev) : new URLSearchParams(next)));
      return [params, set];
    },
  };
});

const changeRole = vi.fn();
const updateStatus = vi.fn();
const getUsersQuery = vi.fn();
const usersResultRef = { current: undefined as unknown };
const USERS_RESULT = { data: { data: [], count: 0 }, isFetching: false };
usersResultRef.current = USERS_RESULT;

// Every role the backend knows about, in the shape GET /authorization/roles
// returns. The endpoint now filters the platform tiers itself, but they are
// kept here on purpose: the picker has to stay right against a backend that
// hasn't shipped that filter yet.
const allRoles = [
  { id: 1, name: UserRole.COUNSELLOR },
  { id: 2, name: UserRole.ADMIN },
  { id: 3, name: UserRole.LEARNER },
  { id: 4, name: UserRole.CLIENT },
  { id: 5, name: UserRole.MULTI_TENANT_ADMIN },
  { id: 6, name: UserRole.SUPER_ADMIN },
  { id: 7, name: UserRole.SUPER_DUPER_ADMIN },
  { id: 8, name: UserRole.PLATFORM_ADMIN },
];

// Keep the rest of @api real: @store (pulled in transitively) needs baseAPI.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAddUserMutation: () => [vi.fn()],
  useBulkAddUsersMutation: () => [vi.fn()],
  useDeleteUserMutation: () => [vi.fn()],
  useEditUserMutation: () => [vi.fn()],
  useUpdateUserStatusMutation: () => [updateStatus],
  useChangeRoleMutation: () => [changeRole],
  useAddSimulationCreditLimitMutation: () => [vi.fn()],
  useGetUserImpersonatedTokenMutation: () => [vi.fn()],
  useGetRoleQuery: () => ({ data: allRoles }),
  // Stable references, like RTK Query's own cache entries: a fresh object per
  // render would retrigger the hook's sync effect forever.
  useGetTenantsQuery: () => ({ data: undefined }),
  useGetUsersQuery: (params: unknown) => {
    getUsersQuery(params);
    return usersResultRef.current;
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const staffAccount = {
  id: 42,
  name: "Ally Staffer",
  email: "staff@helloally.ai",
  role: UserRole.SUPER_DUPER_ADMIN,
  roles: [UserRole.SUPER_DUPER_ADMIN],
  tenantId: "tenant-1",
} as any;

describe("useUserManagement", () => {
  it("bulk status change updates each selected user and names the ones that fail", async () => {
    usersResultRef.current = {
      data: {
        data: [
          { id: 1, name: "Asha", email: "a@x.com" },
          { id: 2, name: "Ben", email: "b@x.com" },
        ],
        count: 2,
      },
      isFetching: false,
    };
    updateStatus.mockImplementation(({ userId }: { userId: number }) => ({
      unwrap: () => (userId === 2 ? Promise.reject(new Error("no")) : Promise.resolve({})),
    }));
    const { result } = renderHook(() => useUserManagement([]));
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    act(() => result.current.rowSelection.toggleAll());
    await act(async () => {
      await result.current.handleBulkStatus("SUSPENDED");
    });
    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Ben"));
    expect(result.current.rowSelection.count).toBe(0);
    usersResultRef.current = USERS_RESULT;
  });

  it("keeps search and filters in the URL state and filters by organisation id", () => {
    const tenants = [
      { id: "t1", name: "Acme" },
      { id: "t2", name: "Acme" },
      { id: "t3", name: "Zed" },
    ] as any;
    const { result } = renderHook(() => useUserManagement(tenants));
    act(() => result.current.setSearch("asha"));
    expect(result.current.search).toBe("asha");
    act(() =>
      result.current.handleApplyFilters({ organizations: ["Acme"], roles: [], statuses: [] }),
    );
    expect(result.current.filters.organizations).toEqual(["Acme"]);
    expect(getUsersQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "asha", tenantIds: ["t1", "t2"] }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    changeRole.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
  });

  describe("role picker", () => {
    it("offers the assignable app roles but not CLIENT", async () => {
      const { result } = renderHook(() => useUserManagement([]));

      await waitFor(() => expect(result.current.roles.length).toBeGreaterThan(0));

      const offered = result.current.roles.map(role => role.name);
      expect(offered).toContain(UserRole.LEARNER);
      expect(offered).toContain(UserRole.COUNSELLOR);
      expect(offered).not.toContain(UserRole.CLIENT);
    });

    // PLATFORM_ADMIN is granted on the Ally admins tab alongside the feature
    // toggles that decide what the admin can reach; granting it here would
    // leave those unset. The three retired tiers still carry live permissions,
    // so offering one would mint an admin that tab cannot see.
    it("never offers a platform tier", async () => {
      const { result } = renderHook(() => useUserManagement([]));

      await waitFor(() => expect(result.current.roles.length).toBeGreaterThan(0));

      const offered = result.current.roles.map(role => role.name);
      expect(offered).not.toContain(UserRole.PLATFORM_ADMIN);
      expect(offered).not.toContain(UserRole.SUPER_ADMIN);
      expect(offered).not.toContain(UserRole.SUPER_DUPER_ADMIN);
      expect(offered).not.toContain(UserRole.MULTI_TENANT_ADMIN);
    });
  });

  describe("handleChangeRole", () => {
    it("resolves the picked roles to group ids and sends only those", async () => {
      const { result } = renderHook(() => useUserManagement([]));
      await waitFor(() => expect(result.current.roles.length).toBeGreaterThan(0));

      act(() =>
        result.current.handleOptionSelect("Change role", {
          ...staffAccount,
          role: UserRole.LEARNER,
          roles: [UserRole.LEARNER],
        }),
      );
      await act(async () => {
        await result.current.handleChangeRole({
          id: 42,
          roles: [UserRole.LEARNER, UserRole.COUNSELLOR],
        });
      });

      expect(changeRole).toHaveBeenCalledWith({ userId: 42, groupIds: [3, 1] });
    });

    it("rejects the save when a picked role name doesn't resolve to a known group", async () => {
      const { result } = renderHook(() => useUserManagement([]));
      await waitFor(() => expect(result.current.roles.length).toBeGreaterThan(0));

      act(() => result.current.handleOptionSelect("Change role", staffAccount));
      await act(async () => {
        await result.current.handleChangeRole({ id: 42, roles: ["NOT_A_REAL_ROLE"] });
      });

      expect(changeRole).not.toHaveBeenCalled();
    });

    it("prefills the picker with every role the account holds", async () => {
      const { result } = renderHook(() => useUserManagement([]));

      act(() =>
        result.current.handleOptionSelect("Change role", {
          ...staffAccount,
          roles: [UserRole.SUPER_DUPER_ADMIN, UserRole.LEARNER],
        }),
      );

      expect(result.current.userMethods.getValues().roles).toEqual([
        UserRole.SUPER_DUPER_ADMIN,
        UserRole.LEARNER,
      ]);
    });
  });

  describe("platform accounts in the list", () => {
    // No opt-in any more: the list a permitted viewer gets is the whole list.
    it("asks for platform admins straight away for a viewer who may see them", () => {
      const { result } = renderHook(() => useUserManagement([], true));

      expect(getUsersQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ includePlatformAdmins: true }),
      );
      expect(result.current.includePlatformAdmins).toBe(true);
    });

    // Anyone else would get a 403, so the param must never leave the client.
    it("never sends it for a viewer who cannot list them", () => {
      const { result } = renderHook(() => useUserManagement([], false));

      expect(getUsersQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ includePlatformAdmins: undefined }),
      );
      expect(result.current.includePlatformAdmins).toBe(false);
    });

    // The role filter is the only platform-account control left, so a selected
    // platform role has to survive an apply untouched.
    it("keeps a selected platform role filter", async () => {
      const { result } = renderHook(() => useUserManagement([], true));

      act(() =>
        result.current.handleApplyFilters({
          organizations: [],
          roles: [UserRole.SUPER_ADMIN, UserRole.LEARNER],
          statuses: [],
        }),
      );

      await waitFor(() =>
        expect(result.current.filters.roles).toEqual([UserRole.SUPER_ADMIN, UserRole.LEARNER]),
      );
      expect(result.current.includePlatformAdmins).toBe(true);
    });
  });
});
