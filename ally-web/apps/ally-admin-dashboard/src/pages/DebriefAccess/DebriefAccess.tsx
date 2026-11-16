import React, { useEffect, useState } from "react";

import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  OverflowMenu,
  OverflowMenuItem,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@ally-ui-mono/ui-shared";
import {
  useAddClinicalAdvisorMutation,
  useAddDebriefOwnerMutation,
  useListClinicalAdvisorsQuery,
  useRemoveClinicalAdvisorMutation,
  useRemoveDebriefOwnerMutation,
  useSearchClinicalAdvisorCandidatesQuery,
} from "@api";
import { ActionConfirmationPopup, Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { ClinicalAdvisorPerson } from "@types";

const strings = en.debriefAccess;

/** The two debrief roles' group names in ally-be (`UserRole`). */
const DEBRIEF_GROUPS = ["CLINICAL_ADVISOR", "DEBRIEF_OWNER"];
/** How long the search waits after the last key before asking ally-be. */
export const DEBRIEF_ACCESS_SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 3;

type Role = "advisor" | "owner";
type Op = "add" | "remove";

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
const otherRoles = (p: ClinicalAdvisorPerson) => p.roles.filter(r => !DEBRIEF_GROUPS.includes(r));
const debriefRoles = (p: ClinicalAdvisorPerson): Role[] =>
  (["advisor", "owner"] as Role[]).filter(r => p[r]);
/** A debrief role without the console access, or the access without a role. */
const incomplete = (p: ClinicalAdvisorPerson) => (p.advisor || p.owner) !== p.signOff;
/** What "Fix access" adds: the role already held (which turns the access on), else advisor. */
const fixRole = (p: ClinicalAdvisorPerson): Role => (p.owner && !p.advisor ? "owner" : "advisor");

const PILL =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs";

/** Roles as pills on one line: the first two, the rest behind "+N" with a tooltip. */
const RolePills: React.FC<{ names: string[]; empty: string; tone?: string; testId: string }> = ({
  names,
  empty,
  tone = "bg-neutral-100 text-neutral-900",
  testId,
}) => {
  if (names.length === 0)
    return (
      <span className="whitespace-nowrap text-typography-600" data-testid={testId}>
        {empty}
      </span>
    );
  const rest = names.slice(2);
  return (
    <span className="flex flex-nowrap items-center gap-1" data-testid={testId}>
      {names.slice(0, 2).map(n => (
        <span key={n} className={`${PILL} ${tone}`}>
          {n}
        </span>
      ))}
      {rest.length > 0 && (
        <span className={`${PILL} ${tone}`} title={rest.join(", ")} data-testid={`${testId}-more`}>
          {strings.moreRoles(rest.length)}
        </span>
      )}
    </span>
  );
};

const OtherRoles: React.FC<{ p: ClinicalAdvisorPerson }> = ({ p }) => (
  <RolePills
    names={otherRoles(p).map(roleName)}
    empty={strings.noOtherRoles}
    testId="access-roles"
  />
);
const DebriefRoles: React.FC<{ p: ClinicalAdvisorPerson }> = ({ p }) => (
  <RolePills
    names={debriefRoles(p).map(r => strings.roleLabels[r])}
    empty={strings.noDebriefRole}
    tone="bg-primary-50 text-primary-700"
    testId="access-debrief-roles"
  />
);

const Incomplete: React.FC<{ p: ClinicalAdvisorPerson }> = ({ p }) =>
  incomplete(p) ? (
    <span className={`${PILL} bg-[#FFF2E8] text-[#8A3800]`} data-testid="access-incomplete">
      {p.signOff ? strings.needsRole : strings.needsConsole}
    </span>
  ) : null;

/** One line of text that truncates, with the whole text on hover. */
const Truncated: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <span title={text} className={`block min-w-0 truncate ${className ?? ""}`}>
    {text}
  </span>
);

interface Pending {
  role: Role;
  op: Op;
  target: ClinicalAdvisorPerson;
  /** Close the add panel once done. */
  fromPanel?: boolean;
}

/** The role actions that apply to a person: add what they lack, remove what they hold. */
const roleActions = (p: ClinicalAdvisorPerson): Array<{ role: Role; op: Op; label: string }> => [
  p.advisor
    ? { role: "advisor", op: "remove", label: strings.removeAdvisor }
    : { role: "advisor", op: "add", label: strings.makeAdvisor },
  p.owner
    ? { role: "owner", op: "remove", label: strings.removeOwner }
    : { role: "owner", op: "add", label: strings.makeOwner },
];

/**
 * User Management › Debrief access, next to Ally admins and gated the same way
 * (`admin_user_management`). Two roles reach every organisation's debriefs: the Clinical advisor
 * (reviews debriefs, receives escalations) and the Debrief owner (debrief settings, releases, the
 * PM agent). Adding or removing a role touches only that role and the Debriefs console access
 * (on with the first role, off with the last); everything else a person holds stays as it is.
 */
export const DebriefAccess: React.FC = () => {
  const { data: people, isLoading, isError } = useListClinicalAdvisorsQuery();
  const [addAdvisor] = useAddClinicalAdvisorMutation();
  const [removeAdvisor] = useRemoveClinicalAdvisorMutation();
  const [addOwner] = useAddDebriefOwnerMutation();
  const [removeOwner] = useRemoveDebriefOwnerMutation();
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed.trim()), DEBRIEF_ACCESS_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed]);
  const searching = isAddPanelOpen && query.length >= MIN_QUERY;
  const found = useSearchClinicalAdvisorCandidatesQuery(query, { skip: !searching });

  const closeAddPanel = () => {
    setIsAddPanelOpen(false);
    setTyped("");
    setQuery("");
  };

  const run = async () => {
    if (!pending) return;
    const { role, op, target, fromPanel } = pending;
    const call = {
      advisor: { add: addAdvisor, remove: removeAdvisor },
      owner: { add: addOwner, remove: removeOwner },
    }[role][op];
    const key = `${op}${role === "advisor" ? "Advisor" : "Owner"}` as const;
    try {
      await call(target.userId).unwrap();
      toast.success(strings.done[key](target.name));
      if (fromPanel) closeAddPanel();
    } catch (error: any) {
      // ally-be says why in words (e.g. "This person has no other role; give them one first").
      toast.error(error?.data?.message || strings.failed[op]);
    } finally {
      setPending(null);
    }
  };

  const ask = (role: Role, op: Op, target: ClinicalAdvisorPerson, fromPanel = false) =>
    setPending({ role, op, target, fromPanel });

  const pendingCopy = (() => {
    if (!pending) return null;
    const c = strings.confirm;
    const name = pending.target.name || pending.target.email || "";
    const roles = otherRoles(pending.target).map(roleName).join(", ");
    if (pending.role === "advisor") {
      return pending.op === "add"
        ? { title: c.addAdvisorTitle, body: c.addAdvisor(name, roles), label: c.addAdvisorLabel }
        : { title: c.removeAdvisorTitle, body: c.removeAdvisor(name), label: c.removeAdvisorLabel };
    }
    return pending.op === "add"
      ? { title: c.addOwnerTitle, body: c.addOwner(name, roles), label: c.addOwnerLabel }
      : { title: c.removeOwnerTitle, body: c.removeOwner(name), label: c.removeOwnerLabel };
  })();

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
    if (!people || people.length === 0) {
      return <EmptyState title={strings.none} subtitle={strings.noneHelp} hideActionButton />;
    }
    return (
      <Table className="w-full text-left text-sm text-typography-900" data-testid="access-table">
        <TableHead>
          <TableRow className="border-b border-border-dark text-typography-600">
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.name}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.email}</TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">
              {strings.columns.organisation}
            </TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">
              {strings.columns.debriefRoles}
            </TableHeader>
            <TableHeader className="py-3 pr-4 font-medium">{strings.columns.roles}</TableHeader>
            <TableHeader className="py-3" />
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map(p => (
            <TableRow
              key={p.userId}
              className="border-b border-border-light"
              data-testid="access-row"
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
                <DebriefRoles p={p} />
              </TableCell>
              <TableCell className="py-3 pr-4">
                <OtherRoles p={p} />
              </TableCell>
              <TableCell className="py-3 text-right">
                {/* One row: Fix access when it is needed, every role change in More. */}
                <div className="flex flex-nowrap items-center justify-end gap-2">
                  {incomplete(p) && (
                    <Button
                      variant={ButtonVariant.SECONDARY}
                      onClick={() => ask(fixRole(p), "add", p)}
                      className="whitespace-nowrap px-3 py-1 text-sm"
                    >
                      {strings.fix}
                    </Button>
                  )}
                  <OverflowMenu
                    size="md"
                    flipped
                    align="bottom-end"
                    iconDescription={strings.moreActions}
                    menuOptionsClass="!w-64 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
                    aria-label={strings.moreActions}
                    className="shrink-0"
                    data-testid="access-more"
                  >
                    {roleActions(p).map(a => (
                      <OverflowMenuItem
                        key={`${a.op}-${a.role}`}
                        itemText={a.label}
                        isDelete={a.op === "remove"}
                        onClick={() => ask(a.role, a.op, p)}
                      />
                    ))}
                  </OverflowMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const renderMatches = () => {
    const note = (text: string, testId?: string) => (
      <p className="py-8 text-center text-sm text-typography-600" data-testid={testId}>
        {text}
      </p>
    );
    if (!searching) return note(strings.searchPlaceholder);
    if (found.isError) return note(strings.searchFailed);
    if (!found.data) return note(strings.searching);
    if (found.data.length === 0) return note(strings.noMatches, "access-no-matches");
    return found.data.map(p => {
      const lacking = (["advisor", "owner"] as Role[]).filter(r => !p[r]);
      return (
        <div
          key={p.userId}
          className="flex min-w-0 flex-nowrap items-center gap-3 border-b border-border-light px-1 py-2.5"
          data-testid="access-match"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            {/* Bulk-created accounts can have a blank name: the email is the first line then. */}
            <Truncated text={p.name || p.email || "—"} className="text-sm text-typography-900" />
            <Truncated
              text={[p.organisation, p.name ? p.email : null].filter(Boolean).join(" · ") || "—"}
              className="text-xs text-typography-600"
            />
            <span className="mt-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
              {debriefRoles(p).length > 0 && <DebriefRoles p={p} />}
              <OtherRoles p={p} />
            </span>
          </span>
          {lacking.length === 0 ? (
            <span className={`${PILL} bg-success-50 text-success-600`}>{strings.hasBoth}</span>
          ) : (
            <OverflowMenu
              size="md"
              flipped
              align="bottom-end"
              iconDescription={strings.addAs}
              menuOptionsClass="!w-64 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
              aria-label={strings.addAs}
              renderIcon={() => (
                <span className="flex items-center gap-1 whitespace-nowrap px-2 text-sm text-primary-500">
                  {strings.addAs}
                  <ChevronDown size={12} aria-hidden="true" />
                </span>
              )}
              className="!w-auto shrink-0"
              data-testid="access-add-as"
            >
              {lacking.map(r => (
                <OverflowMenuItem
                  key={r}
                  itemText={r === "advisor" ? strings.addAsAdvisor : strings.addAsOwner}
                  onClick={() => ask(r, "add", p, true)}
                />
              ))}
            </OverflowMenu>
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
          data-testid="access-add-panel"
        >
          <h2 className="mb-4 font-secondary text-xl text-typography-900">{strings.addPerson}</h2>
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

  return (
    <div className="relative overflow-hidden py-[2px] font-primary" data-testid="debrief-access">
      <div className="flex flex-nowrap items-start justify-between gap-4 pb-4">
        <p className="min-w-0 max-w-3xl text-sm text-typography-600">{strings.intro}</p>
        <Button
          variant={ButtonVariant.PRIMARY}
          onClick={() => setIsAddPanelOpen(true)}
          className="shrink-0 whitespace-nowrap"
        >
          {strings.addPerson}
        </Button>
      </div>
      {/* 260px ≈ User Management header + tab strip + this tab's own chrome. */}
      <div className="md:h-[calc(100vh-260px)] md:overflow-y-auto">{renderTable()}</div>

      {renderAddPanel()}

      {pending && pendingCopy && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setPending(null)}
          title={pendingCopy.title}
          description={pendingCopy.body}
          primaryButton={{
            label: pendingCopy.label,
            onClick: run,
            variant: pending.op === "remove" ? ButtonVariant.DESTRUCTIVE : ButtonVariant.PRIMARY,
          }}
          secondaryButton={{ label: strings.cancel, onClick: () => setPending(null) }}
        />
      )}
    </div>
  );
};
