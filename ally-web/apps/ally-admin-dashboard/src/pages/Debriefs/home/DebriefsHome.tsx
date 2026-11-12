import React, { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import {
  useEscalateDebriefMutation,
  useGetDebriefCalibrationSampleQuery,
  useGetDebriefOverviewQuery,
  useGetDebriefReviewQuery,
  useGetDebriefRunsQuery,
  useGetPmAgentStateQuery,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { getErrorMessage } from "@utils";

import { languageLabel, recipeLabel } from "../consoleLabels";
import { pmAgentPath, settingsPath } from "../consoleRoutes";
import { AlertBanner, Segmented } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { needsViewer, recentlyReverted } from "../pm/ideaGroups";
import {
  buildSessionItems,
  categoryList,
  FILTER_KEYS,
  groupByDay,
  HOME_CATEGORIES,
  HomeCategory,
  HomeFilters,
  inCategory,
  matchesFilters,
  readHomeState,
  SessionItem,
  waitedFor,
} from "../queue";
import { scenarioTitle, SessionCard, SessionRow } from "./SessionCard";

/** The monthly cap turns the home's banner yellow at this share spent. */
export const CAP_WARNING_SHARE = 0.8;

/** A session link that keeps the home's category and filters, so Back and Previous/Next agree. */
export const sessionLink = (runId: string, params: URLSearchParams) => {
  const q = new URLSearchParams();
  for (const k of ["cat", ...FILTER_KEYS]) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  const qs = q.toString();
  return `${ROUTES.DEBRIEF_SESSION(runId)}${qs ? `?${qs}` : ""}`;
};

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable ||
      t.getAttribute("role") === "combobox")
  );
};

/** The items every Debriefs page reads the queue from: the home, and the session's Previous/Next. */
export const useSessionItems = (canScore: boolean) => {
  const [polling, setPolling] = useState(false);
  const runs = useGetDebriefRunsQuery(
    { status: "" },
    { refetchOnMountOrArgChange: true, pollingInterval: polling ? 15_000 : 0 },
  );
  const review = useGetDebriefReviewQuery();
  const sample = useGetDebriefCalibrationSampleQuery(undefined, { skip: !canScore });
  const anyRunning = !!runs.data?.some(r => r.status === "running" || r.status === "queued");
  // Polling follows whether a run is in flight; adjusted while rendering rather than in an effect.
  if (anyRunning !== polling) setPolling(anyRunning);
  const items = useMemo(
    () => buildSessionItems(runs.data, review.data, canScore ? sample.data?.items : undefined),
    [runs.data, review.data, sample.data, canScore],
  );
  return { items, runs, review };
};

type Item = { id: string; label: string };

/** One house filter: a Carbon dropdown, no visible label, its first item "All …". */
const Filter: React.FC<{
  id: string;
  label: string;
  value: string;
  options: Item[];
  onChange: (v: string) => void;
}> = ({ id, label, value, options, onChange }) => (
  <div className="w-full sm:w-48" data-testid={`home-filter-${id}`}>
    <Dropdown
      id={`debriefs-filter-${id}`}
      size="md"
      titleText={label}
      hideLabel
      label={label}
      items={options}
      selectedItem={options.find(o => o.id === value) ?? options[0]}
      itemToString={(o: Item | null) => o?.label ?? ""}
      onChange={({ selectedItem }: { selectedItem: Item | null }) =>
        onChange(selectedItem?.id ?? "")
      }
    />
  </div>
);

const uniq = (xs: Array<string | null>) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

/**
 * The Debriefs home (redesign 2026-11-12): every debriefed session as a card, by category, with
 * the queue of what needs a person first. Opening one goes to its session page.
 */
export const DebriefsHome: React.FC = () => {
  const h = en.debriefs.home;
  const navigate = useNavigate();
  const access = useDebriefAccess();
  const [params, setParams] = useSearchParams();
  const { cat, filters, list } = readHomeState(params, access.score);
  const { items, runs, review } = useSessionItems(access.score);
  const overview = useGetDebriefOverviewQuery();
  const pm = useGetPmAgentStateQuery(undefined, {
    skip: !access.pmAgent && !access.approvePinnedRule,
  });
  const [escalate] = useEscalateDebriefMutation();
  const ceiling = overview.data?.budget.runCeilingUsd;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const categories = HOME_CATEGORIES.filter(c => c !== "score" || access.score);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        categories.map(c => [
          c,
          items.filter(i => inCategory(i, c) && matchesFilters(i, filters, ceiling)).length,
        ]),
      ) as Record<HomeCategory, number>,
    [categories, items, filters, ceiling],
  );
  const shown = useMemo(
    () => categoryList(items, cat, filters, ceiling),
    [items, cat, filters, ceiling],
  );
  const groups =
    cat === "needs"
      ? shown.length
        ? [{ label: h.inOrder, items: shown }]
        : []
      : groupByDay(shown, { today: h.today, yesterday: h.yesterday });

  // j / k move through what is shown, Enter opens it, e escalates it (the Ally team only).
  const [selected, setSelected] = useState(0);
  if (selected >= shown.length && selected !== Math.max(0, shown.length - 1)) {
    setSelected(Math.max(0, shown.length - 1));
  }
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || shown.length === 0) return;
      const current = shown[Math.min(selected, shown.length - 1)];
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next =
          e.key === "j" ? Math.min(shown.length - 1, selected + 1) : Math.max(0, selected - 1);
        setSelected(next);
        listRef.current
          ?.querySelectorAll<HTMLElement>(
            "[data-testid='session-card'],[data-testid='session-row']",
          )
          [next]?.scrollIntoView?.({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        navigate(sessionLink(current.runId, params));
      } else if (e.key === "e" && access.escalate && !current.escalated) {
        const flag = current.flags[0];
        const target = flag
          ? { kind: "flags" as const, id: flag.id }
          : current.review
            ? { kind: "runs" as const, id: current.runId }
            : null;
        if (!target) return;
        e.preventDefault();
        escalate(target)
          .unwrap()
          .then(() => toast.success(en.debriefs.review.escalatedDone))
          .catch(err => toast.error(getErrorMessage(err, en.debriefs.review.failed)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, navigate, params, access.escalate, escalate]);

  const ideas = pm.data?.ideas ?? [];
  const needsYou = ideas.filter(i => needsViewer(i, access)).length;
  const reverted = access.pmAgent ? recentlyReverted(ideas) : [];
  const o = overview.data;

  // What is shown above everything: only for a role that can act on it.
  const urgent = access.decideFlags
    ? items.filter(i => i.urgent || (i.learnerDistress && i.review))
    : [];
  const escalatedToMe = access.advisor && !access.team ? items.filter(i => i.escalated) : [];
  const oldest = (xs: SessionItem[]) =>
    [...xs].sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))[0];
  const capShare =
    o?.budget.monthSpentUsd != null && o.budget.monthlyCapUsd > 0
      ? o.budget.monthSpentUsd / o.budget.monthlyCapUsd
      : 0;
  const staff = access.team || access.owner;

  const filterOptions = {
    org: uniq(items.map(i => i.tenantName)).map(v => ({ id: v, label: v })),
    language: uniq(items.map(i => i.language)).map(v => ({ id: v, label: languageLabel(v) })),
    recipe: uniq(items.map(i => i.recipeKey)).map(v => ({ id: v, label: recipeLabel(v) })),
  };
  const opts = (key: keyof typeof h.filters, more: Item[]): Item[] => [
    { id: "", label: h.filters[key].all },
    ...more,
  ];

  const loading = !runs.data && !runs.isError;

  return (
    <div className="flex flex-col gap-5 font-primary" data-testid="debriefs-home">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-secondary text-[32px] font-normal leading-tight text-typography-900">
          {en.debriefs.title}
        </h1>
        <p className="text-[15px] text-neutral-600">{h.intro}</p>
      </header>

      {urgent.length > 0 && (
        <AlertBanner
          kind="error"
          testId="home-urgent-banner"
          action={
            <Link
              to={sessionLink(oldest(urgent).runId, params)}
              className="inline-flex h-9 items-center rounded-sm bg-destructive-500 px-3.5 text-sm font-semibold text-white no-underline"
            >
              {h.openIt}
            </Link>
          }
        >
          <b>{h.urgentBanner(urgent.length, waitedFor(oldest(urgent).waitingSince))}</b>{" "}
          {h.urgentWhere(scenarioTitle(oldest(urgent)))}
        </AlertBanner>
      )}
      {escalatedToMe.length > 0 && (
        <AlertBanner
          kind="error"
          testId="home-escalated-banner"
          action={
            <Link
              to={sessionLink(oldest(escalatedToMe).runId, params)}
              className="inline-flex h-9 items-center rounded-sm bg-destructive-500 px-3.5 text-sm font-semibold text-white no-underline"
            >
              {h.openIt}
            </Link>
          }
        >
          <b>{h.escalatedBanner(escalatedToMe.length)}</b>
        </AlertBanner>
      )}
      {reverted.length > 0 && (
        <AlertBanner
          kind="error"
          testId="home-reverted-banner"
          action={
            <Link to={pmAgentPath("ideas", reverted[0].id)} className="text-sm font-semibold">
              {h.readIt}
            </Link>
          }
        >
          <b>{h.reverted(reverted.length)}</b>
        </AlertBanner>
      )}
      {staff && o?.mode === "off" && (
        <AlertBanner kind="error" testId="home-off-banner">
          <b>{en.debriefs.runs.offTitle}</b> {en.debriefs.runs.offMessage}
        </AlertBanner>
      )}
      {staff && capShare >= CAP_WARNING_SHARE && o && (
        <AlertBanner
          kind={capShare >= 1 ? "error" : "warning"}
          testId="home-cap-banner"
          action={
            <Link to={settingsPath("budget")} className="text-sm font-semibold">
              {h.budgets}
            </Link>
          }
        >
          {h.capBanner(formatUsd(o.budget.monthSpentUsd), formatUsd(o.budget.monthlyCapUsd))}
        </AlertBanner>
      )}
      {staff && !!o?.languageIncidents?.length && (
        <AlertBanner kind="warning" testId="language-incidents">
          <b>{en.debriefs.runs.languageIncident.title}</b>{" "}
          {o.languageIncidents
            .map(i =>
              en.debriefs.runs.languageIncident.line(
                i.tenantName ?? i.tenantId,
                i.detected,
                i.runs,
                i.unsure,
              ),
            )
            .join(" ")}
        </AlertBanner>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={h.categoriesLabel}
          value={cat}
          onChange={c => set({ cat: c === "needs" ? null : c })}
          items={categories.map(c => ({
            id: c,
            label: (
              <>
                {h.categories[c]}
                <span className="text-xs opacity-75">{counts[c]}</span>
              </>
            ),
          }))}
        />
        <div className="flex-1" />
        <div
          role="group"
          aria-label={h.layoutLabel}
          className="flex overflow-hidden rounded-sm border border-neutral-400"
        >
          {(["cards", "list"] as const).map((v, i) => (
            <button
              key={v}
              type="button"
              aria-label={h.layout[v]}
              aria-pressed={list === (v === "list")}
              onClick={() => set({ view: v === "list" ? "list" : null })}
              className={[
                "flex h-[34px] w-10 items-center justify-center",
                i ? "border-l border-neutral-400" : "",
                list === (v === "list") ? "bg-neutral-100" : "bg-white",
              ].join(" ")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="#393939"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                {v === "cards" ? (
                  <>
                    <rect x="2" y="2" width="5" height="5" rx="1" />
                    <rect x="9" y="2" width="5" height="5" rx="1" />
                    <rect x="2" y="9" width="5" height="5" rx="1" />
                    <rect x="9" y="9" width="5" height="5" rx="1" />
                  </>
                ) : (
                  <path d="M2 4h12M2 8h12M2 12h12" />
                )}
              </svg>
            </button>
          ))}
        </div>
        <Link
          to={pmAgentPath()}
          data-testid="pm-agent-button"
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
        >
          {h.pmAgent}
          {needsYou > 0 && (
            <span
              aria-label={h.needsYouCount(needsYou)}
              className="rounded-full bg-primary-500 px-[7px] py-px text-[11px] font-semibold text-white"
            >
              {needsYou}
            </span>
          )}
        </Link>
        <Link
          to={settingsPath()}
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
        >
          {h.settings}
        </Link>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-4"
        data-testid="home-filters"
      >
        <Filter
          id="org"
          label={h.filters.org.label}
          value={filters.org ?? ""}
          options={opts("org", filterOptions.org)}
          onChange={v => set({ org: v })}
        />
        <Filter
          id="language"
          label={h.filters.language.label}
          value={filters.language ?? ""}
          options={opts("language", filterOptions.language)}
          onChange={v => set({ language: v })}
        />
        <Filter
          id="recipe"
          label={h.filters.recipe.label}
          value={filters.recipe ?? ""}
          options={opts("recipe", filterOptions.recipe)}
          onChange={v => set({ recipe: v })}
        />
        <Filter
          id="fallback"
          label={h.filters.fallback.label}
          value={filters.fallback ?? ""}
          options={opts(
            "fallback",
            (["none", "low", "high"] as const).map(id => ({ id, label: h.filters.fallback[id] })),
          )}
          onChange={v => set({ fallback: v })}
        />
        <Filter
          id="risk"
          label={h.filters.risk.label}
          value={filters.risk ?? ""}
          options={opts(
            "risk",
            (["yes", "no"] as const).map(id => ({ id, label: h.filters.risk[id] })),
          )}
          onChange={v => set({ risk: v })}
        />
        <Filter
          id="cost"
          label={h.filters.cost.label}
          value={filters.cost ?? ""}
          options={opts(
            "cost",
            (["over", "ceiling"] as const).map(id => ({ id, label: h.filters.cost[id] })),
          )}
          onChange={v => set({ cost: v })}
        />
        <span className="ml-auto text-xs text-neutral-600" data-testid="home-keys">
          {access.escalate ? h.keys : h.keysNoEscalate}
        </span>
      </div>

      {cat === "needs" && <p className="text-sm text-neutral-700">{h.queueNote}</p>}

      {runs.isError || review.isError ? (
        <ErrorPanel
          what={h.loadFailed}
          error={runs.error ?? review.error}
          onRetry={() => {
            void runs.refetch();
            void review.refetch();
          }}
        />
      ) : loading ? (
        <LoadingBlock lines={6} />
      ) : shown.length === 0 ? (
        <EmptyPanel title={h.empty[cat].title} message={h.empty[cat].message} />
      ) : (
        <div ref={listRef} className="flex flex-col gap-5">
          {groups.map(g => (
            <section key={g.label} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-[.32px] text-neutral-600">{g.label}</h2>
              {list ? (
                <div className="overflow-x-auto rounded-sm bg-neutral-50">
                  {g.items.map(item => (
                    <SessionRow
                      key={item.runId}
                      item={item}
                      to={sessionLink(item.runId, params)}
                      selected={shown[selected]?.runId === item.runId}
                      showScore={access.score}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-4">
                  {g.items.map(item => (
                    <SessionCard
                      key={item.runId}
                      item={item}
                      to={sessionLink(item.runId, params)}
                      selected={shown[selected]?.runId === item.runId}
                      showScore={access.score}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export type { HomeFilters };
