import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useAssignPlatformAdminMutation,
  useListClinicalAdvisorsQuery,
  useListEligiblePlatformAdminsQuery,
  useListPlatformAdminsQuery,
  useListRoadmapRolesQuery,
  useRemovePlatformAdminMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { ActionConfirmationPopup, Button, EmptyState, ListToolbar, StatusBadge } from "@components";
import { Button as ButtonDirect } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { PlatformAdmin } from "@types";

import { CustomLoginPanel } from "./CustomLoginPanel";
import { PlatformAdminDetail } from "./PlatformAdminDetail";

// From its own module: User Management's tests mock the `@components` barrel.
const CustomLoginButton = ButtonDirect;

const strings = en.superAdmins;

const formatDate = (value: string) => new Date(value).toLocaleDateString();

/** Which confirmation the user is being asked for, and on whom. */
type PendingAction =
  | { kind: "add"; target: PlatformAdmin }
  | { kind: "remove"; target: PlatformAdmin };

/**
 * Management surface for the consolidated PLATFORM_ADMIN role, rendered as the
 * "Ally admins" tab inside User Management (next to Organizations). Replaces
 * the former promote/demote tier list: there is now a single role, plus a
 * per-admin feature-toggle matrix (see PlatformAdminDetail). From here an
 * `admin_user_management` holder can:
 *  - add a new platform admin (from the eligible-users picker),
 *  - remove one again,
 *  - click through to a platform admin's row to edit their toggles and
 *    tenant allowlist.
 */
export const SuperAdmins: React.FC = () => {
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<PlatformAdmin | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedAdmin, setSelectedAdmin] = useState<PlatformAdmin | null>(null);

  const listParams = search ? { search } : undefined;
  const { data: platformAdminsData, isLoading: isPlatformAdminsLoading } =
    useListPlatformAdminsQuery(listParams);
  // Each admin's Debrief roles, as badges beside the name (switched on the admin's own page).
  const { data: debriefPeople } = useListClinicalAdvisorsQuery();
  const debriefRoles = useMemo(
    () =>
      new Map(
        (debriefPeople ?? []).map(p => [
          p.userId,
          [p.advisor ? strings.debriefAdvisor : null, p.owner ? strings.debriefOwner : null].filter(
            (x): x is string => !!x,
          ),
        ]),
      ),
    [debriefPeople],
  );
  // Everyone's Roadmap role in one column. The list answers only for an Owner while the Roadmap
  // is on; for anyone else it errors and the column stays away.
  const { data: roadmapRolesData } = useListRoadmapRolesQuery();
  const roadmapRoles = useMemo(
    () => new Map((roadmapRolesData?.users ?? []).map(u => [Number(u.userId), u])),
    [roadmapRolesData],
  );
  const showRoadmapRoles = !!roadmapRolesData;
  const roadmapRoleLabel = (userId: number) => {
    const copy = en.roadmapV2Tools.roles;
    const entry = roadmapRoles.get(Number(userId));
    if (!entry || entry.role === "none") return copy.noRole;
    if (entry.role === "viewer") return copy.viewer;
    return copy.options[entry.role] ?? copy.noRole;
  };
  const { data: candidatesData, isFetching: isCandidatesFetching } =
    useListEligiblePlatformAdminsQuery(candidateSearch ? { search: candidateSearch } : undefined, {
      skip: !isAddPanelOpen,
    });

  const [assignPlatformAdmin] = useAssignPlatformAdminMutation();
  // A1 custom logins: create one, or change what an existing platform admin can use.
  const [customLogin, setCustomLogin] = useState<{ edit?: PlatformAdmin } | null>(null);
  const [removePlatformAdmin] = useRemovePlatformAdminMutation();

  const admins = useMemo<PlatformAdmin[]>(
    () => platformAdminsData?.data ?? [],
    [platformAdminsData],
  );
  const candidates = candidatesData?.data ?? [];

  const closeAddPanel = () => {
    setIsAddPanelOpen(false);
    setAddTarget(null);
    setCandidateSearch("");
  };

  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { kind, target } = pendingAction;
    try {
      switch (kind) {
        case "add":
          await assignPlatformAdmin({ userId: target.id }).unwrap();
          toast.success(strings.addPlatformAdminSuccess);
          closeAddPanel();
          break;
        case "remove":
          await removePlatformAdmin(target.id).unwrap();
          toast.success(strings.removePlatformAdminSuccess);
          break;
      }
    } catch (error: any) {
      const fallback = {
        add: strings.addPlatformAdminError,
        remove: strings.removePlatformAdminError,
      }[kind];
      toast.error(error?.data?.message || fallback);
    } finally {
      setPendingAction(null);
    }
  };

  const confirmCopy = (action: PendingAction) => {
    switch (action.kind) {
      case "add":
        return {
          title: strings.addPlatformAdminConfirmTitle,
          description: strings.addPlatformAdminConfirmDescription(action.target.name),
          label: strings.addPlatformAdmin,
          variant: ButtonVariant.PRIMARY,
        };
      case "remove":
        return {
          title: strings.removePlatformAdminConfirmTitle,
          description: strings.removePlatformAdminConfirmDescription(action.target.name),
          label: strings.remove,
          variant: ButtonVariant.DESTRUCTIVE,
        };
    }
  };

  const renderAdminsTable = () => {
    if (isPlatformAdminsLoading) {
      return <div className="flex justify-center py-16 text-typography-600">{strings.loading}</div>;
    }

    if (admins.length === 0) {
      return (
        <EmptyState
          title={strings.noPlatformAdminsFound}
          subtitle={strings.noPlatformAdminsSubtitle}
          hideActionButton
        />
      );
    }

    return (
      <Table className="w-full text-left text-sm text-typography-900">
        <TableHead>
          <TableRow className="border-b border-border-dark text-typography-600">
            <TableHeader className="py-3 pr-4 font-medium">{strings.name}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.email}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.status}</TableHeader>
            {showRoadmapRoles && (
              <TableHeader className="py-3 pr-4 font-medium">
                <span className="inline-flex items-center gap-1">
                  {en.roadmapV2Tools.roles.column}
                  <Tooltip label={en.roadmapV2Tools.roles.columnHelp} align="top">
                    <button type="button" className="cursor-pointer inline-flex items-center">
                      <TooltipIcon />
                    </button>
                  </Tooltip>
                </span>
              </TableHeader>
            )}
            <TableHeader className="py-3 pr-4 font-medium">
              {/* The date is the role grant, not the account — worth spelling
                  out, since the two are years apart for long-time users and
                  this column is what people read when auditing grants. */}
              <span className="inline-flex items-center gap-1">
                {strings.addedOn}
                <Tooltip label={strings.addedOnTooltip} align="top">
                  <button type="button" className="cursor-pointer inline-flex items-center">
                    <TooltipIcon />
                  </button>
                </Tooltip>
              </span>
            </TableHeader>
            <TableHeader className="py-3" />
          </TableRow>
        </TableHead>
        <TableBody>
          {admins.map(admin => (
            <TableRow
              key={admin.id}
              className="border-b border-border-light cursor-pointer hover:bg-background-secondary"
              data-testid="sa-row"
              onClick={() => setSelectedAdmin(admin)}
            >
              <TableCell className="py-3 pr-4">
                <div className="flex min-w-0 flex-nowrap items-center gap-2">
                  <span className="truncate">{admin.name || admin.email}</span>
                  {(debriefRoles.get(admin.id) ?? []).map(role => (
                    <span
                      key={role}
                      data-testid="sa-debrief-role"
                      className="shrink-0 whitespace-nowrap rounded-sm bg-primary-50 px-2 py-0.5 text-xs text-primary-700"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell className="py-3 pr-4">{admin.email}</TableCell>
              <TableCell className="py-3 pr-4">
                <StatusBadge status={admin.status} />
              </TableCell>
              {showRoadmapRoles && (
                <TableCell className="py-3 pr-4" data-testid="sa-roadmap-role">
                  {roadmapRoleLabel(admin.id)}
                </TableCell>
              )}
              <TableCell className="py-3 pr-4">{formatDate(admin.roleGrantedAt)}</TableCell>
              <TableCell className="py-3 text-right whitespace-nowrap">
                <CustomLoginButton
                  variant={ButtonVariant.TERTIARY}
                  onClick={event => {
                    event.stopPropagation();
                    setCustomLogin({ edit: admin });
                  }}
                  className="mr-2 px-3 py-1 text-sm"
                  data-testid="sa-edit-features"
                >
                  {en.customLogins.edit}
                </CustomLoginButton>
                <Button
                  variant={ButtonVariant.DESTRUCTIVE}
                  onClick={event => {
                    event.stopPropagation();
                    setPendingAction({ kind: "remove", target: admin });
                  }}
                  className="px-3 py-1 text-sm"
                >
                  {strings.remove}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const renderAddPanel = () => {
    if (!isAddPanelOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 md:px-0">
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={closeAddPanel} />
        <div className="relative bg-white shadow-xl max-w-lg w-full p-4 md:p-6 max-h-[80dvh] flex flex-col overflow-hidden">
          <h2 className="text-xl text-typography-900 font-secondary mb-4">
            {strings.addPlatformAdmin}
          </h2>
          <input
            type="search"
            enterKeyHint="search"
            value={candidateSearch}
            onChange={event => setCandidateSearch(event.target.value)}
            placeholder={strings.searchPlaceholder}
            className="border border-border-dark px-3 py-2 mb-4 text-sm outline-none shrink-0"
          />
          {/* min-h-0 lets this flex child shrink below its content height —
              without it the list grows past max-h-[80vh] and never scrolls. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isCandidatesFetching ? (
              <div className="py-8 text-center text-typography-600">{en.common.loading}</div>
            ) : candidates.length === 0 ? (
              <EmptyState
                title={strings.noEligibleUsers}
                subtitle={strings.noEligibleUsersSubtitle}
                hideActionButton
                className="!py-8"
              />
            ) : (
              candidates.map(user => (
                <label
                  key={user.id}
                  className="flex items-center gap-3 py-2 px-1 cursor-pointer hover:bg-neutral-50"
                >
                  <input
                    type="radio"
                    name="add-platform-admin-target"
                    checked={addTarget?.id === user.id}
                    onChange={() => setAddTarget(user)}
                  />
                  <span className="flex flex-col">
                    {/* Bulk-created accounts can have a blank name — fall back
                        to the email as the primary line. */}
                    <span className="text-sm text-typography-900">{user.name || user.email}</span>
                    {user.name && <span className="text-xs text-typography-600">{user.email}</span>}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 mt-4">
            <Button variant={ButtonVariant.SECONDARY} onClick={closeAddPanel}>
              {strings.cancel}
            </Button>
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={() => addTarget && setPendingAction({ kind: "add", target: addTarget })}
              disabled={!addTarget}
            >
              {strings.addPlatformAdmin}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const pendingCopy = pendingAction ? confirmCopy(pendingAction) : null;

  if (selectedAdmin) {
    return <PlatformAdminDetail admin={selectedAdmin} onBack={() => setSelectedAdmin(null)} />;
  }

  return (
    <div className="py-[2px] font-primary overflow-hidden relative">
      <p className="text-sm text-typography-600 pb-4">{strings.platformAdminsSubtitle}</p>
      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        placeholder={strings.searchPlaceholder}
        action={{
          label: strings.addPlatformAdmin,
          onClick: () => setIsAddPanelOpen(true),
          variant: ButtonVariant.PRIMARY,
        }}
      />
      {/* 260px ≈ User Management header + tab strip + this tab's own chrome. */}
      <div className="mt-[20px] md:overflow-y-auto md:h-[calc(100vh-260px)]">
        {renderAdminsTable()}
      </div>

      {renderAddPanel()}

      {customLogin && (
        <CustomLoginPanel edit={customLogin.edit} onClose={() => setCustomLogin(null)} />
      )}

      {pendingAction && pendingCopy && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setPendingAction(null)}
          title={pendingCopy.title}
          description={pendingCopy.description}
          primaryButton={{
            label: pendingCopy.label,
            onClick: runPendingAction,
            variant: pendingCopy.variant,
          }}
          secondaryButton={{
            label: strings.cancel,
            onClick: () => setPendingAction(null),
          }}
        />
      )}
    </div>
  );
};
