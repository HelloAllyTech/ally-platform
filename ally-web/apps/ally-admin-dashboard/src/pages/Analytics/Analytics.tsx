import { ReactNode, useCallback, useMemo, useState } from "react";

import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";

import "@carbon/charts/styles.css";
import "./analytics-carbon.scss";

import {
  CarbonDropdown as Dropdown,
  Heading,
  Section,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  CarbonTabs as Tabs,
  Theme,
} from "@ally-ui-mono/ui-shared";
import { AnalyticsWindowQuery, useGetScenarioLanguagesQuery, useGetTenantsQuery } from "@api";
import { en, FeatureToggleKey } from "@constants";
import { RootState } from "@store";
import { hasFeature } from "@utils";

import { AnalyticsTabFilters } from "./analyticsFilters";
import { ANALYTICS_GLOSSARY } from "./analyticsGlossary";
import { AnalyticsOrgScopeProvider } from "./analyticsOrgScope";
import { ANALYTICS_TAB_GROUPS, groupForTab, tabsInGroup } from "./analyticsTabGroups";
import {
  CUSTOM_RANGE,
  RangeChoice,
  readAnalyticsUrlState,
  writeAnalyticsUrlState,
} from "./analyticsUrlState";
import { BugAgentPerformance } from "./BugAgentPerformance";
import { ChartIdsVisibleContext } from "./chartKit";
import { CodingAgentCost } from "./CodingAgentCost";
import { FixSessionEngineCost } from "./FixSessionEngineCost";
import { TabControlsSlotProvider } from "./tabControlsSlot";
import { AllyGuideTab } from "./tabs/AllyGuideTab";
import { AnalyticsAgentTab } from "./tabs/AnalyticsAgentTab";
import { AnalyticsAuditTab } from "./tabs/AnalyticsAuditTab";
import { AnalyticsAutomationTab } from "./tabs/AnalyticsAutomationTab";
import { GlossaryAdherenceTab } from "./tabs/GlossaryAdherenceTab";
import { HighlightsTab } from "./tabs/HighlightsTab";
import { LanguageQualityTab } from "./tabs/LanguageQualityTab";
import { LatencyTab } from "./tabs/LatencyTab";
import { ProductManagementTab } from "./tabs/ProductManagementTab";
import { RatingsCommentsTab } from "./tabs/RatingsCommentsTab";
import { RetrievalQualityTab } from "./tabs/RetrievalQualityTab";
import { ScribeTab } from "./tabs/ScribeTab";
import { ConversationDrift } from "../ConversationDrift/ConversationDrift";
import { WeakPerformingMetricsTab } from "./tabs/WeakPerformingMetricsTab";
import { TokenConsumption } from "./TokenConsumption";
import { DebriefAnalytics } from "../Debriefs/metrics/DebriefAnalytics";

const ALL_ORGS_ITEM = { id: "", label: "All organisations" };

const RANGE_ITEMS: { id: RangeChoice; label: string }[] = [
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "12m", label: "Last 12 months" },
  { id: CUSTOM_RANGE, label: "Custom range…" },
];

/**
 * Tab registry — the single place to add/reorder analytics tabs. Each entry
 * declares which page-level pickers it consumes (`uses`) and renders its own
 * component with the shared filter values. Adding a tab = one entry + a
 * component under ./tabs; tab-local pickers live inside that component.
 *
 * `uses.range: false` means the tab reads ALL-TIME data and the time-range
 * picker is hidden for it. That is one switch, not two: the picker's visibility
 * and the window actually queried are both derived from this flag, so a tab
 * cannot end up showing a picker that changes nothing — or worse, hiding one
 * that still silently constrains its charts.
 */
interface TabDef {
  id: string;
  label: string;
  uses: { language: boolean; range: boolean };
  render: (f: AnalyticsTabFilters) => ReactNode;
  /**
   * Optional extra gate, on top of the route's analytics feature toggle. Only
   * one tab needs it today (Analytics Agent), and a tab
   * without it stays visible to everyone who can reach the page — which is
   * how every other tab here already behaved.
   *
   * A hidden tab, not a disabled one: a reader who can never use it is better
   * served by not knowing it exists than by a tab whose every request 403s.
   */
  visibleTo?: (ctx: { features: string[] }) => boolean;
  /**
   * Open to a platform admin restricted to some organizations: every request
   * the tab makes narrows to the page's org (or is skipped for them). Every
   * other tab is hidden from them — the backend would refuse its requests.
   */
  orgScoped?: true;
}

/** Query-string key that selects an Analytics tab by its `TabDef.id`. */
export const ANALYTICS_TAB_PARAM = "tab";
/** The Debriefs tab's id, exported so the Debrief Console can send its old Metrics links here. */
export const ANALYTICS_DEBRIEFS_TAB_ID = "debriefs";
/** The Bug Agent tab's id, exported so the Bug Hunter page can link to it. */
export const ANALYTICS_BUG_AGENT_TAB_ID = "bug-agent-performance";

const TABS: TabDef[] = [
  // Highlights is the whole-platform picture; it absorbed the former separate
  // "Overview" tab, which rendered four of the same charts from the same data,
  // and later the "Testing" staging tab, whose twenty charts were distributed
  // into the Highlights sub-tab that answers the same question as each — so a
  // metric now lives in exactly one place rather than in a reviewed copy and a
  // provisional one.
  //
  // It takes no time range: a leadership view of "how is the platform doing" is
  // a question about the whole history, and the reader who wants a narrower read
  // gets it per chart via the grouping control rather than by re-scoping every
  // panel on the page at once.
  {
    id: "highlights",
    label: "Highlights",
    uses: { language: false, range: false },
    orgScoped: true,
    render: f => <HighlightsTab {...f} />,
  },
  {
    // The five simulator-quality metrics under active repair, on one filter
    // tuple. Placed directly after Highlights because it is the working view
    // for the current quality push, not a reference tab.
    //
    // It takes BOTH pickers, and unusually the tab adds two more of its own
    // (model, scenario) rather than leaving them to a drill-in: three findings
    // in this data turned out to be composition artefacts rather than
    // regressions, so segmentation here is part of the metric rather than a
    // convenience.
    id: "weak-metrics",
    label: "Actor quality metrics",
    uses: { language: true, range: true },
    render: f => <WeakPerformingMetricsTab {...f} />,
  },
  {
    // Learners' own words about their roleplays. Every other surface reduces
    // the post-session rating to a number; this one lists the comments, which
    // is where the reasons are. Beside Actor quality metrics because most low
    // ratings turn out to be about the same things those metrics measure.
    //
    // Takes the range picker (a feed is read "what came in lately"), not the
    // language picker: comments are written in whatever language the learner
    // chose, and the language shows on each row instead. Open to an admin
    // restricted to some organisations, narrowed to the page's organisation.
    id: "ratings-comments",
    label: "Ratings & comments",
    uses: { language: false, range: true },
    orgScoped: true,
    render: f => <RatingsCommentsTab {...f} />,
  },
  {
    // How learners use Ally and, beside it, whether they are learning (AAQ-240 to AAQ-251). Leads
    // with the paired engagement-vs-learning chart, the guard the plan's rollout rule rests on.
    //
    // Takes the range picker, not the language picker: Ally's conversations are in whatever
    // language the learner chose. Open to an admin restricted to some organisations, narrowed to the
    // page's organisation (its routes are org-scoped), like Ratings & comments beside it.
    id: "ally",
    label: "Ally",
    uses: { language: false, range: true },
    orgScoped: true,
    render: f => <AllyGuideTab {...f} />,
  },
  {
    // The Debrief agent's metrics: the PRD's success metrics, the pass rate (the same definition the
    // evals use) with its breakdowns, and each agent in the debrief family. Moved here from the
    // Debrief Console on 2026-11-11 so every agent's analytics sit together; the Console keeps the
    // operator work. It reads the page's time range, and adds its six filters (organisation,
    // language, learner level, debrief type, release, judge version) to the page's filter row. The
    // page's language picker is off: debrief language is the session's own code, not a scenario
    // language.
    id: ANALYTICS_DEBRIEFS_TAB_ID,
    label: "Debriefs",
    uses: { language: false, range: true },
    render: f => <DebriefAnalytics range={f.query.range} />,
  },
  {
    id: "latency",
    label: "Latency & reliability",
    uses: { language: true, range: true },
    render: f => <LatencyTab {...f} />,
  },
  {
    id: "drift",
    label: "Drift",
    uses: { language: true, range: true },
    render: f => <ConversationDrift {...f} />,
  },
  {
    id: "language",
    label: "Language",
    uses: { language: true, range: true },
    render: f => <LanguageQualityTab {...f} />,
  },
  {
    // Deterministic avoid-list adherence — a sibling to the Language tab's
    // judge-based error rates, but no time range: a scan is triggered
    // on-demand per language (Rescan), not read over a rolling window, and
    // glossary_adherence_reports has no occurredAt-per-window field to slice
    // by. Same per-language drill-in pattern as Language: overview table by
    // default, pick a language above for its violated terms.
    id: "glossary",
    label: "Language glossary",
    uses: { language: true, range: false },
    render: f => <GlossaryAdherenceTab {...f} />,
  },
  {
    // Corpus retrieval quality: does what the agent retrieves actually answer what it asked?
    //
    // Sits beside the other judge-backed quality tabs rather than under the knowledge-base
    // pages, because the question it answers is a quality question, not a curation one. For "is
    // this one query working", the WhatsApp bot's Test tab answers it end to end. This is the
    // population view.
    //
    // Takes the range picker and no language: a corpus document is language-tagged but a
    // retrieval is not, and offering a language filter that narrowed nothing would be worse
    // than offering none.
    id: "retrieval-quality",
    label: en.ragQuality.tab,
    uses: { language: false, range: true },
    render: f => <RetrievalQualityTab {...f} />,
  },
  {
    // Labelled for what it measures. It was "Tokens" while its heading said "AI
    // cost" and its axis was USD.
    id: "cost",
    label: "AI cost",
    uses: { language: false, range: true },
    render: f => (
      <div className="flex flex-col gap-6">
        <TokenConsumption {...f} />
        <CodingAgentCost {...f} />
        {/* Its own day-window control, not the tab-wide range picker above —
            see the component's own doc for why. */}
        <FixSessionEngineCost />
      </div>
    ),
  },
  {
    id: ANALYTICS_BUG_AGENT_TAB_ID,
    label: "Bug Agent",
    uses: { language: false, range: true },
    render: f => <BugAgentPerformance {...f} />,
  },
  {
    id: "scribe",
    orgScoped: true,
    label: "Scribe",
    uses: { language: false, range: true },
    render: f => <ScribeTab {...f} />,
  },
  {
    // The only tab here that measures OUR OWN work rather than the product's.
    // Everything above reads tenant-scoped learner and session data; this reads
    // the internal vote-based roadmap, which carries no tenant. Its own tab
    // rather than a panel on Highlights, so nobody takes "180 votes shipped" for
    // a platform metric.
    //
    // No page-level pickers: the roadmap has no language dimension, and its
    // charts are all-time by construction — a release log is slow enough that a
    // quarter can hold a handful of items, so a range picker would either draw
    // one bar or hide the years before it.
    //
    // Visible to everyone who can reach this page, like every tab except the
    // two below: the endpoint it calls is gated on the same route-level
    // feature toggle, and reading a delivery chart is not the privilege that
    // filing onto the roadmap is.
    id: "product",
    label: "Product management",
    uses: { language: false, range: false },
    render: () => <ProductManagementTab />,
  },
  {
    // Ask-anything, in English. Visible to everyone who can reach this page,
    // like every other tab — this used to sit behind the elevated
    // super-duper-admin tier (the other tabs answer fixed, reviewed
    // questions, while this one writes its own query across every readable
    // table at platform scope), but the product decision was made to give
    // every admin tier parity across all analytics surfaces. ally-be's
    // ALLOWED_TABLES backs every tenant-attributable table with a filtered
    // view that already excludes test-tenant rows, so widening who can ask a
    // question does not widen what it can see.
    //
    // No page-level pickers: the reader states the period and the grouping in
    // the question itself, and a range picker that silently re-scoped a typed
    // question would be a filter nobody could see being applied.
    id: "agent",
    label: "Analytics Agent",
    uses: { language: false, range: false },
    render: () => <AnalyticsAgentTab />,
    visibleTo: ({ features }) => hasFeature(features, FeatureToggleKey.ANALYTICS_AGENT),
  },
  {
    // An auditor that re-checks the Analytics Agent's recent answers against the
    // data, the dbt docs and the product code. Behind the same toggle as the
    // agent it audits: it reads what the agent was asked, so nobody who cannot
    // use the agent has any business opening it.
    //
    // No page-level pickers: how many messages to audit is chosen inside the tab,
    // next to the button that starts it, and the run is not scoped by period or
    // language.
    id: "audit",
    label: en.analyticsAudit.tabLabel,
    uses: { language: false, range: false },
    render: () => <AnalyticsAuditTab />,
    visibleTo: ({ features }) => hasFeature(features, FeatureToggleKey.ANALYTICS_AGENT),
  },
  {
    // The weekly run of three agents (backend review, PostHog events, dbt
    // changes), started only by the server's scheduler. Behind the same toggle as
    // the agent: approving here makes the dbt agent open a pull request.
    //
    // No page-level pickers: a run is not scoped by period or language.
    id: "automation",
    label: en.analyticsAutomation.tabLabel,
    uses: { language: false, range: false },
    render: () => <AnalyticsAutomationTab />,
    visibleTo: ({ features }) => hasFeature(features, FeatureToggleKey.ANALYTICS_AGENT),
  },
];

export const Analytics = () => {
  // 90 days, not 30. The judge backfill now reaches months back, and a
  // 30-day window truncated every trend on this page to about four
  // buckets — enough to draw a line, not enough to read one. The wider
  // default costs a slower first paint on tabs that run many aggregates.
  // Every page-level filter lives in the address (see analyticsUrlState), so a
  // view is a link and survives a reload. Defaults are the absent value.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => readAnalyticsUrlState(searchParams), [searchParams]);
  const { range, language, from: customFrom, to: customTo } = urlState;
  const patchUrl = useCallback(
    (patch: Parameters<typeof writeAnalyticsUrlState>[1]) =>
      setSearchParams(current => writeAnalyticsUrlState(current, patch), { replace: true }),
    [setSearchParams],
  );
  const setRange = (next: RangeChoice) => patchUrl({ range: next });
  const setLanguage = useCallback((next: string) => patchUrl({ language: next }), [patchUrl]);
  // The open tab lives in `?tab=<id>`, so "look at the Bug Agent numbers" is
  // a link — the Bug Hunter page sends its retired Performance section here
  // (OPP-0749). An unknown or absent id is the first tab, never an error.
  const requestedTab = searchParams.get(ANALYTICS_TAB_PARAM);

  // Most tabs are visible to everyone who can reach this page (the route
  // gates on the analytics feature toggle); a tab may declare a narrower gate
  // of its own.
  const features = useSelector((state: RootState) => state.user.features);
  // A platform admin restricted to some organizations sees one of them at a
  // time, and only the tabs that can narrow to it (TabDef.orgScoped).
  const restrictedTenantIds = useSelector(
    (state: RootState) => state.user.user?.restrictedTenantIds ?? null,
  );
  const restricted = restrictedTenantIds !== null;
  const { data: tenantData } = useGetTenantsQuery({ limit: 200 });
  const orgItems = useMemo(() => {
    const all = tenantData?.data ?? [];
    // A restricted admin may only pick from their own orgs; everyone else may
    // pick any, or none ("All organisations").
    const allowed = restricted ? (restrictedTenantIds ?? []) : all.map(t => t.id);
    return allowed
      .map(id => ({
        id,
        label: all.find(t => t.id === id)?.name ?? "Your organisation",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [restricted, restrictedTenantIds, tenantData]);
  const pickedOrgId = urlState.org;
  const setPickedOrgId = (id: string) => patchUrl({ org: id });
  // A restricted admin always has an org (the first one by default); an
  // unrestricted admin defaults to none, i.e. the whole platform.
  const selectedOrg = restricted
    ? (orgItems.find(o => o.id === pickedOrgId) ?? orgItems[0])
    : orgItems.find(o => o.id === pickedOrgId);
  const orgScope = useMemo(
    () => ({ restricted, tenantId: restricted ? selectedOrg?.id : undefined }),
    [restricted, selectedOrg],
  );
  const tabs = useMemo(
    () => TABS.filter(t => (restricted ? t.orgScoped : !t.visibleTo || t.visibleTo({ features }))),
    [features, restricted],
  );
  // Tabs are grouped by audience: the group row picks the kind of question,
  // the tab row inside it picks the view. The URL still carries only the tab.
  const currentTab = tabs.find(t => t.id === requestedTab) ?? tabs[0];
  const activeGroup = groupForTab(currentTab?.id ?? "");
  const groupTabs = useMemo(() => tabsInGroup(activeGroup, tabs), [activeGroup, tabs]);
  const visibleGroups = useMemo(
    () => ANALYTICS_TAB_GROUPS.filter(g => tabsInGroup(g, tabs).length > 0),
    [tabs],
  );
  const tabIndex = Math.max(
    0,
    groupTabs.findIndex(t => t.id === currentTab?.id),
  );
  const selectTab = (id: string | undefined) =>
    setSearchParams(
      current => {
        const params = new URLSearchParams(current);
        // The first tab is the default, so it is the absent value and the
        // page's own address stays `/analytics`.
        if (!id || id === tabs[0]?.id) params.delete(ANALYTICS_TAB_PARAM);
        else params.set(ANALYTICS_TAB_PARAM, id);
        return params;
      },
      { replace: true },
    );
  const setTabIndex = (index: number) => selectTab(groupTabs[index]?.id);

  const { data: scenarioLanguages } = useGetScenarioLanguagesQuery({ active: true });
  const languageItems = useMemo(
    () => [
      { id: "", label: "All languages" },
      ...(scenarioLanguages ?? []).map(l => ({ id: l.value, label: l.label })),
    ],
    [scenarioLanguages],
  );

  const selectedRange = RANGE_ITEMS.find(i => i.id === range) ?? RANGE_ITEMS[1];
  const selectedLanguage = languageItems.find(i => i.id === language) ?? languageItems[0];
  const activeTab = currentTab;

  // Callback ref into state, not a plain ref: a portal needs a re-render once
  // its target node exists, and a ref mutation does not trigger one.
  const [controlsSlot, setControlsSlot] = useState<HTMLDivElement | null>(null);

  // A tab with no range picker reads all-time data. Derived from the same flag
  // that hides the picker, so the two cannot disagree.
  // A custom range sends explicit from/to and no preset (the API lets the pair
  // override `range`; sending both would be two answers to one question).
  const isCustom = range === CUSTOM_RANGE && !!customFrom && !!customTo;
  // Who the data is narrowed to: a restricted admin's picked org, or an
  // unrestricted admin's picked org on the tabs that can honour it.
  const tenantId =
    orgScope.tenantId ?? (activeTab.orgScoped && selectedOrg ? selectedOrg.id : undefined);
  const query: AnalyticsWindowQuery = useMemo(() => {
    const window: AnalyticsWindowQuery = !activeTab.uses.range
      ? { range: "all" }
      : isCustom
        ? { from: customFrom, to: customTo }
        : { range: range === CUSTOM_RANGE ? "90d" : range };
    return { ...window, ...(tenantId ? { tenantId } : {}) };
  }, [range, activeTab, isCustom, customFrom, customTo, tenantId]);
  const filters: AnalyticsTabFilters = useMemo(
    () => ({ query, language, onSelectLanguage: setLanguage }),
    [query, language, setLanguage],
  );

  return (
    <div className="analytics-page font-primary pr-1">
      <Theme theme="white">
        <Section>
          {/* Heading, then filters on their own full-width line. They used to
              sit beside the heading, which fits four controls and breaks at
              six: a tab that adds its own slice dimensions pushed the row into
              two ragged lines split across the middle of the filter set. */}
          <div className="flex flex-col gap-4 mb-6">
            <div>
              <Heading className="text-2xl">Analytics</Heading>
              <p className="text-sm text-typography-500 mt-1">
                {restricted
                  ? `Metrics for ${selectedOrg?.label ?? "your organisation"} only. Charts that span every organisation are not shown to admins restricted to some organisations.`
                  : "Platform-wide metrics, excluding internal and test organisations."}{" "}
                Each panel states what it is derived from and how many observations back it.
                {/* Says where the window went, for a tab that has no picker. A
                    missing control reads as an omission unless it is explained. */}
                {!activeTab.uses.range &&
                  " This tab covers all of the platform's history; each chart carries its own day/week/month/year grouping."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                <label className="flex items-center gap-2 text-sm text-typography-700">
                  <input
                    type="checkbox"
                    checked={urlState.showIds}
                    onChange={e => patchUrl({ showIds: e.target.checked })}
                  />
                  Show chart IDs
                </label>
                <details className="text-sm text-typography-700" data-testid="analytics-glossary">
                  <summary className="cursor-pointer select-none">Terms used here</summary>
                  <dl className="mt-2 grid max-w-3xl gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
                    {ANALYTICS_GLOSSARY.map(g => (
                      <div key={g.term} className="contents">
                        <dt className="font-medium">{g.term}</dt>
                        <dd className="text-typography-600">{g.meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </div>
            {/* Wraps rather than overflows: with a tab's own pickers portalled
                in, the group is wider than a 1000px viewport, and an unwrapped
                flex row puts the last control off-screen with no scrollbar to
                reach it. Wrapped, it stays one contiguous block of filters. */}
            <div className="flex flex-wrap items-end gap-3">
              {/* One organisation picker for every admin. Restricted admins choose
                  among their own; everyone else may pick one, or none for the
                  whole platform. Shown only on tabs that can narrow to an org
                  (TabDef.orgScoped): a picker that changed nothing would lie. */}
              {(restricted ? orgItems.length > 1 : activeTab.orgScoped && orgItems.length > 0) && (
                <div className="w-full sm:w-56">
                  <Dropdown
                    id="analytics-org"
                    size="md"
                    titleText="Organisation"
                    hideLabel
                    label="Organisation"
                    items={restricted ? orgItems : [ALL_ORGS_ITEM, ...orgItems]}
                    selectedItem={selectedOrg ?? (restricted ? undefined : ALL_ORGS_ITEM)}
                    itemToString={item => item?.label ?? ""}
                    onChange={({ selectedItem }) => {
                      if (selectedItem) setPickedOrgId(selectedItem.id);
                    }}
                  />
                </div>
              )}
              {activeTab.uses.language && (
                <div className="w-full sm:w-44">
                  <Dropdown
                    id="analytics-language"
                    size="md"
                    titleText="Language"
                    hideLabel
                    label="Language"
                    items={languageItems}
                    selectedItem={selectedLanguage}
                    itemToString={item => item?.label ?? ""}
                    onChange={({ selectedItem }) => {
                      if (selectedItem) setLanguage(selectedItem.id);
                    }}
                  />
                </div>
              )}
              {activeTab.uses.range && (
                <div className="w-full sm:w-48">
                  <Dropdown
                    id="analytics-range"
                    size="md"
                    titleText="Time range"
                    hideLabel
                    label="Time range"
                    items={RANGE_ITEMS}
                    selectedItem={selectedRange}
                    itemToString={item => item?.label ?? ""}
                    onChange={({ selectedItem }) => {
                      if (selectedItem) setRange(selectedItem.id);
                    }}
                  />
                </div>
              )}
              {activeTab.uses.range && range === CUSTOM_RANGE && (
                <div className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-typography-700">
                    From
                    <input
                      type="date"
                      value={customFrom ?? ""}
                      max={customTo || undefined}
                      onChange={e => patchUrl({ range: CUSTOM_RANGE, from: e.target.value })}
                      className="h-10 rounded border border-border-light bg-white px-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-typography-700">
                    To
                    <input
                      type="date"
                      value={customTo ?? ""}
                      min={customFrom || undefined}
                      onChange={e => patchUrl({ range: CUSTOM_RANGE, to: e.target.value })}
                      className="h-10 rounded border border-border-light bg-white px-2 text-sm"
                    />
                  </label>
                  {!isCustom && (
                    <span className="pb-2 text-xs text-typography-500">
                      Pick both dates; showing the last 90 days until then.
                    </span>
                  )}
                </div>
              )}
              {/* Tabs with slice dimensions of their own portal them here, so
                  the whole filter bar stays one row above the content it
                  scopes. Page-wide filters first, then the tab's own. Empty for
                  tabs that add nothing. On phones the slot dissolves into the
                  row, so each portalled control stacks full-width like the
                  page's own pickers. */}
              <div
                ref={setControlsSlot}
                className="flex flex-wrap items-end gap-3 max-sm:contents"
              />
            </div>
          </div>

          {restricted && orgItems.length === 0 ? (
            <p className="text-sm text-typography-700">
              You are not assigned to any organisation yet, so there is nothing to show here. Ask
              whoever manages admin access to assign you one.
            </p>
          ) : (
            <AnalyticsOrgScopeProvider value={orgScope}>
              <ChartIdsVisibleContext.Provider value={urlState.showIds}>
                {visibleGroups.length > 1 && (
                  <div
                    role="group"
                    aria-label="Analytics areas"
                    className="mb-1 flex flex-wrap gap-2"
                  >
                    {visibleGroups.map(g => {
                      const selected = g.id === activeGroup.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          title={g.blurb}
                          aria-pressed={selected}
                          onClick={() => selectTab(tabsInGroup(g, tabs)[0]?.id)}
                          className={`rounded-full border px-3 py-1 text-sm ${
                            selected
                              ? "border-primary-500 bg-primary-50 font-medium text-typography-900"
                              : "border-border-light bg-white text-typography-700 hover:bg-neutral-50"
                          }`}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Tabs
                  selectedIndex={tabIndex}
                  onChange={({ selectedIndex }) => setTabIndex(selectedIndex)}
                >
                  <TabList aria-label="Analytics sections">
                    {groupTabs.map(t => (
                      <Tab key={t.id}>{t.label}</Tab>
                    ))}
                  </TabList>
                  <TabPanels>
                    {/*
                Only the ACTIVE panel's component is mounted. Carbon's TabPanel
                merely sets `hidden`, so rendering every tab's children fired one
                query per chart across all tabs on first paint — most of them for
                panels nobody was looking at. Depth stays available on demand; it
                just is not all fetched up front.
              */}
                    {groupTabs.map((t, i) => (
                      // No side padding on phones: the page wrapper already has its
                      // gutter, and Carbon's panel padding stacks on top of it.
                      <TabPanel key={t.id} className="max-sm:!px-0">
                        {i === tabIndex ? (
                          <TabControlsSlotProvider value={controlsSlot}>
                            {t.render(filters)}
                          </TabControlsSlotProvider>
                        ) : null}
                      </TabPanel>
                    ))}
                  </TabPanels>
                </Tabs>
              </ChartIdsVisibleContext.Provider>
            </AnalyticsOrgScopeProvider>
          )}
        </Section>
      </Theme>
    </div>
  );
};
