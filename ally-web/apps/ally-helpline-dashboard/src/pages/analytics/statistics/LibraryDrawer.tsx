import { FunctionComponent, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import type { StatisticsChartEntry } from "@types";

/** A chart in the library and the group it is listed under (a section of the tab, or a tab). */
export interface LibraryEntry {
  chart: StatisticsChartEntry;
  group: string;
}

export interface LibraryGroup {
  key: string;
  label: string;
}

interface LibraryDrawerProps {
  /** `add`: charts for a tab. `pin`: charts to pin to For you. */
  mode: "add" | "pin";
  /** The charts to list, in the order to show them. */
  entries: readonly LibraryEntry[];
  /** The chips that filter the list, in order. Only groups with a chart are shown. */
  groups: readonly LibraryGroup[];
  /** Ids already on the tab (or pinned). */
  addedIds: readonly string[];
  onAdd: (id: string) => void;
}

/**
 * The chart library for the tab being customised: its charts, with whether the
 * organisation can fill each. A chart it has no data for stays listed but
 * greyed, with the reason. On For you the same drawer lists what can be pinned.
 */
export const LibraryDrawer: FunctionComponent<LibraryDrawerProps> = ({
  mode,
  entries,
  groups,
  addedIds,
  onAdd,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const prefix = mode === "pin" ? "statisticsLibrary.pins" : "statisticsLibrary.library";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      ({ chart, group: g }) =>
        (group === "all" || g === group) &&
        (q === "" || `${chart.title} ${chart.question}`.toLowerCase().includes(q)),
    );
  }, [entries, group, query]);

  const present = groups.filter(g => entries.some(e => e.group === g.key));
  const added = new Set(addedIds);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col overflow-hidden rounded-none border-l border-border-light bg-white shadow-2xl xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:w-[420px] xl:flex-none xl:rounded xl:border xl:shadow-none"
      aria-label={t(`${prefix}.title`)}
      data-testid="statistics-library-drawer"
    >
      <div className="flex flex-none flex-col gap-3 border-b border-border-light p-4">
        <h2 className="text-xl font-medium text-typography-900">{t(`${prefix}.title`)}</h2>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={t("statisticsLibrary.library.search")}
          placeholder={t("statisticsLibrary.library.searchPlaceholder")}
          className="min-h-11 rounded border border-border-light px-3 text-sm text-typography-900"
          data-testid="statistics-library-search"
        />
        {present.length > 1 && (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("statisticsLibrary.library.filterByGroup")}
          >
            {[{ key: "all", label: t("statisticsLibrary.library.groups.all") }, ...present].map(
              g => (
                <button
                  key={g.key}
                  type="button"
                  aria-pressed={group === g.key}
                  onClick={() => setGroup(g.key)}
                  className={`min-h-9 rounded-full border px-3 text-sm ${
                    group === g.key
                      ? "border-[#264d8e] bg-[#264d8e] text-white"
                      : "border-border-light bg-white text-typography-900"
                  }`}
                  data-testid={`statistics-library-group-${g.key}`}
                >
                  {g.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <ul
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
        data-testid="statistics-library-list"
      >
        {visible.length === 0 && (
          <li className="py-6 text-sm text-typography-600">
            {t("statisticsLibrary.library.noResults")}
          </li>
        )}
        {visible.map(({ chart }) => {
          const isAdded = added.has(chart.id);
          const unavailable = chart.state === "unavailable";
          return (
            <li
              key={chart.id}
              className={`flex gap-3 border-b border-border-light py-4 ${unavailable ? "opacity-80" : ""}`}
              data-testid={`statistics-library-item-${chart.id}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-semibold text-typography-900">{chart.title}</span>
                <span className="text-sm text-typography-600">{chart.question}</span>
                {unavailable && chart.reason && (
                  <span className="text-xs font-medium text-typography-600">{chart.reason}</span>
                )}
              </div>
              <button
                type="button"
                disabled={unavailable || isAdded}
                onClick={() => onAdd(chart.id)}
                aria-label={t(`${prefix}.addAria`, { title: chart.title })}
                className={`min-h-11 min-w-[76px] self-center rounded border px-3 text-sm font-medium ${
                  isAdded
                    ? "border-[#b7d9c4] bg-white text-[#1e6b3a]"
                    : unavailable
                      ? "cursor-not-allowed border-border-light bg-background-secondary text-typography-600"
                      : "border-[#264d8e] bg-[#264d8e] text-white"
                }`}
                data-testid={`statistics-library-add-${chart.id}`}
              >
                {isAdded
                  ? t(`${prefix}.added`)
                  : unavailable
                    ? t("statisticsLibrary.library.unavailable")
                    : t(`${prefix}.add`)}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
