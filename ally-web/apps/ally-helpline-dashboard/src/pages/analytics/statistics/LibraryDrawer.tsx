import { FunctionComponent, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import type { StatisticsChartEntry, StatisticsChartGroup, StatisticsScopeKind } from "@types";

import { LayoutScope } from "./layout";
import { CHART_RENDERERS } from "./renderers";
import { ScopeChooser } from "./ScopeChooser";

interface LibraryDrawerProps {
  /** Every chart the backend offers this tenant. */
  charts: readonly StatisticsChartEntry[];
  /** Ids already on the dashboard for the whole organisation. */
  addedIds: readonly string[];
  /** Adds a chart, for the whole organisation or for one course, simulation or learner. */
  onAdd: (id: string, scope?: LayoutScope) => void;
  onClose: () => void;
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
  onClose,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<StatisticsChartGroup | "all">("all");
  // The chart being added for a course, simulation or learner, until one is chosen.
  const [choosing, setChoosing] = useState<{
    chart: StatisticsChartEntry;
    kind: StatisticsScopeKind;
  } | null>(null);

  // Only charts this build can draw are offered.
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
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col overflow-y-auto rounded-none border-l border-border-light bg-white shadow-2xl xl:static xl:z-auto xl:w-[420px] xl:flex-none xl:overflow-visible xl:rounded xl:border xl:shadow-none"
      aria-label={t("statisticsLibrary.library.title")}
      data-testid="statistics-library-drawer"
    >
      <div className="flex flex-col gap-3 border-b border-border-light p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium text-typography-900">
            {t("statisticsLibrary.library.title")}
          </h2>
          <button
            type="button"
            aria-label={t("statisticsLibrary.library.close")}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center text-xl text-typography-600"
            data-testid="statistics-library-close"
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-typography-600">{t("statisticsLibrary.library.description")}</p>
        <label className="flex flex-col gap-1 text-xs text-typography-600">
          {t("statisticsLibrary.library.search")}
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("statisticsLibrary.library.searchPlaceholder")}
            className="min-h-11 rounded border border-border-light px-3 text-sm text-typography-900"
            data-testid="statistics-library-search"
          />
        </label>
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

      {choosing && (
        <div className="flex flex-col gap-3 border-b border-border-light p-4">
          <h3 className="text-sm font-semibold text-typography-900">
            {t(`statisticsLibrary.scope.choose.${choosing.kind}`, { title: choosing.chart.title })}
          </h3>
          <ScopeChooser
            kind={choosing.kind}
            onCancel={() => setChoosing(null)}
            onPick={option => {
              onAdd(choosing.chart.id, { kind: choosing.kind, value: option.id });
              setChoosing(null);
            }}
          />
        </div>
      )}

      <ul className="flex flex-col px-4" data-testid="statistics-library-list">
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
                {chart.state === "sparse" && (
                  <span className="text-xs font-medium text-[#6b4506]">
                    {t("statisticsLibrary.library.countsOnly")}
                  </span>
                )}
                {unavailable && chart.reason && (
                  <span className="text-xs font-medium text-typography-600">{chart.reason}</span>
                )}
                {!unavailable && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {chart.scopes
                      .filter((k): k is StatisticsScopeKind => k !== "organisation")
                      .map(kind => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setChoosing({ chart, kind })}
                          className="min-h-9 rounded-full border border-[#264d8e] bg-white px-3 text-xs font-medium text-[#264d8e]"
                          data-testid={`statistics-library-add-${chart.id}-${kind}`}
                        >
                          {t(`statisticsLibrary.scope.addFor.${kind}`)}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {chart.scopes.includes("organisation") && (
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
              )}
            </li>
          );
        })}
      </ul>

      <p className="border-t border-border-light bg-background-secondary p-4 text-sm text-typography-700">
        {t("statisticsLibrary.library.contactTeam")}
      </p>
    </aside>
  );
};
