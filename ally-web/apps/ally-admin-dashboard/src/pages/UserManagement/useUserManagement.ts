import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  useAddUserMutation,
  useBulkAddUsersMutation,
  useDeleteUserMutation,
  useGetTenantsQuery,
  useGetUsersQuery,
  useEditUserMutation,
  useUpdateUserStatusMutation,
  useChangeRoleMutation,
  useGetRoleQuery,
  useAddSimulationCreditLimitMutation,
  useGetUserImpersonatedTokenMutation,
} from "@api";
import { FilterValues } from "@components/types";
import {
  SORT_BY,
  SORT_ORDER,
  en,
  fieldId,
  fieldType,
  FilterDropdownOptions,
  userStatus,
  UserRole,
  PLATFORM_MANAGED_ROLES,
} from "@constants";
import {
  AddUserFormData,
  BulkAddUserFormData,
  FieldProps,
  Tenant,
  UserListUser,
  UserRoles,
} from "@types";
import { getChipValue, getErrorMessage, parseEmailList, validateEmail } from "@utils";

import { MIN_LEARNER_CREDITS, resolveLearnerCreditLimit } from "./learnerCredits";

export const USERS_PAGE_SIZE = 20;
const IMPERSONATION_APP_URL = import.meta.env.VITE_IMPERSONATION_APP_URL;

/**
 * @param canListPlatformAdmins whether the viewer may list accounts holding a
 * platform role. When they may, those accounts are simply part of the list —
 * there is no opt-in to make. Gates the query param, so nobody else can trip
 * the backend's 403.
 */
/**
 * `canListUsers` is the admin's Users toggle. Off, the page shows only the
 * Ally admins sub-tab, and ally-be refuses the users list — so the query is
 * skipped rather than left to 403 on mount.
 */
/** One request that holds every organisation (the Organisations tab pages 100 at a time). */
const ALL_TENANTS_LIMIT = 1000;

export function useUserManagement(
  pagedTenants: Tenant[],
  canListPlatformAdmins = false,
  canListUsers = true,
) {
  // The org filter and the "Add user" organisation picker need EVERY organisation, not just the
  // 100 the Organisations tab has paged in so far; otherwise an org past the first page cannot be
  // chosen. Falls back to the paged list until the full one arrives.
  const { data: allTenantsPage } = useGetTenantsQuery(
    { limit: ALL_TENANTS_LIMIT, sortBy: SORT_BY.CREATED_AT, sortOrder: SORT_ORDER.DESC },
    { skip: !canListUsers },
  );
  const tenants: Tenant[] = allTenantsPage?.data?.length ? allTenantsPage.data : pagedTenants;
  // Search and filters live in the URL (?q, ?org, ?role, ?status) so a refresh, the back button or
  // a link to a colleague lands on the same list. replace: typing must not fill the history.
  const [urlParams, setUrlParams] = useSearchParams();
  const search = urlParams.get("q") ?? "";
  const setSearch = useCallback(
    (value: string) =>
      setUrlParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value) next.set("q", value);
          else next.delete("q");
          return next;
        },
        { replace: true },
      ),
    [setUrlParams],
  );
  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);
  const [addUsermodalOpen, setAddUserModalOpen] = useState<boolean>(false);
  const [bulkAddModalOpen, setBulkAddModalOpen] = useState<boolean>(false);

  const orgParam = urlParams.getAll("org");
  const roleParam = urlParams.getAll("role");
  const statusParam = urlParams.getAll("status");
  const filters = useMemo<FilterValues>(
    () => ({ organizations: orgParam, roles: roleParam, statuses: statusParam }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgParam.join("\u0001"), roleParam.join("\u0001"), statusParam.join("\u0001")],
  );
  const setFilters = useCallback(
    (update: FilterValues | ((prev: FilterValues) => FilterValues)) =>
      setUrlParams(
        prev => {
          const current: FilterValues = {
            organizations: prev.getAll("org"),
            roles: prev.getAll("role"),
            statuses: prev.getAll("status"),
          };
          const value = typeof update === "function" ? update(current) : update;
          const next = new URLSearchParams(prev);
          next.delete("org");
          next.delete("role");
          next.delete("status");
          value.organizations.forEach(v => next.append("org", v));
          value.roles.forEach(v => next.append("role", v));
          value.statuses.forEach(v => next.append("status", v));
          return next;
        },
        { replace: true },
      ),
    [setUrlParams],
  );

  const [users, setUsers] = useState<UserListUser[]>([]);
  const [usersCount, setUsersCount] = useState<number>(0);
  const [usersOffset, setUsersOffset] = useState<number>(0);

  const [selectedUser, setSelectedUser] = useState<UserListUser | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [roles, setRoles] = useState<UserRoles[]>([]);

  // Form default values
  const defaultUserValues = {
    name: "",
    email: "",
    externalId: "",
    tenantId: "",
    roles: [],
    simulationCreditLimit: 0,
    description: "",
  };

  // Form methods
  const userMethods = useForm({
    defaultValues: defaultUserValues,
    mode: "onChange",
  });

  // Bulk-add uses its own form (emails textarea + shared common settings).
  const defaultBulkValues = {
    emails: "",
    tenantId: "",
    roles: [],
    simulationCreditLimit: 0,
  };
  const bulkUserMethods = useForm({
    defaultValues: defaultBulkValues,
    mode: "onChange",
  });

  // Users are subscribed so invalidation triggers refetch automatically
  const [addUserdata] = useAddUserMutation();
  const [bulkAddUsers] = useBulkAddUsersMutation();
  const [deleteUser] = useDeleteUserMutation();
  const [editUser] = useEditUserMutation();
  const [updateUserStatus] = useUpdateUserStatusMutation();
  const [changeRole] = useChangeRoleMutation();
  const [addSimulationCreditLimit] = useAddSimulationCreditLimitMutation();
  const [impersonateUser] = useGetUserImpersonatedTokenMutation();
  const { data: userRoles } = useGetRoleQuery();

  const addFilterBtnRef = useRef<HTMLButtonElement>(null);
  // No opt-in: a viewer who is allowed to see platform accounts sees them in
  // the list like any other account.
  const includePlatformAdmins = canListPlatformAdmins;
  // Filter by id. Two organisations can share a name, so every match counts.
  const tenantIdFilters = useMemo(
    () =>
      filters.organizations.flatMap(name =>
        tenants.filter(tenant => tenant.name === name).map(tenant => tenant.id),
      ),
    [filters.organizations, tenants],
  );
  const userParams = {
    limit: USERS_PAGE_SIZE,
    offset: usersOffset,
    sortBy: SORT_BY.CREATED_AT,
    sortOrder: SORT_ORDER.DESC,
    tenantIds: tenantIdFilters.length ? tenantIdFilters : undefined,
    roles: filters.roles.length ? filters.roles : undefined,
    statuses: filters.statuses.length ? filters.statuses : undefined,
    search: search || undefined,
    // Omitted rather than sent as false, so the request URL (and cache key) is
    // unchanged for every viewer who never touches the filter.
    includePlatformAdmins: includePlatformAdmins || undefined,
  };

  const { data: usersResponse, isFetching: isUsersFetching } = useGetUsersQuery(userParams, {
    skip: !canListUsers,
  });

  useEffect(() => {
    setUsersOffset(0);
  }, [search, filters]);

  useEffect(() => {
    if (!usersResponse) return;
    const nextData = usersResponse.data ?? [];
    if (usersOffset === 0) {
      setUsers(nextData);
    } else {
      setUsers(prev => {
        // Prevent duplicates by checking if items already exist
        const existingIds = new Set(prev.map(user => user.id));
        const newItems = nextData.filter(user => !existingIds.has(user.id));
        return [...prev, ...newItems];
      });
    }
    setUsersCount(usersResponse.count || 0);
  }, [usersResponse, usersOffset]);

  useEffect(() => {
    if (!userRoles) return;

    // CLIENT is an anonymous-chat identity, never granted by hand.
    //
    // The platform tiers are filtered for a second reason: PLATFORM_ADMIN is
    // owned by the Ally admins tab, which grants it alongside the per-user
    // feature toggles that decide what an admin can actually reach — granting
    // it here would produce an admin with no toggles at all. The three retired
    // tiers still sit in `groups` for rollback safety and still carry live
    // permissions, so they must not be offered either. `/v1/authorization/roles`
    // now filters all four server-side; this keeps the picker right against a
    // backend that hasn't shipped that yet.
    const filteredRoles = userRoles.filter(
      role =>
        role.name !== UserRole.CLIENT && !(PLATFORM_MANAGED_ROLES as string[]).includes(role.name),
    );
    setRoles(filteredRoles);
  }, [userRoles]);

  const loadUsers = async (append = false) => {
    // Advance/reset offset to drive the subscribed query
    setUsersOffset(prev => (append ? prev + USERS_PAGE_SIZE : 0));
  };

  // Filter chips are used to display the filter chips in the list toolbar
  const filterChips = useMemo(() => {
    const chips: Array<{ label: string; value: string; allValue: string[]; onClear: () => void }> =
      [];
    if (filters.organizations.length) {
      chips.push({
        label: FilterDropdownOptions.ORGANIZATION,
        value: getChipValue(filters.organizations),
        allValue: filters.organizations,
        onClear: () => {
          setFilters(previousFilters => ({ ...previousFilters, organizations: [] }));
        },
      });
    }
    if (filters.roles.length) {
      chips.push({
        label: FilterDropdownOptions.ROLE,
        value: getChipValue(filters.roles),
        allValue: filters.roles,
        onClear: () => setFilters(previousFilters => ({ ...previousFilters, roles: [] })),
      });
    }
    if (filters.statuses.length) {
      chips.push({
        label: FilterDropdownOptions.STATUS,
        value: getChipValue(filters.statuses),
        allValue: filters.statuses,
        onClear: () => setFilters(previousFilters => ({ ...previousFilters, statuses: [] })),
      });
    }
    return chips;
  }, [filters]);

  const handleApplyFilters = (newFilters: FilterValues) => {
    setFilters(newFilters);
  };

  const getField = (userData: FieldProps[]) => {
    return userData.map(field => {
      const updatedField = { ...field };

      if (field.id === fieldId.TENANTID && field.fieldType === fieldType.DROPDOWN) {
        updatedField.options =
          tenants?.map(tenant => ({
            id: tenant.id,
            value: tenant.name,
          })) ?? [];
      }

      if (field.id === fieldId.ROLES && field.fieldType === fieldType.DROPDOWN_WITH_TAG) {
        updatedField.options =
          roles?.map(role => ({
            id: role.id,
            value: role.name,
          })) ?? [];
      }

      return updatedField;
    });
  };

  const addFilterCtaMemo = useMemo(
    () => ({
      label: en.userManagement.addFilter,
      onClick: () => setIsFilterOpen(true),
    }),
    [],
  );

  const handleOptionSelect = (option: string, user: UserListUser) => {
    setSelectedUser(user);
    setSelectedOption(option);
    const heldRoles = user.roles?.length ? user.roles : user.role ? [user.role] : [];
    userMethods.reset({
      name: user.name,
      email: user.email,
      externalId: user.externalId,
      tenantId: user.tenantId,
      roles: heldRoles,
    });
  };

  const handleDropdownClose = () => {
    setSelectedOption(null);
    setSelectedUser(null);
    userMethods.reset(defaultUserValues);
  };

  const handleAddUser = async (data: AddUserFormData) => {
    try {
      const payload: AddUserFormData = {
        name: data?.name,
        email: data?.email,
        roles: data?.roles,
        externalId: data?.externalId,
        tenantId: data?.tenantId,
      };
      if (data?.roles?.includes(UserRole.LEARNER)) {
        const { limit, raised } = resolveLearnerCreditLimit(data?.simulationCreditLimit);
        payload.simulationCreditLimit = limit;
        if (raised) toast.info(en.userManagement.creditFloorRaised(MIN_LEARNER_CREDITS));
      }
      await addUserdata(payload).unwrap();
      setAddUserModalOpen(false);
      userMethods.reset(defaultUserValues);
      handleAddUserClose();
      toast.success("User added successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to add user"));
    }
  };

  const handleUserAddClick = () => {
    userMethods.reset(defaultUserValues);
    setAddUserModalOpen(true);
  };

  const handleBulkAddClick = () => {
    bulkUserMethods.reset(defaultBulkValues);
    setBulkAddModalOpen(true);
  };

  const handleBulkAddClose = () => {
    setBulkAddModalOpen(false);
    bulkUserMethods.reset(defaultBulkValues);
  };

  const handleBulkAddUser = async (data: BulkAddUserFormData) => {
    try {
      // parseEmailList splits the textarea on newlines/commas/semicolons and
      // de-dupes. Backend still validates format + existing accounts and
      // rejects the whole batch all-or-nothing.
      const emails = parseEmailList(data?.emails);
      if (emails.length === 0) {
        toast.error(en.userManagement.bulkAddUsersEmptyError);
        return;
      }
      // The server accepts or rejects the whole batch, so catch malformed rows here and name
      // them, instead of one generic failure for a list of fifty.
      const badRows = emails.filter(email => !validateEmail(email));
      if (badRows.length > 0) {
        toast.error(en.userManagement.bulkAddUsersInvalidRows(badRows));
        return;
      }
      const credit = data?.roles?.includes(UserRole.LEARNER)
        ? resolveLearnerCreditLimit(data?.simulationCreditLimit)
        : null;
      if (credit?.raised) toast.info(en.userManagement.creditFloorRaised(MIN_LEARNER_CREDITS));
      const payload = {
        emails,
        roles: data?.roles,
        tenantId: data?.tenantId,
        ...(credit ? { simulationCreditLimit: credit.limit } : {}),
      };
      const response = await bulkAddUsers(payload).unwrap();
      handleBulkAddClose();
      toast.success(en.userManagement.bulkAddUsersSuccess(response?.created ?? emails.length));
    } catch (error: any) {
      toast.error(getErrorMessage(error, en.userManagement.bulkAddUsersFailed));
    }
  };

  const handleRemoveUser = async (userId: number) => {
    try {
      if (userId) {
        await deleteUser({ userId }).unwrap();
        handleDropdownClose();
        toast.success(en.userManagement.userRemoved);
      } else {
        toast.error(en.errors.userIdNotFound);
      }
    } catch (error: any) {
      toast.error(getErrorMessage(error, en.errors.failedToRemoveUser));
    }
  };

  const handleEditUser = async (data: {
    id: number;
    email: string;
    name: string;
    externalId: string;
  }) => {
    try {
      const payload = {
        id: Number(data?.id),
        data: {
          email: data?.email,
          name: data?.name,
          externalId: data?.externalId,
        },
      };

      await editUser(payload).unwrap();
      handleDropdownClose();
      toast.success("User updated successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to update user"));
    }
  };

  const handleSuspendUser = async () => {
    if (!selectedUser) return;

    try {
      const payload = {
        userId: selectedUser.id,
        status: userStatus.SUSPENDED,
      };

      await updateUserStatus(payload).unwrap();
      handleDropdownClose();
      toast.success("User suspended successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to suspend user"));
    }
  };

  const handleActivateUser = async () => {
    if (!selectedUser) return;
    try {
      const payload = {
        userId: selectedUser.id,
        status: userStatus.ACTIVE,
      };
      await updateUserStatus(payload).unwrap();
      handleDropdownClose();
      toast.success("User activated successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to activate user"));
    }
  };

  const handleChangeRole = async (data: any) => {
    try {
      const selectedRoleNames: string[] = data.roles || [];
      const groupIds = selectedRoleNames
        .map(name => (userRoles ?? []).find(role => role.name === name)?.id)
        .filter((id): id is number => id != null);

      if (groupIds.length !== selectedRoleNames.length) {
        toast.error(en.userManagement.changeRoleUnknownRole);
        return;
      }

      const payload = {
        userId: data.id,
        groupIds,
      };
      await changeRole(payload).unwrap();
      handleDropdownClose();
      toast.success("User role changed successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to change user role"));
    }
  };

  const handleImpersonateUser = async (userData: any) => {
    try {
      const payload = {
        email: userData.email,
      };
      const response: any = await impersonateUser(payload).unwrap();
      const params = new URLSearchParams({
        accessToken: response?.data.accessToken,
        refreshToken: response?.data.refreshToken,
        impersonatedByAccessToken: localStorage.getItem("adminAccessToken"),
      });

      window.open(`${IMPERSONATION_APP_URL}/impersonate?${params.toString()}`, "_blank");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to impersonate user"));
    }
  };

  const handleAddCredit = async (data: any) => {
    if (!selectedUser) return;
    try {
      const payload = {
        userId: selectedUser.id,
        creditLimit: Number(data.simulationCreditLimit),
      };
      await addSimulationCreditLimit(payload).unwrap();
      handleDropdownClose();
      toast.success("Credit added successfully");
    } catch (error: any) {
      toast.error(getErrorMessage(error, "Failed to add credit"));
    }
  };

  const handleAddUserClose = () => {
    setAddUserModalOpen(false);
    userMethods.reset();
  };

  return {
    // state
    allTenants: tenants,
    search,
    setSearch,
    isFilterOpen,
    setIsFilterOpen,
    addFilterBtnRef,
    selectedUser,
    setSelectedUser,
    selectedOption,
    setSelectedOption,
    roles,
    setRoles,

    // filters
    filters,
    handleApplyFilters,
    addFilterCtaMemo,
    includePlatformAdmins,

    // data
    users,
    usersCount,
    usersOffset,
    loadUsers,
    isUsersFetching,

    // chips
    filterChips,

    // form methods
    userMethods,
    bulkUserMethods,

    // handlers
    handleOptionSelect,
    handleDropdownClose,
    handleAddUser,
    handleBulkAddUser,
    handleBulkAddClick,
    handleBulkAddClose,
    handleRemoveUser,
    handleEditUser,
    handleSuspendUser,
    handleChangeRole,
    handleImpersonateUser,
    handleActivateUser,
    handleAddUserClose,
    handleUserAddClick,
    handleAddCredit,

    // user operations
    getField,
    addUserdata,
    addUsermodalOpen,
    setAddUserModalOpen,
    bulkAddModalOpen,
    setBulkAddModalOpen,
    deleteUser,
    editUser,
    changeRole,
  };
}
