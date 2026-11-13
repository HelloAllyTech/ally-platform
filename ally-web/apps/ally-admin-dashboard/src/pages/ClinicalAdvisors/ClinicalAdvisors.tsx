import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@ally-ui-mono/ui-shared";
import {
  useAddClinicalAdvisorMutation,
  useListClinicalAdvisorsQuery,
  useRemoveClinicalAdvisorMutation,
  useSearchClinicalAdvisorCandidatesQuery,
} from "@api";
import { ActionConfirmationPopup, Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { ClinicalAdvisorPerson } from "@types";

const strings = en.clinicalAdvisors;

/** The advisor group's name in ally-be (`UserRole.CLINICAL_ADVISOR`). */
const ADVISOR_ROLE = "CLINICAL_ADVISOR";
/** How long the search waits after the last key before asking ally-be. */
export const ADVISOR_SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 3;

/** "SIMULATION_REVIEWER" → "Simulation reviewer" when the role has no name of its own. */
const roleName = (role: string) => {
  const known = strings.roleNames[role];
  if (known) return known;
  const words = role
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : role;
};
const otherRoles = (p: ClinicalAdvisorPerson) => p.roles.filter(r => r !== ADVISOR_ROLE);

const PILL =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs";

/** A person's roles as pills on one line: the first two, the rest behind "+N" with a tooltip. */
const RolePills: React.FC<{ roles: string[] }> = ({ roles }) => {
  if (roles.length === 0)
    return <span className="text-typography-600">{strings.noOtherRoles}</span>;
  const names = roles.map(roleName);
  const rest = names.slice(2);
  return (
    <span className="flex flex-nowrap items-center gap-1" data-testid="advisor-roles">
      {names.slice(0, 2).map(n => (
        <span key={n} className={`${PILL} bg-neutral-100 text-neutral-900`}>
          {n}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className={`${PILL} bg-neutral-100 text-neutral-900`}
          title={rest.join(", ")}
          data-testid="advisor-more-roles"
        >
          {strings.moreRoles(rest.length)}
        </span>
      )}
    </span>
  );
};

/** When the role and the console access disagree, which half is missing. */
const Incomplete: React.FC<{ p: ClinicalAdvisorPerson }> = ({ p }) =>
  p.advisor === p.signOff ? null : (
    <span className={`${PILL} bg-[#FFF2E8] text-[#8A3800]`} data-testid="advisor-incomplete">
      {p.advisor ? strings.needsConsole : strings.needsRole}
    </span>
  );

/** One line of text that truncates, with the whole text on hover. */
const Truncated: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <span title={text} className={`block min-w-0 truncate ${className ?? ""}`}>
    {text}
  </span>
);

type PendingAction =
  | { kind: "add"; target: ClinicalAdvisorPerson }
  | { kind: "remove"; target: ClinicalAdvisorPerson };

/**
 * User Management › Clinical advisors, next to Ally admins and gated the same way
 * (`admin_user_management`). Clinical advisors review debriefs from every organisation and
 * receive escalations. Adding or removing touches only the advisor's access (the role and the
 * Debriefs console toggle); every other role a person holds stays as it is.
 */
export const ClinicalAdvisors: React.FC = () => {
  const { data: advisors, isLoading, isError } = useListClinicalAdvisorsQuery();
  const [addAdvisor] = useAddClinicalAdvisorMutation();
  const [removeAdvisor] = useRemoveClinicalAdvisorMutation();
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed.trim()), ADVISOR_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed]);
  const searching = isAddPanelOpen && query.length >= MIN_QUERY;
  const found = useSearchClinicalAdvisorCandidatesQuery(query, { skip: !searching });

  const closeAddPanel = () => {
    setIsAddPanelOpen(false);
    setTyped("");
    setQuery("");
  };

  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { kind, target } = pendingAction;
    try {
      if (kind === "add") {
        await addAdvisor(target.userId).unwrap();
        toast.success(strings.added(target.name));
        closeAddPanel();
      } else {
        await removeAdvisor(target.userId).unwrap();
        toast.success(strings.removed(target.name));
      }
    } catch (error: any) {
      // ally-be says why in words (e.g. "This person has no other role; give them one first").
      toast.error(
        error?.data?.message || (kind === "add" ? strings.addFailed : strings.removeFailed),
      );
    } finally {
      setPendingAction(null);
    }
  };

  const renderTable = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-16 text-typography-600">{en.common.loading}</div>
      );
    }
    if (isError) {
      return (
        <EmptyState title={strings.loadFailed} subtitle={strings.loadFailedHelp} hideActionButton />
      );
    }
    if (!advisors || advisors.length === 0) {
      return <EmptyState title={strings.none} subtitle={strings.noneHelp} hideActionButton />;
    }
    return (
      <Table className="w-full text-left text-sm text-typography-900" data-testid="advisors-table">
        <TableHead>
          <TableRow className="border-b border-border-dark text-typography-600">
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.name}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.email}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">
              {strings.columns.organisation}
            </TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.roles}</TableHeader>
            <TableHeader className="py-3" />
          </TableRow>
        </TableHead>
        <TableBody>
          {advisors.map(p => (
            <TableRow
              key={p.userId}
              className="border-b border-border-light"
              data-testid="advisor-row"
            >
              <TableCell className="py-3 pr-4">
                <div className="flex min-w-[10rem] max-w-[16rem] flex-col items-start gap-1">
                  <Truncated text={p.name || p.email || "—"} className="max-w-full" />
                  <Incomplete p={p} />
                </div>
              </TableCell>
              <TableCell className="py-3 pr-4">
                <Truncated text={p.email ?? "—"} className="max-w-[14rem]" />
              </TableCell>
              <TableCell className="py-3 pr-4">
                <Truncated text={p.organisation ?? "—"} className="max-w-[12rem]" />
              </TableCell>
              <TableCell className="py-3 pr-4">
                <RolePills roles={otherRoles(p)} />
              </TableCell>
              <TableCell className="py-3 text-right">
                <div className="flex flex-nowrap justify-end gap-2">
                  {p.advisor !== p.signOff && (
                    <Button
                      variant={ButtonVariant.SECONDARY}
                      onClick={() => setPendingAction({ kind: "add", target: p })}
                      className="whitespace-nowrap px-3 py-1 text-sm"
                    >
                      {strings.fix}
                    </Button>
                  )}
                  {p.advisor && (
                    <Button
                      variant={ButtonVariant.DESTRUCTIVE}
                      onClick={() => setPendingAction({ kind: "remove", target: p })}
                      className="whitespace-nowrap px-3 py-1 text-sm"
                    >
                      {strings.remove}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const renderMatches = () => {
    if (!searching) {
      return (
        <p className="py-8 text-center text-sm text-typography-600">{strings.searchPlaceholder}</p>
      );
    }
    if (found.isError) {
      return <p className="py-8 text-center text-sm text-typography-600">{strings.searchFailed}</p>;
    }
    if (!found.data) {
      return <div className="py-8 text-center text-typography-600">{strings.searching}</div>;
    }
    if (found.data.length === 0) {
      return (
        <p
          className="py-8 text-center text-sm text-typography-600"
          data-testid="advisor-no-matches"
        >
          {strings.noMatches}
        </p>
      );
    }
    return found.data.map(p => {
      const complete = p.advisor && p.signOff;
      return (
        <div
          key={p.userId}
          className="flex min-w-0 flex-nowrap items-center gap-3 border-b border-border-light px-1 py-2.5"
          data-testid="advisor-match"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            {/* Bulk-created accounts can have a blank name: the email is the first line then. */}
            <Truncated text={p.name || p.email || "—"} className="text-sm text-typography-900" />
            <Truncated
              text={[p.organisation, p.name ? p.email : null].filter(Boolean).join(" · ") || "—"}
              className="text-xs text-typography-600"
            />
            <span className="mt-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
              <RolePills roles={otherRoles(p)} />
            </span>
          </span>
          {complete ? (
            <span className={`${PILL} bg-success-50 text-success-600`}>
              {strings.alreadyAdvisor}
            </span>
          ) : (
            <span className="flex shrink-0 flex-col items-end gap-1">
              <Incomplete p={p} />
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={() => setPendingAction({ kind: "add", target: p })}
                className="px-3 py-1 text-sm"
              >
                {strings.add}
              </Button>
            </span>
          )}
        </div>
      );
    });
  };

  const renderAddPanel = () => {
    if (!isAddPanelOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 md:px-0">
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={closeAddPanel} />
        <div
          className="relative flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden bg-white p-4 shadow-xl md:p-6"
          data-testid="advisor-add-panel"
        >
          <h2 className="mb-4 font-secondary text-xl text-typography-900">{strings.addHeading}</h2>
          <input
            type="search"
            enterKeyHint="search"
            aria-label={strings.searchLabel}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            placeholder={strings.searchPlaceholder}
            className="mb-4 shrink-0 border border-border-dark px-3 py-2 text-sm outline-none"
          />
          {/* min-h-0 lets the list shrink below its content height, so it scrolls. */}
          <div className="min-h-0 flex-1 overflow-y-auto">{renderMatches()}</div>
          <div className="mt-4 flex justify-end">
            <Button variant={ButtonVariant.SECONDARY} onClick={closeAddPanel}>
              {strings.cancel}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const pendingCopy = pendingAction
    ? pendingAction.kind === "add"
      ? {
          title: strings.addTitle,
          description: strings.addBody(
            pendingAction.target.name,
            otherRoles(pendingAction.target).map(roleName).join(", "),
          ),
          label: strings.addConfirm,
          variant: ButtonVariant.PRIMARY,
        }
      : {
          title: strings.removeTitle,
          description: strings.removeBody(pendingAction.target.name),
          label: strings.removeConfirm,
          variant: ButtonVariant.DESTRUCTIVE,
        }
    : null;

  return (
    <div className="relative overflow-hidden py-[2px] font-primary" data-testid="clinical-advisors">
      <div className="flex flex-nowrap items-start justify-between gap-4 pb-4">
        <p className="min-w-0 max-w-3xl text-sm text-typography-600">{strings.intro}</p>
        <Button
          variant={ButtonVariant.PRIMARY}
          onClick={() => setIsAddPanelOpen(true)}
          className="shrink-0 whitespace-nowrap"
        >
          {strings.addHeading}
        </Button>
      </div>
      {/* 260px ≈ User Management header + tab strip + this tab's own chrome. */}
      <div className="md:h-[calc(100vh-260px)] md:overflow-y-auto">{renderTable()}</div>

      {renderAddPanel()}

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
          secondaryButton={{ label: strings.cancel, onClick: () => setPendingAction(null) }}
        />
      )}
    </div>
  );
};
