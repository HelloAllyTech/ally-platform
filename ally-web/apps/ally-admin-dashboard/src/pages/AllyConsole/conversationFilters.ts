import {
  AllyGuideMode,
  AllyGuideThreadRow,
  AllyGuideThreadsQuery,
  AllyGuideThreadStatus,
} from "@types";

/** Rows per request; the server's default, and a screenful the Ally team can scan. */
export const THREADS_PAGE_SIZE = 25;

export interface ThreadFilters {
  tenantIds: string[];
  modes: AllyGuideMode[];
  statuses: AllyGuideThreadStatus[];
}

export const EMPTY_THREAD_FILTERS: ThreadFilters = { tenantIds: [], modes: [], statuses: [] };

export const hasActiveThreadFilters = (filters: ThreadFilters, search: string): boolean =>
  filters.tenantIds.length > 0 ||
  filters.modes.length > 0 ||
  filters.statuses.length > 0 ||
  search.trim().length > 0;

/**
 * The part of the filters the server can apply.
 *
 * `GET threads` takes ONE tenantId, ONE mode and ONE status, but the filter popover is a
 * multi-select like the rest of the admin. Exactly one chosen value goes to the server, which
 * narrows the cursor pagination for real; with two or more chosen the server is left unfiltered on
 * that facet and `matchesThreadFilters` does the work on the rows that arrive. Either way the client
 * check runs, so the result never depends on which path was taken.
 */
export const serverQueryFor = (
  filters: ThreadFilters,
): Pick<AllyGuideThreadsQuery, "tenantId" | "mode" | "status"> => ({
  tenantId: filters.tenantIds.length === 1 ? filters.tenantIds[0] : undefined,
  mode: filters.modes.length === 1 ? filters.modes[0] : undefined,
  status: filters.statuses.length === 1 ? filters.statuses[0] : undefined,
});

/** A stable key for "which server query is this", so a change of facet reloads from the top. */
export const serverQueryKey = (filters: ThreadFilters): string => {
  const { tenantId, mode, status } = serverQueryFor(filters);
  return `${tenantId ?? ""}|${mode ?? ""}|${status ?? ""}`;
};

/**
 * Whether a row passes the filters and the search box. Search is a plain substring match on what the
 * list shows: the course title, the organisation's name and the conversation id.
 */
export const matchesThreadFilters = (
  row: AllyGuideThreadRow,
  filters: ThreadFilters,
  search: string,
): boolean => {
  if (filters.tenantIds.length > 0 && !(row.tenantId && filters.tenantIds.includes(row.tenantId))) {
    return false;
  }
  if (filters.modes.length > 0 && !filters.modes.includes(row.mode)) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) return false;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [row.trackTitle ?? "", row.id, row.tenantName ?? ""].join("\n").toLowerCase();
  return haystack.includes(needle);
};

/**
 * Organisations to offer in the Filter popover: the full list when it could be read, plus any
 * organisation seen on a loaded row, so a name is never missing from the filter for a row that is
 * on screen. First seen wins, names come from the rows or the list, and the result is sorted by name.
 */
export const organisationOptions = (
  listed: { id: string; name: string }[],
  rows: AllyGuideThreadRow[],
): { value: string; label: string }[] => {
  const byId = new Map<string, string>();
  for (const tenant of listed) byId.set(tenant.id, tenant.name);
  for (const row of rows) {
    if (row.tenantId && !byId.has(row.tenantId)) {
      byId.set(row.tenantId, row.tenantName ?? row.tenantId.slice(0, 8));
    }
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
};
