import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Close, Refresh } from "@icons";
import { useSearchParams } from "react-router-dom";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideThreadQuery,
  useGetTenantsQuery,
  useLazyGetAllyGuideThreadsQuery,
} from "@api";
import { formatCount, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { FilterDropdown } from "@components/filters";
import { ListToolbar } from "@components/toolbar";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { AllyGuideMode, AllyGuideThreadRow, AllyGuideThreadStatus } from "@types";
import { formatRelativeTime, formatTimestamp } from "@utils";

import {
  EMPTY_THREAD_FILTERS,
  hasActiveThreadFilters,
  matchesThreadFilters,
  organisationOptions,
  serverQueryFor,
  serverQueryKey,
  THREADS_PAGE_SIZE,
  ThreadFilters,
} from "./conversationFilters";
import { TurnInspector } from "./TurnInspector";

/**
 * The organisation list feeds the Filter popover only (the table's names come from each row). It is
 * read once, at the size the other pickers in the admin use.
 */
const TENANT_PAGE_SIZE = 200;

const MODES: AllyGuideMode[] = ["NORMAL", "CARE", "CRISIS", "CRISIS_FOLLOWUP"];
const STATUSES: AllyGuideThreadStatus[] = ["active", "completed", "merged", "archived"];

const modeTone = (mode: AllyGuideMode): PillTone =>
  mode === "NORMAL" ? "neutral" : mode === "CARE" ? "warning" : "danger";

/** One page at a time, appended: the server's cursor is the last row's own `cursor`. */
const useThreads = (filters: ThreadFilters) => {
  const [fetchPage] = useLazyGetAllyGuideThreadsQuery();
  const [rows, setRows] = useState<AllyGuideThreadRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [exhausted, setExhausted] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // A reply that arrives after the filters changed belongs to a query nobody is looking at.
  const generation = useRef(0);

  const query = serverQueryFor(filters);
  const key = serverQueryKey(filters);

  const loadFirst = useCallback(async () => {
    const mine = (generation.current += 1);
    setStatus("loading");
    setRows([]);
    setExhausted(false);
    try {
      const page = await fetchPage({ limit: THREADS_PAGE_SIZE, ...query }, false).unwrap();
      if (mine !== generation.current) return;
      setRows(page);
      setExhausted(page.length < THREADS_PAGE_SIZE);
      setStatus("ready");
    } catch (failure) {
      if (mine !== generation.current) return;
      setError(failure);
      setStatus("error");
    }
    // `key` stands for `query`: it changes exactly when the server-side filter does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, key]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last || isLoadingMore) return;
    const mine = generation.current;
    setIsLoadingMore(true);
    try {
      const page = await fetchPage(
        { limit: THREADS_PAGE_SIZE, before: last.cursor, ...query },
        false,
      ).unwrap();
      if (mine !== generation.current) return;
      setRows(current => {
        const seen = new Set(current.map(row => row.id));
        return [...current, ...page.filter(row => !seen.has(row.id))];
      });
      setExhausted(page.length < THREADS_PAGE_SIZE);
    } catch (failure) {
      if (mine !== generation.current) return;
      setError(failure);
      setStatus("error");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return { rows, status, error, exhausted, isLoadingMore, loadFirst, loadMore };
};

/**
 * Every Ally conversation, newest activity first, with no content: course, organisation, mode,
 * status, turns, cost and crisis signals. A row opens the Turn Inspector.
 *
 * Filtering follows the admin's list pattern (a search box, a Filter popover, chips). The server
 * filters by one organisation and one mode; picking several is handled here, on the rows that
 * arrive, and the footer says so.
 */
export const ConversationsTab: React.FC = () => {
  const strings = en.allyConsole.conversations;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("thread");

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ThreadFilters>(EMPTY_THREAD_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const { rows, status, error, exhausted, isLoadingMore, loadFirst, loadMore } =
    useThreads(filters);

  // Only for the Filter popover. If the list cannot be read (no access to organisations), the
  // popover still offers every organisation seen on a loaded row.
  const { data: tenantPage } = useGetTenantsQuery({ limit: TENANT_PAGE_SIZE });
  const organisations = useMemo(
    () => organisationOptions(tenantPage?.data ?? [], rows),
    [tenantPage, rows],
  );
  const organisationNames = useMemo(
    () => Object.fromEntries(organisations.map(option => [option.value, option.label])),
    [organisations],
  );

  const visible = useMemo(
    () => rows.filter(row => matchesThreadFilters(row, filters, search)),
    [rows, filters, search],
  );
  const filtering = hasActiveThreadFilters(filters, search);
  const multiFacet =
    filters.tenantIds.length > 1 || filters.modes.length > 1 || filters.statuses.length > 1;

  const open = (id: string) => setSearchParams({ tab: "conversations", thread: id });
  const close = () => setSearchParams({ tab: "conversations" });
  const selectedRow = rows.find(row => row.id === selectedId);
  // A link to a conversation the list has not loaded: ask for just that row, for the header.
  const { data: linkedRow } = useGetAllyGuideThreadQuery(selectedId ?? "", {
    skip: !selectedId || Boolean(selectedRow),
  });

  /** The organisation as the table says it: the server's name, "Visitor" before sign-in, or nothing. */
  const organisationText = (row: AllyGuideThreadRow) =>
    row.tenantName ??
    (row.tenantId
      ? row.tenantId.slice(0, 8)
      : row.visitor
        ? strings.notSignedIn
        : strings.noOrganisation);

  // Chips are drawn here, not by ListToolbar's `filterChips`: those run every label through a
  // capitalisation helper that lower-cases everything after the first letter, which would turn an
  // organisation called "NIMHANS Bengaluru" into "Nimhans bengaluru".
  const chip = (label: string, values: string[], onClear: () => void) =>
    values.length === 0 ? null : (
      <div
        key={label}
        className="flex items-center rounded-full border border-border-light px-2 text-sm text-typography-900"
      >
        <span className="mr-1 text-xs">{label}:</span>
        <span className="mr-1 text-xs font-medium">{values.join(", ")}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label={`${en.common.removeFilter}: ${label}`}
          className="inline-flex h-8 w-8 items-center justify-center text-typography-800 hover:text-typography-900 md:h-auto md:w-auto"
        >
          <Close size={14} aria-hidden="true" />
        </button>
      </div>
    );

  // The organisation section is left out until there is something to offer: FilterDropdown reports
  // only the sections it was given, so an empty one would come back as "cleared" and wipe a chosen
  // filter.
  const sections = useMemo(
    () => [
      ...(organisations.length > 0
        ? [{ id: "tenantIds" as const, label: strings.organisation, options: organisations }]
        : []),
      {
        id: "modes" as const,
        label: strings.mode,
        options: MODES.map(mode => ({ value: mode, label: en.allyConsole.modes[mode] })),
      },
      {
        id: "statuses" as const,
        label: strings.statusFilter,
        options: STATUSES.map(status => ({
          value: status,
          label: en.allyConsole.threadStatuses[status],
        })),
      },
    ],
    [organisations, strings.organisation, strings.mode, strings.statusFilter],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="ally-conversations">
      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        placeholder={strings.searchPlaceholder}
        addFilterCta={{ label: strings.filter, onClick: () => setIsFilterOpen(value => !value) }}
        addFilterButtonRef={filterButtonRef}
        filter={
          <>
            {chip(
              strings.organisation,
              filters.tenantIds.map(id => organisationNames[id] ?? id.slice(0, 8)),
              () => setFilters(current => ({ ...current, tenantIds: [] })),
            )}
            {chip(
              strings.mode,
              filters.modes.map(mode => en.allyConsole.modes[mode]),
              () => setFilters(current => ({ ...current, modes: [] })),
            )}
            {chip(
              strings.statusFilter,
              filters.statuses.map(status => en.allyConsole.threadStatuses[status]),
              () => setFilters(current => ({ ...current, statuses: [] })),
            )}
          </>
        }
        secondaryAction={{
          label: strings.refresh,
          icon: <Refresh size={16} />,
          variant: ButtonVariant.TEXT,
          onClick: () => void loadFirst(),
        }}
      />
      <FilterDropdown<{ tenantIds: string[]; modes: string[]; statuses: string[] }>
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        sections={sections}
        onApplyFilters={next =>
          setFilters(current => ({
            // An omitted section means "no opinion", not "cleared" (the organisation list may
            // still be loading), so only a section that came back replaces what was chosen.
            tenantIds: next.tenantIds ?? current.tenantIds,
            modes: (next.modes as AllyGuideMode[] | undefined) ?? current.modes,
            statuses: (next.statuses as AllyGuideThreadStatus[] | undefined) ?? current.statuses,
          }))
        }
        anchorRect={filterButtonRef.current?.getBoundingClientRect() ?? null}
        currentFilters={{
          tenantIds: filters.tenantIds,
          modes: filters.modes,
          statuses: filters.statuses,
        }}
      />

      {status === "loading" ? (
        <LoadingBlock lines={6} />
      ) : status === "error" ? (
        <ErrorPanel what="conversations" error={error} onRetry={() => void loadFirst()} />
      ) : visible.length === 0 ? (
        <>
          <EmptyPanel
            title={filtering ? strings.emptyFilteredTitle : strings.emptyTitle}
            message={filtering ? strings.emptyFilteredMessage : strings.emptyMessage}
          />
          {filtering && !exhausted && (
            <div className="flex justify-center">
              <Button
                kind="tertiary"
                size="md"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {isLoadingMore ? strings.loadingMore : strings.loadMore}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="ally-threads-table">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.course}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.organisation}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.mode}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.status}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.turns}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.cost}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.crises}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.updated}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map(row => {
                  const title = row.trackTitle ?? strings.untitledCourse;
                  return (
                    <TableRow
                      key={row.id}
                      onClick={() => open(row.id)}
                      className="cursor-pointer border-b border-border-light align-top text-sm text-typography-900 hover:bg-background-secondary"
                      data-testid="thread-row"
                    >
                      <TableCell className="py-3 pr-4">
                        {/* A real button, so the row opens from the keyboard; the row's own click is a convenience. */}
                        <button
                          type="button"
                          className="text-left font-medium text-primary-500 hover:underline"
                          aria-label={strings.open(title)}
                          onClick={event => {
                            event.stopPropagation();
                            open(row.id);
                          }}
                        >
                          {title}
                        </button>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-typography-700">
                            {row.id.slice(0, 8)}
                          </span>
                          {row.arm === "canary" && (
                            <Pill tone="info" title={strings.canaryHelp}>
                              {strings.canary}
                            </Pill>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{organisationText(row)}</span>
                          {row.visitor && (
                            <Pill tone="neutral" title={strings.visitorHelp}>
                              {strings.visitor}
                            </Pill>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <Pill tone={modeTone(row.mode)}>
                          {en.allyConsole.modes[row.mode] ?? row.mode}
                        </Pill>
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        {en.allyConsole.threadStatuses[row.status] ?? row.status}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {formatCount(row.turns)}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {formatUsd(row.costUsd)}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {row.crises > 0 ? <Pill tone="danger">{row.crises}</Pill> : 0}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap py-3 pr-4"
                        title={formatTimestamp(row.updatedAt)}
                      >
                        {formatRelativeTime(row.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light pt-3">
            <span className="text-sm text-typography-700" data-testid="threads-footer">
              {strings.footer(visible.length)}
              {multiFacet ? ` · ${strings.filterHint}` : ""}
            </span>
            {exhausted ? (
              <span className="text-sm text-typography-700">{strings.noMore}</span>
            ) : (
              <Button
                kind="tertiary"
                size="md"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {isLoadingMore ? strings.loadingMore : strings.loadMore}
              </Button>
            )}
          </div>
        </>
      )}

      <TurnInspector threadId={selectedId} thread={selectedRow ?? linkedRow} onClose={close} />
    </div>
  );
};
