import { useEffect, useState } from "react";

import { Trash } from "@icons";
import { toast } from "sonner";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import {
  useGetAdminTenantsQuery,
  useGetTenantsQuery,
  useAssignAdminTenantsMutation,
  useRemoveAdminTenantsMutation,
} from "@api";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en, SORT_ORDER } from "@constants";
import { AdminTenant } from "@types";

interface AssignedOrganizationsProps {
  userId: number;
  canEdit: boolean;
}

/**
 * Organizations listed in the add modal per request. The modal searches the
 * server (name or code) rather than filtering a page the caller loaded: that
 * page used to stop at 100, so any org past it could not be assigned at all.
 */
const PICKER_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export const AssignedOrganizations: React.FC<AssignedOrganizationsProps> = ({
  userId,
  canEdit,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: tenantPage, isFetching: isSearching } = useGetTenantsQuery(
    {
      limit: PICKER_PAGE_SIZE,
      offset: 0,
      sortBy: "name",
      sortOrder: SORT_ORDER.ASC,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    { skip: !showAddModal },
  );
  // The org whose removal would leave the allowlist empty. An empty allowlist
  // means unrestricted, so that removal widens the admin to every
  // organization; the backend refuses it unless asked to lift the restriction,
  // and this asks the person first.
  const [pendingLift, setPendingLift] = useState<AdminTenant | null>(null);

  const { data: adminTenantsData, isFetching } = useGetAdminTenantsQuery(userId, {
    skip: !userId,
  });

  const [assignAdminTenants, { isLoading: isAssigning }] = useAssignAdminTenantsMutation();
  const [removeAdminTenants, { isLoading: isRemoving }] = useRemoveAdminTenantsMutation();

  const assignedTenants: AdminTenant[] = adminTenantsData?.data ?? [];

  // Matching tenants that are NOT yet assigned. `count` is every match on the
  // server, so the modal can say when a search would find more than it lists.
  const assignedIds = new Set(assignedTenants.map(t => t.id));
  const matches = tenantPage?.data ?? [];
  const availableTenants = matches.filter(t => !assignedIds.has(t.id));
  const matchCount = tenantPage?.count ?? matches.length;

  const closeAddModal = () => {
    setShowAddModal(false);
    setSelectedIds([]);
    setSearch("");
    setDebouncedSearch("");
  };

  const removeTenant = async (tenantId: string, liftRestriction = false) => {
    try {
      await removeAdminTenants({
        userId,
        tenantIds: [tenantId],
        ...(liftRestriction ? { liftRestriction: true } : {}),
      }).unwrap();
      toast.success(en.userManagement.removeOrganizationSuccess);
    } catch (err: any) {
      toast.error(err?.data?.message || en.userManagement.removeOrganizationError);
    }
  };

  const handleRemove = (tenant: AdminTenant) => {
    if (assignedTenants.length === 1) {
      setPendingLift(tenant);
      return;
    }
    removeTenant(tenant.id);
  };

  const confirmLift = async () => {
    if (!pendingLift) return;
    const tenantId = pendingLift.id;
    setPendingLift(null);
    await removeTenant(tenantId, true);
  };

  const handleAssign = async () => {
    if (!selectedIds.length) return;
    try {
      await assignAdminTenants({ userId, tenantIds: selectedIds }).unwrap();
      toast.success(en.userManagement.assignOrganizationSuccess);
      closeAddModal();
    } catch (err: any) {
      toast.error(err?.data?.message || en.userManagement.assignOrganizationError);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <label className="text-sm text-typography-900 cursor-pointer font-primary">
          {en.userManagement.adminFor}
          {adminTenantsData?.count !== undefined && (
            <span className="ml-2 text-xs font-normal text-typography-600 bg-background-secondary rounded-full px-2 py-0.5">
              {adminTenantsData.count}
            </span>
          )}
        </label>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="min-h-[40px] md:min-h-0 text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
          >
            {en.userManagement.addOrganizationLabel}
          </button>
        )}
      </div>

      {/* Current assigned tenants */}
      <div className="flex flex-col gap-2">
        {isFetching ? (
          <div className="text-xs text-typography-600 animate-pulse py-2">{en.common.loading}</div>
        ) : assignedTenants.length === 0 ? (
          <p className="text-xs text-typography-600 py-2 italic">
            {en.userManagement.noAssignedOrganizations}
          </p>
        ) : (
          assignedTenants.map(tenant => (
            <div
              key={tenant.id}
              className="flex items-center justify-between rounded-lg border border-border-light bg-background-secondary px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden">
                  <CustomImage
                    src={tenant.logoUrl}
                    alt={tenant.name}
                    className="rounded-full object-cover w-7 h-7"
                    fallbackClassName="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-typography-600 text-xs"
                    fallbackText={tenant.name?.slice(0, 1)?.toUpperCase() ?? "O"}
                  />
                </div>
                <span className="text-sm text-typography-900 truncate">{tenant.name}</span>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleRemove(tenant)}
                  disabled={isRemoving}
                  title={en.userManagement.remove}
                  aria-label={en.userManagement.remove}
                  className="ml-3 inline-flex h-10 w-10 -my-2 -mr-2 items-center justify-center md:h-auto md:w-auto md:my-0 md:mr-0 flex-shrink-0 text-destructive-400 hover:text-destructive-600 disabled:opacity-40 transition-colors"
                >
                  <Trash width={15} height={15} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {pendingLift && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setPendingLift(null)}
          title={en.userManagement.liftRestrictionTitle}
          description={en.userManagement.liftRestrictionDescription(pendingLift.name)}
          primaryButton={{
            label: en.userManagement.liftRestrictionConfirm,
            onClick: confirmLift,
            variant: ButtonVariant.DESTRUCTIVE,
          }}
          secondaryButton={{
            label: en.userManagement.cancel,
            onClick: () => setPendingLift(null),
          }}
        />
      )}

      {/* Add Organization Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-[1px]"
          onClick={e => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
        >
          <div className="bg-white rounded-[10px] shadow-2xl w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[360px] max-w-[90vw] max-h-[80dvh] flex flex-col p-4 sm:p-5 gap-4 font-primary animate-fadeIn">
            {/* Modal header */}
            <h3 className="text-lg font-semibold text-typography-900">
              {en.userManagement.selectOrganizations}
            </h3>

            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={en.userManagement.searchOrganizationsPlaceholder}
              aria-label={en.userManagement.searchOrganizationsPlaceholder}
              className="w-full rounded-lg border border-border-light px-3 py-2 text-sm text-typography-900 placeholder:text-typography-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />

            {/* Tenant list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 max-h-60 flex flex-col gap-1">
              {isSearching && matches.length === 0 ? (
                <p className="text-sm text-typography-600 py-4 text-center animate-pulse">
                  {en.common.loading}
                </p>
              ) : availableTenants.length === 0 ? (
                <p className="text-sm text-typography-600 italic py-4 text-center">
                  {debouncedSearch
                    ? en.userManagement.noOrganizationsMatch
                    : en.userManagement.noOrganizationsToAdd}
                </p>
              ) : (
                availableTenants.map(tenant => (
                  <label
                    key={tenant.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-background-secondary cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(tenant.id)}
                      onChange={() => toggleSelect(tenant.id)}
                      className="accent-primary-500 w-4 h-4"
                    />
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full flex-shrink-0 overflow-hidden">
                        <CustomImage
                          src={tenant.logoUrl}
                          alt={tenant.name}
                          className="rounded-full object-cover w-6 h-6"
                          fallbackClassName="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-typography-600 text-xs"
                          fallbackText={tenant.name?.slice(0, 1)?.toUpperCase() ?? "O"}
                        />
                      </div>
                      <span className="text-sm text-typography-900 truncate">{tenant.name}</span>
                    </div>
                  </label>
                ))
              )}
            </div>

            {matchCount > matches.length && (
              <p className="text-xs text-typography-600">
                {en.userManagement.organizationsTruncated(matches.length, matchCount)}
              </p>
            )}

            {/* Modal actions */}
            <div className="flex gap-3 flex-shrink-0">
              <Button variant={ButtonVariant.SECONDARY} onClick={closeAddModal} className="flex-1">
                {en.userManagement.cancel}
              </Button>
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={handleAssign}
                disabled={!selectedIds.length || isAssigning}
                className="flex-1"
              >
                {isAssigning ? en.common.loading : en.userManagement.confirm}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
