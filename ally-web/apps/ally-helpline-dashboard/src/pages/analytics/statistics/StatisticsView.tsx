import { FunctionComponent, ReactNode, useEffect, useMemo, useState } from "react";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";

import { ToggleButtonGroup } from "@components";
import { OrganizationMetricsRange, ORGANIZATION_METRICS_RANGES } from "@types";
import type {
  StatisticsChartEntry,
  StatisticsFilterKey,
  StatisticsFilterValues,
  StatisticsViewConfig,
} from "@types";

import { SortableMetricBlock } from "../SortableMetricBlock";
import { ChartHost } from "./ChartHost";
import {
  LayoutItem,
  insertIntoSection,
  layoutKey,
  parseLayoutKey,
  sectionRuns,
  viewChartIds,
} from "./layout";
import { LibraryDrawer } from "./LibraryDrawer";
import { CHART_RENDERERS, DashboardContext } from "./renderers";
import { SubjectSelector } from "./SubjectSelector";

interface StatisticsViewProps {
  view: StatisticsViewConfig;
  /** Every chart the backend offers this tenant. */
  charts: readonly StatisticsChartEntry[];
  range: OrganizationMetricsRange;
  onRangeChange: (range: OrganizationMetricsRange) => void;
  /** The card keys to draw, in order, already resolved from the saved layout and the defaults. */
  layoutKeys: readonly string[];
  /** Saves a new layout. */
  onLayoutChange: (keys: string[]) => void;
  /** The course or learner the tab is about, when it has one. */
  subjectId?: string;
  onSubjectChange: (id: string) => void;
  /** Chart ids pinned to For you, and the pin or unpin of a card. */
  pinnedIds: ReadonlySet<string>;
  onTogglePin: (chartId: string, key: string) => void;
  /** A chart to bring into view when the tab opens, from a link. */
  focusChart?: string;
}

/**
 * One chart tab: Organisation, Course or Learner. The same component for all
 * three: what differs is the view's configuration (its sections, and whether it
 * asks for a course or a learner). The layout is the person's own, arranged by
 * drag and drop while customising, with a library of that tab's charts beside it.
 */
export const StatisticsView: FunctionComponent<StatisticsViewProps> = ({
  view,
  charts,
  range,
  onRangeChange,
  layoutKeys,
  onLayoutChange,
  subjectId,
  onSubjectChange,
  pinnedIds,
  onTogglePin,
  focusChart,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const byId = useMemo(() => new Map(charts.map(c => [c.id, c])), [charts]);
  const listed = useMemo(() => new Set(viewChartIds(view)), [view]);

  // Each card is a chart id with the filters set on it. A chart appears once.
  // A chart a link points at is shown even if the person has not put it on this tab.
  const shownKeys = focusChart ? insertIntoSection(view, layoutKeys, focusChart) : layoutKeys;
  const items = shownKeys
    .map(parseLayoutKey)
    .filter(
      (item): item is LayoutItem =>
        !!item && byId.has(item.id) && listed.has(item.id) && !!CHART_RENDERERS[item.id],
    );
  const ids = items.map(item => item.id);
  const keys = items.map(item => item.key);
  const runs = sectionRuns(view, items);

  // A link from For you names a chart: bring its card into view once the tab has drawn.
  useEffect(() => {
    if (!focusChart) return;
    document
      .querySelector(`[data-testid="statistics-card-${focusChart}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusChart, subjectId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onLayoutChange(arrayMove(keys, from, to));
  };
  const handleRemove = (id: string) =>
    onLayoutChange(items.filter(item => item.id !== id).map(item => item.key));
  const handleAdd = (id: string) => {
    if (!ids.includes(id)) onLayoutChange([...keys, id]);
  };
  const handleFiltersChange = (id: string, filters: StatisticsFilterValues) =>
    onLayoutChange(items.map(item => (item.id === id ? layoutKey(id, filters) : item.key)));

  const rangeOptions = useMemo(
    () =>
      ORGANIZATION_METRICS_RANGES.map(value => ({
        value,
        label: t(`organizationMetrics.ranges.${value}`),
      })),
    [t],
  );

  const libraryEntries = view.sections.flatMap(section =>
    section.charts
      .map(id => byId.get(id))
      .filter((chart): chart is StatisticsChartEntry => !!chart && !!CHART_RENDERERS[chart.id])
      .map(chart => ({ chart, group: section.key })),
  );
  const libraryGroups = [...new Set(view.sections.map(s => s.key))].map(key => ({
    key,
    label: t(`statisticsLibrary.sections.${key}`),
  }));

  const subjectKind = view.subject;
  const needsSubject = !!subjectKind && !subjectId;
  const gridClass = "grid grid-cols-1 xl:grid-cols-2 gap-4 grid-flow-row-dense";
  const spanClass = (entry: StatisticsChartEntry) => (entry.size === "wide" ? "xl:col-span-2" : "");

  /** One card: the chart, with the view's subject supplied and not offered again on the card. */
  const card = (item: LayoutItem, subject: boolean): ReactNode => {
    const entry = byId.get(item.id) as StatisticsChartEntry;
    const locked: StatisticsFilterKey[] | undefined =
      subject && subjectKind ? [subjectKind] : undefined;
    const filters: StatisticsFilterValues =
      subject && subjectKind && subjectId
        ? { ...item.filters, [subjectKind]: subjectId }
        : item.filters;
    return (
      <ChartHost
        entry={entry}
        range={range}
        filters={filters}
        lockedFilters={locked}
        onFiltersChange={next => {
          const rest = { ...next };
          if (locked) delete rest[locked[0]];
          handleFiltersChange(item.id, rest);
        }}
        pinned={pinnedIds.has(item.id)}
        onTogglePin={editing ? undefined : () => onTogglePin(item.id, layoutKey(item.id, filters))}
      />
    );
  };

  /** The card of a subject section while no subject is chosen: only drawn while customising. */
  const placeholder = (item: LayoutItem): ReactNode => (
    <div className="rounded-xl border border-dashed border-border-light bg-white p-5 text-sm text-typography-600">
      {(byId.get(item.id) as StatisticsChartEntry).question}
    </div>
  );

  const content = (
    <div className={gridClass} data-testid="statistics-grid">
      {runs.map((run, index) => {
        const showCards = !run.subject || !needsSubject || editing;
        const firstSubjectRun = run.subject && !runs.slice(0, index).some(r => r.subject);
        return (
          <div key={`${run.section}-${index}`} className="contents">
            {firstSubjectRun && subjectKind && runs.slice(0, index).some(r => !r.subject) && (
              <h2
                className="col-span-full mt-2 border-t border-[#cfc9bb] pt-4 font-secondary text-2xl font-medium text-typography-900 xl:col-span-2"
                data-testid="statistics-subject-heading"
              >
                {t(`statisticsLibrary.subject.heading.${subjectKind}`)}
              </h2>
            )}
            {showCards && (
              <h2
                className="col-span-full mt-2 font-secondary text-xl font-medium text-typography-900 xl:col-span-2"
                data-testid={`statistics-section-${run.section}`}
              >
                {t(`statisticsLibrary.sections.${run.section}`)}
              </h2>
            )}
            {run.subject && needsSubject && !editing && firstSubjectRun && (
              <p
                className="col-span-full rounded border border-dashed border-border-light p-6 text-sm text-typography-600 xl:col-span-2"
                data-testid="statistics-choose-subject"
              >
                {t(`statisticsLibrary.subject.pick.${subjectKind}`)}
              </p>
            )}
            {showCards &&
              run.items.map(item => {
                const entry = byId.get(item.id) as StatisticsChartEntry;
                const body =
                  run.subject && needsSubject ? placeholder(item) : card(item, run.subject);
                return editing ? (
                  <SortableMetricBlock key={item.id} id={item.id} wide={entry.size === "wide"}>
                    <div className="rounded border-2 border-dashed border-[#9db5dd]">
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        aria-label={t("statisticsLibrary.removeAria", { title: entry.title })}
                        className="absolute right-10 top-2 z-10 flex h-6 w-6 items-center justify-center rounded text-typography-500 hover:bg-background-secondary hover:text-typography-900"
                        data-testid={`statistics-remove-${item.id}`}
                      >
                        &times;
                      </button>
                      {body}
                    </div>
                  </SortableMetricBlock>
                ) : (
                  <div key={item.id} className={spanClass(entry)}>
                    {body}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );

  return (
    <DashboardContext.Provider value={{ learnerTableOnPage: ids.includes("TSQ-009") }}>
      <div className="flex flex-col gap-4 py-4" data-testid={`statistics-view-${view.id}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-4">
            {subjectKind && (
              <SubjectSelector kind={subjectKind} value={subjectId} onChange={onSubjectChange} />
            )}
            <ToggleButtonGroup
              data-testid="statistics-range-toggle"
              value={range}
              onValueChange={value => onRangeChange(value as OrganizationMetricsRange)}
              items={rangeOptions}
            />
          </div>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-11 rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white"
              data-testid="statistics-done"
            >
              {t("statisticsLibrary.done")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
              data-testid="statistics-customise"
            >
              {t("statisticsLibrary.customise")}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            {items.length === 0 ? (
              <p
                className="rounded border border-dashed border-border-light p-6 text-sm text-typography-600"
                data-testid="statistics-empty"
              >
                {t("statisticsLibrary.emptyDashboard")}
              </p>
            ) : editing ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  {content}
                </SortableContext>
              </DndContext>
            ) : (
              content
            )}
          </div>

          {/* The library stays open for as long as the tab is being customised. */}
          {editing && (
            <LibraryDrawer
              mode="add"
              entries={libraryEntries}
              groups={libraryGroups}
              addedIds={ids}
              onAdd={handleAdd}
            />
          )}
        </div>
      </div>
    </DashboardContext.Provider>
  );
};
