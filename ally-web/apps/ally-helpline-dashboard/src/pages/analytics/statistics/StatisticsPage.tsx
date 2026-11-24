import { FunctionComponent, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { SkeletonText, logger } from "@ally-ui-mono/ui-shared";
import { useGetUserPreferencesQuery, useUpdateUserPreferencesMutation } from "@api";
import type {
  OrganizationMetricsRange,
  StatisticsChartLibrary,
  StatisticsFilterKey,
  StatisticsInsight,
  StatisticsViewConfig,
  StatisticsViewId,
} from "@types";

import { ForYouView } from "./ForYouView";
import {
  LayoutItem,
  SavedLayouts,
  STATISTICS_LAYOUTS_PREF_KEY,
  STATISTICS_SUBJECTS_PREF_KEY,
  StatisticsLayoutKey,
  resolvePins,
  groupBySection,
  isLegacyLayout,
  resolveViewLayout,
  savedLayoutFor,
  viewChartIds,
} from "./layout";
import { CHART_RENDERERS } from "./renderers";
import { StatisticsView } from "./StatisticsView";

type TabId = "foryou" | StatisticsViewId;

const TAB_ORDER: TabId[] = ["foryou", "organisation", "course", "learner"];
const MAX_PINS = 12;

/** Whether a chart can be drawn as a pinned card. */
const canPin = (chartId: string): boolean => {
  const renderer = CHART_RENDERERS[chartId];
  return !!renderer && renderer.kind === "data" && !!renderer.pin;
};

interface StatisticsPageProps {
  library: StatisticsChartLibrary;
}

/**
 * The Statistics page for a tenant it is switched on for: For you, Organisation,
 * Course and Learner. Owns what is saved for the person (a layout per tab, their
 * pins, the course and learner last chosen) and what the address says (the tab
 * and the subject), so a link opens the right tab on the right course.
 */
export const StatisticsPage: FunctionComponent<StatisticsPageProps> = ({ library }) => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<OrganizationMetricsRange>("90d");
  const { data: preferences, isLoading } = useGetUserPreferencesQuery();
  const [updateUserPreferences] = useUpdateUserPreferencesMutation();

  const views = library.views ?? [];
  const charts = library.charts;
  const prefs = preferences?.data as Record<string, unknown> | null | undefined;

  // What this session has changed wins over what was saved until the page is
  // reloaded and reads the save back. Not derived from the preferences query
  // alone: it answers null for a person with no preferences yet, so there is no
  // cache entry for an optimistic update to write into.
  const [localLayouts, setLocalLayouts] = useState<SavedLayouts>({});
  const [localSubjects, setLocalSubjects] = useState<Record<string, string>>({});

  const savedLayouts = (prefs?.[STATISTICS_LAYOUTS_PREF_KEY] ?? {}) as SavedLayouts;
  const savedSubjects = (prefs?.[STATISTICS_SUBJECTS_PREF_KEY] ?? {}) as Record<string, string>;
  const savedFor = (tab: StatisticsLayoutKey) => localLayouts[tab] ?? savedLayoutFor(prefs, tab);

  const pinKeys = useMemo(
    () => resolvePins(localLayouts.pins ?? savedLayoutFor(prefs, "pins"), charts, canPin),
    [localLayouts.pins, prefs, charts],
  );

  const tabs = TAB_ORDER.filter(id => id === "foryou" || views.some(v => v.id === id));
  const requested = params.get("tab") as TabId | null;
  const tab: TabId =
    requested && tabs.includes(requested)
      ? requested
      : pinKeys.length > 0
        ? "foryou"
        : "organisation";

  const subjectFor = (kind: StatisticsFilterKey): string | undefined =>
    params.get(kind) ?? localSubjects[kind] ?? savedSubjects[kind];

  const selectTab = (next: TabId) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    // The subject belongs to the tab it was chosen on; it is remembered in preferences.
    nextParams.delete("course");
    nextParams.delete("learner");
    nextParams.delete("chart");
    setParams(nextParams, { replace: true });
  };

  /** Saves a tab's layout. The whole object is sent: the preferences merge keys, not what is inside them. */
  const persistLayout = async (key: StatisticsLayoutKey, keys: string[]) => {
    const previous = localLayouts;
    const base: SavedLayouts = { ...savedLayouts, ...localLayouts };
    setLocalLayouts({ ...localLayouts, [key]: keys });
    try {
      await updateUserPreferences({
        [STATISTICS_LAYOUTS_PREF_KEY]: { ...base, [key]: keys },
      }).unwrap();
    } catch (error) {
      setLocalLayouts(previous);
      toast.error(t("statisticsLibrary.saveFailed"));
      logger.info(`Failed to save statistics layout: ${error}`);
    }
  };

  const chooseSubject = (kind: StatisticsFilterKey, id: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set(kind, id);
    setParams(nextParams, { replace: true });
    setLocalSubjects(current => ({ ...current, [kind]: id }));
    updateUserPreferences({
      [STATISTICS_SUBJECTS_PREF_KEY]: { ...savedSubjects, ...localSubjects, [kind]: id },
    })
      .unwrap()
      .catch(error => logger.info(`Failed to save statistics subject: ${error}`));
  };

  const togglePin = (chartId: string, key: string) => {
    const pinned = pinKeys.some(k => k.split("?")[0] === chartId);
    if (pinned)
      persistLayout(
        "pins",
        pinKeys.filter(k => k.split("?")[0] !== chartId),
      );
    else if (pinKeys.length < MAX_PINS) persistLayout("pins", [...pinKeys, key]);
    else toast.error(t("statisticsLibrary.pins.limit", { count: MAX_PINS }));
  };

  /** Opens the tab a chart lives on, on the course or learner the pin was for. */
  const openPinned = (item: LayoutItem) => {
    const home = views.find(view => viewChartIds(view).includes(item.id));
    if (!home) return;
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", home.id);
    if (home.subject && item.filters[home.subject]) {
      nextParams.set(home.subject, item.filters[home.subject] as string);
    }
    setParams(nextParams, { replace: true });
  };

  /** Opens the tab and chart a finding comes from, on the course or learner it is about. */
  const openInsight = (insight: StatisticsInsight) => {
    const home = views.find(view => view.id === insight.view);
    if (!home) return;
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", home.id);
    nextParams.delete("course");
    nextParams.delete("learner");
    if (home.subject && insight.filters?.[home.subject]) {
      nextParams.set(home.subject, insight.filters[home.subject] as string);
    }
    nextParams.set("chart", insight.chartId);
    setParams(nextParams, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="py-4" data-testid="statistics-dashboard-loading">
        <SkeletonText heading width="240px" />
      </div>
    );
  }

  const activeView: StatisticsViewConfig | undefined = views.find(v => v.id === tab);
  const pinnedIds = new Set(pinKeys.map(k => k.split("?")[0]));

  return (
    <div className="flex flex-col gap-2 py-2" data-testid="statistics-dashboard">
      <p className="text-sm text-typography-600">{t("statisticsLibrary.tagline")}</p>
      <div
        className="flex gap-1 border-b border-border-light"
        role="tablist"
        aria-label={t("statisticsLibrary.title")}
      >
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
            className={`-mb-px min-h-11 border-b-[3px] px-4 text-sm ${
              tab === id
                ? "border-[#2a5db0] font-semibold text-[#1c4488]"
                : "border-transparent text-typography-600 hover:text-typography-900"
            }`}
            data-testid={`statistics-tab-${id}`}
          >
            {t(`statisticsLibrary.tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab === "foryou" || !activeView ? (
        <ForYouView
          charts={charts}
          views={views}
          pinKeys={pinKeys}
          onPinsChange={keys => persistLayout("pins", keys)}
          onOpen={openPinned}
          onOpenInsight={openInsight}
        />
      ) : (
        <StatisticsView
          key={activeView.id}
          view={activeView}
          charts={charts}
          range={range}
          onRangeChange={setRange}
          layoutKeys={resolveViewLayout(
            isLegacyLayout(
              { ...prefs, [STATISTICS_LAYOUTS_PREF_KEY]: { ...savedLayouts, ...localLayouts } },
              activeView.id,
            ) && Array.isArray(savedFor(activeView.id))
              ? groupBySection(activeView, savedFor(activeView.id) as string[])
              : savedFor(activeView.id),
            activeView,
            charts,
          )}
          onLayoutChange={keys => persistLayout(activeView.id, keys)}
          subjectId={activeView.subject ? subjectFor(activeView.subject) : undefined}
          onSubjectChange={id => activeView.subject && chooseSubject(activeView.subject, id)}
          pinnedIds={pinnedIds}
          onTogglePin={togglePin}
          focusChart={params.get("chart") ?? undefined}
        />
      )}
    </div>
  );
};
