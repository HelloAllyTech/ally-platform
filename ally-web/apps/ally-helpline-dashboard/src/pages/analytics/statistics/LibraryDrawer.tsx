import { FunctionComponent, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import type { StatisticsChartEntry, StatisticsChartGroup } from "@types";

import { CHART_RENDERERS } from "./renderers";

interface LibraryDrawerProps {
  /** Every chart the backend offers this tenant. */
  charts: readonly StatisticsChartEntry[];
  /** Ids already on the dashboard for the whole organisation. */
  addedIds: readonly string[];
  /** Adds a chart to the dashboard. */
  onAdd: (id: string) => void;
}

const GROUP_ORDER: StatisticsChartGroup[] = [
  "activity",
  "learners",
  "courses",
  "outcomes",
  "learner_voice",
  "reviews",
];

const GROUP_LABEL_KEY: Record<StatisticsChartGroup, string> = {
  activity: "activity",
  learners: "learners",
  courses: "courses",
  outcomes: "outcomes",
  learner_voice: "learnerVoice",
  reviews: "reviews",
};

/**
 * The chart library: every chart this organisation may add, with whether it can
 * fill it. Charts it has no data for stay listed but greyed, with the reason,
 * so the admin sees what exists and why it is not available yet.
 */
export const LibraryDrawer: FunctionComponent<LibraryDrawerProps> = ({
  charts,
  addedIds,
  onAdd,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<StatisticsChartGroup | "all">("all");
  // Only charts this build can draw are offered. A chart that needs a filter is
  // offered too: it asks for the choice on its card.
  const offered = useMemo(() => charts.filter(c => CHART_RENDERERS[c.id]), [charts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return offered.filter(
      c =>
        (group === "all" || c.group === group) &&
        (q === "" || `${c.title} ${c.question}`.toLowerCase().includes(q)),
    );
  }, [offered, group, query]);

  const groups = GROUP_ORDER.filter(g => offered.some(c => c.group === g));
  const added = new Set(addedIds);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col overflow-hidden rounded-none border-l border-border-light bg-white shadow-2xl xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:w-[420px] xl:flex-none xl:rounded xl:border xl:shadow-none"
      aria-label={t("statisticsLibrary.library.title")}
      data-testid="statistics-library-drawer"
    >
      <div className="flex flex-none flex-col gap-3 border-b border-border-light p-4">
        <h2 className="text-xl font-medium text-typography-900">
          {t("statisticsLibrary.library.title")}
        </h2>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={t("statisticsLibrary.library.search")}
          placeholder={t("statisticsLibrary.library.searchPlaceholder")}
          className="min-h-11 rounded border border-border-light px-3 text-sm text-typography-900"
          data-testid="statistics-library-search"
        />
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("statisticsLibrary.library.filterByGroup")}
        >
          {(["all", ...groups] as const).map(g => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className={`min-h-9 rounded-full border px-3 text-sm ${
                group === g
                  ? "border-[#264d8e] bg-[#264d8e] text-white"
                  : "border-border-light bg-white text-typography-900"
              }`}
              data-testid={`statistics-library-group-${g}`}
            >
              {g === "all"
                ? t("statisticsLibrary.library.groups.all")
                : t(`statisticsLibrary.library.groups.${GROUP_LABEL_KEY[g]}`)}
            </button>
          ))}
        </div>
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
        {visible.map(chart => {
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
                aria-label={t("statisticsLibrary.library.addAria", { title: chart.title })}
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
                  ? t("statisticsLibrary.library.added")
                  : unavailable
                    ? t("statisticsLibrary.library.unavailable")
                    : t("statisticsLibrary.library.add")}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
