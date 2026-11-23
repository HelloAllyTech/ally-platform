import { FunctionComponent, useMemo, useState } from "react";

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
import { toast } from "sonner";

import { SkeletonText, logger } from "@ally-ui-mono/ui-shared";
import { useGetUserPreferencesQuery, useUpdateUserPreferencesMutation } from "@api";
import { ToggleButtonGroup } from "@components";
import { OrganizationMetricsRange, ORGANIZATION_METRICS_RANGES } from "@types";
import type { StatisticsChartEntry } from "@types";

import { SortableMetricBlock } from "../SortableMetricBlock";
import { ChartHost } from "./ChartHost";
import {
  LayoutItem,
  LayoutScope,
  STATISTICS_LAYOUT_PREF_KEY,
  layoutKey,
  parseLayoutKey,
  resolveDashboardLayout,
} from "./layout";
import { LibraryDrawer } from "./LibraryDrawer";
import { CHART_RENDERERS, DashboardContext } from "./renderers";

interface StatisticsDashboardProps {
  /** Every chart the backend offers this tenant, each with its availability. */
  charts: readonly StatisticsChartEntry[];
}

/**
 * The tenant admin's Statistics dashboard: a layout of charts they chose from
 * the library, arranged by drag and drop.
 *
 * Replaces the fixed Organization Metrics view for tenants the page is switched
 * on for (`tenants.settings.statisticsDashboard.enabled`). The layout is saved
 * per user in the preferences store; nothing saved means the default layout.
 */
export const StatisticsDashboard: FunctionComponent<StatisticsDashboardProps> = ({ charts }) => {
  const { t } = useTranslation();
  const [range, setRange] = useState<OrganizationMetricsRange>("90d");
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: preferences, isLoading: preferencesLoading } = useGetUserPreferencesQuery();
  const [updateUserPreferences] = useUpdateUserPreferencesMutation();

  // The layout this session has changed, which wins over the saved one until
  // the page reloads and reads the save back. Not derived from the preferences
  // query alone: it answers null for a user with no preferences row yet, so
  // there is no cache entry for an optimistic patch to write into.
  const [localLayout, setLocalLayout] = useState<string[] | null>(null);
  const saved = preferences?.data?.[STATISTICS_LAYOUT_PREF_KEY];
  const layoutIds = useMemo(
    () => localLayout ?? resolveDashboardLayout(saved, charts),
    [localLayout, saved, charts],
  );

  const byId = useMemo(() => new Map(charts.map(c => [c.id, c])), [charts]);
  // Each card is a layout key: a chart id, or a chart id with the course,
  // simulation or learner it is drawn for. The same chart can appear more than once.
  const items = layoutIds
    .map(parseLayoutKey)
    .filter(
      (item): item is LayoutItem => !!item && !!byId.get(item.id) && !!CHART_RENDERERS[item.id],
    );
  const entryKeys = items.map(item => item.key);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Applies a new layout at once, saves in the background, and rolls back with a toast on failure. */
  const persist = async (next: string[]) => {
    const previous = localLayout;
    setLocalLayout(next);
    try {
      await updateUserPreferences({ [STATISTICS_LAYOUT_PREF_KEY]: next }).unwrap();
    } catch (error) {
      setLocalLayout(previous);
      toast.error(t("statisticsLibrary.saveFailed"));
      logger.info(`Failed to save statistics layout: ${error}`);
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = entryKeys.indexOf(String(active.id));
    const newIndex = entryKeys.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    persist(arrayMove(entryKeys, oldIndex, newIndex));
  };

  const handleRemove = (key: string) => persist(entryKeys.filter(x => x !== key));
  const handleAdd = (id: string, scope?: LayoutScope) => {
    const key = layoutKey(id, scope);
    if (!entryKeys.includes(key)) persist([...entryKeys, key]);
  };
  /** Points a card at a different course, simulation or learner, keeping its place. */
  const handleScopeChange = (oldKey: string, id: string, scope: LayoutScope) => {
    const key = layoutKey(id, scope);
    if (key === oldKey || entryKeys.includes(key)) return;
    persist(entryKeys.map(k => (k === oldKey ? key : k)));
  };

  const finishEditing = () => {
    setEditing(false);
    setDrawerOpen(false);
  };

  const rangeOptions = useMemo(
    () =>
      ORGANIZATION_METRICS_RANGES.map(value => ({
        value,
        label: t(`organizationMetrics.ranges.${value}`),
      })),
    [t],
  );

  if (preferencesLoading) {
    return (
      <div className="py-4" data-testid="statistics-dashboard-loading">
        <SkeletonText heading width="240px" />
      </div>
    );
  }

  const gridClass = "grid grid-cols-1 xl:grid-cols-2 gap-4 grid-flow-row-dense";
  const spanClass = (e: StatisticsChartEntry) => (e.size === "wide" ? "xl:col-span-2" : "");

  return (
    <DashboardContext.Provider value={{ learnerTableOnPage: entryKeys.includes("TSQ-009") }}>
      <div className="flex flex-col gap-4 py-4" data-testid="statistics-dashboard">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm text-typography-600">{t("statisticsLibrary.tagline")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleButtonGroup
              data-testid="statistics-range-toggle"
              value={range}
              onValueChange={value => setRange(value as OrganizationMetricsRange)}
              items={rangeOptions}
            />
            {editing ? (
              <>
                {!drawerOpen && (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
                    data-testid="statistics-add-charts"
                  >
                    {t("statisticsLibrary.addCharts")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={finishEditing}
                  className="min-h-11 rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white"
                  data-testid="statistics-done"
                >
                  {t("statisticsLibrary.done")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  // Customising opens the chart library straight away.
                  setEditing(true);
                  setDrawerOpen(true);
                }}
                className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
                data-testid="statistics-customise"
              >
                {t("statisticsLibrary.customise")}
              </button>
            )}
          </div>
        </div>

        {editing && (
          <p
            className="rounded bg-[#dce6f6] px-4 py-3 text-sm text-[#1c3a6e]"
            role="status"
            data-testid="statistics-customise-hint"
          >
            {t("statisticsLibrary.customiseHint")}
          </p>
        )}

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
                <SortableContext items={entryKeys} strategy={rectSortingStrategy}>
                  <div className={gridClass} data-testid="statistics-grid">
                    {items.map(item => {
                      const entry = byId.get(item.id) as StatisticsChartEntry;
                      return (
                        <SortableMetricBlock
                          key={item.key}
                          id={item.key}
                          wide={entry.size === "wide"}
                        >
                          <div className="rounded border-2 border-dashed border-[#9db5dd]">
                            <button
                              type="button"
                              onClick={() => handleRemove(item.key)}
                              aria-label={t("statisticsLibrary.removeAria", { title: entry.title })}
                              className="absolute right-10 top-2 z-10 flex h-6 w-6 items-center justify-center rounded text-typography-500 hover:bg-background-secondary hover:text-typography-900"
                              data-testid={`statistics-remove-${item.key}`}
                            >
                              &times;
                            </button>
                            <ChartHost
                              entry={entry}
                              range={range}
                              scope={item.scope}
                              onScopeChange={scope => handleScopeChange(item.key, item.id, scope)}
                            />
                          </div>
                        </SortableMetricBlock>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className={gridClass} data-testid="statistics-grid">
                {items.map(item => {
                  const entry = byId.get(item.id) as StatisticsChartEntry;
                  return (
                    <div key={item.key} className={spanClass(entry)}>
                      <ChartHost entry={entry} range={range} scope={item.scope} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {editing && drawerOpen && (
            <LibraryDrawer
              charts={charts}
              addedIds={items.filter(i => !i.scope).map(i => i.id)}
              onAdd={handleAdd}
              onClose={() => setDrawerOpen(false)}
            />
          )}
        </div>
      </div>
    </DashboardContext.Provider>
  );
};
