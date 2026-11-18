import React, { useEffect, useMemo, useRef, useState } from "react";

import { BarChart3 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefHomeQuery,
  useGetDebriefSessionsQuery,
  useGetDebriefSettingsQuery,
} from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefHomeV2 } from "@types";

import { languageLabel, recipeLabel } from "../consoleLabels";
import { analyticsDebriefsPath, changesPath, settingsPath } from "../consoleRoutes";
import {
  FilterChip,
  FilterChips,
  KeyboardHint,
  MoreActions,
  MoreFiltersButton,
} from "../consoleRows";
import { useDebriefAccess } from "../debriefAccess";
import { FILTER_KEYS, groupByDay, readHomeState, sessionsQuery } from "../queue";
import { one } from "../scoreText";
import { NeedsYouList } from "./NeedsYouList";
import { SessionCard, SessionRow } from "./SessionCard";

/** A session link that keeps the home's filters, so Back returns there. */
export const sessionLink = (runId: string, params: URLSearchParams) => {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  // Which queue the viewer came from, so the session page can move on to the next item in it.
  const cat = params.get("cat");
  if (cat) q.set("cat", cat);
  const qs = q.toString();
  return `${ROUTES.DEBRIEF_SESSION(runId)}${qs ? `?${qs}` : ""}`;
};

const isTyping = (e: KeyboardEvent) => {
  const t = e.target;
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable ||
      t.getAttribute("role") === "combobox")
  );
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
  <div className="w-full min-w-0 sm:w-48 sm:shrink" data-testid={`home-filter-${id}`}>
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

/** The undo margin the headline uses when the owner setting hasn't loaded (V2_AUTONOMY A4). */
export const DEFAULT_UNDO_MARGIN = 0.3;

/**
 * The headline (U1, review 2026-11-16): the score is named only when it moved by more than the
 * undo margin; otherwise "Debriefs are healthy this week, and …". The needs-you clause is bold.
 */
export const homeHeadline = (
  h: DebriefHomeV2["headline"],
  undone: number,
  margin: number,
): { score: { dir: "rose" | "fell"; by: string; undone: boolean } | null; noScore: boolean } => {
  if (h.score === null) return { score: null, noScore: true };
  if (h.lastWeekScore === null) return { score: null, noScore: false };
  const delta = h.score - h.lastWeekScore;
  if (Math.abs(delta) <= margin) return { score: null, noScore: false };
  return {
    score: {
      dir: delta > 0 ? "rose" : "fell",
      by: one(Math.abs(delta)),
      undone: delta < 0 && undone > 0,
    },
    noScore: false,
  };
};

const Headline: React.FC<{ home: DebriefHomeV2; margin: number }> = ({ home, margin }) => {
  const t = en.debriefs.v2.home;
  const head = homeHeadline(home.headline, home.thisWeek.undone, margin);
  return (
    <p
      className="m-0 max-w-[980px] text-[22px] font-light leading-snug text-typography-900"
      data-testid="home-headline"
    >
      {head.score ? (
        <>
          <Link
            to={analyticsDebriefsPath()}
            title={t.overallScoreHelp}
            className="text-primary-500"
            data-testid="home-headline-score"
          >
            {t.overallScore}
          </Link>
          {t.moved(head.score.dir, head.score.by)}
          {head.score.undone ? t.movedUndone : ""}
        </>
      ) : head.noScore ? (
        t.noScore
      ) : (
        t.healthy
      )}
      {t.and}
      {home.headline.needsYou > 0 ? (
        <Link
          to={changesPath()}
          className="font-semibold text-primary-500"
          data-testid="home-needs-link"
        >
          {t.needsYou(home.headline.needsYou)}
        </Link>
      ) : (
        <b className="font-semibold">{t.needsYou(0)}</b>
      )}
    </p>
  );
};

export { scoreTrend } from "../scoreText";

/**
 * The Debriefs home (v2, U1): the headline sentence first; Needs you lists the waiting changes,
 * each opening on the PM agent page, where changes are decided (never here); then every debrief by
 * day. No review queue, no status pills: a debrief carries only "⚑ Flagged by the learner" and
 * its Quality score.
 */
export const DebriefsHome: React.FC = () => {
  const h = en.debriefs.home;
  const t = en.debriefs.v2.home;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [polling, setPolling] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() =>
    ["fallback", "riskCue", "cost"].some(k => params.get(k)),
  );
  const home = useGetDebriefHomeQuery(undefined, { pollingInterval: 60_000 });
  const settings = useGetDebriefSettingsQuery();
  const rawMargin = settings.data?.values.undoMargin;
  const margin = typeof rawMargin === "number" ? rawMargin : DEFAULT_UNDO_MARGIN;
  const { filters, list } = readHomeState(params, ["all"], "all");
  // Pages of 50: the list says how many it shows of how many, and loads more on request, so
  // older debriefs are never silently cut off.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const filterKey = JSON.stringify(filters);
  const [limitFor, setLimitFor] = useState(filterKey);
  if (limitFor !== filterKey) {
    setLimitFor(filterKey);
    setLimit(PAGE_SIZE);
  }
  const sessions = useGetDebriefSessionsQuery(
    { ...sessionsQuery("all", filters), limit },
    {
      refetchOnMountOrArgChange: true,
      pollingInterval: polling ? 15_000 : 0,
    },
  );
  const page = sessions.data;
  const access = useDebriefAccess(page?.viewer);
  // The Ally team and the owner run the PM agent; the clinical advisor gets no PM agent button.
  const team = access.pmAgent;
  const openChange = params.get("change");
  // Older links to a change on Home (`/debriefs?change=`) open it on the PM agent page.
  useEffect(() => {
    if (openChange) navigate(changesPath(openChange), { replace: true });
  }, [openChange, navigate]);
  const anyRunning = !!page?.items.some(r => r.status === "running" || r.status === "queued");
  if (anyRunning !== polling) setPolling(anyRunning);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const shown = useMemo(() => page?.items ?? [], [page]);
  const groups = groupByDay(shown, { today: h.today, yesterday: h.yesterday });

  // j / k move through what is shown, Enter opens it.
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, navigate, params]);

  const options = page?.filterOptions;
  const opts = (key: keyof typeof h.filters, more: Item[]): Item[] => [
    { id: "", label: h.filters[key].all },
    ...more,
  ];

  type FilterDef = {
    id: keyof typeof h.filters;
    key: (typeof FILTER_KEYS)[number];
    options: Item[];
  };
  const filterDefs: FilterDef[] = [
    {
      id: "org",
      key: "tenantId",
      options: opts(
        "org",
        (options?.tenants ?? []).map(o => ({ id: o.id, label: o.name })),
      ),
    },
    {
      id: "language",
      key: "language",
      options: opts(
        "language",
        (options?.languages ?? []).map(l => ({ id: l, label: languageLabel(l) })),
      ),
    },
    {
      id: "recipe",
      key: "recipe",
      options: opts(
        "recipe",
        (options?.recipes ?? []).map(r => ({ id: r, label: recipeLabel(r) })),
      ),
    },
    {
      id: "fallback",
      key: "fallback",
      options: opts(
        "fallback",
        (["none", "light", "heavy"] as const).map(id => ({ id, label: h.filters.fallback[id] })),
      ),
    },
    {
      id: "risk",
      key: "riskCue",
      options: opts(
        "risk",
        (["true", "false"] as const).map(id => ({ id, label: h.filters.risk[id] })),
      ),
    },
    {
      id: "cost",
      key: "cost",
      options: opts(
        "cost",
        (["over_0_20", "hit_ceiling"] as const).map(id => ({ id, label: h.filters.cost[id] })),
      ),
    },
  ];
  const mainFilters = filterDefs.slice(0, 3);
  const moreFilters = filterDefs.slice(3);
  const valueOf = (f: FilterDef) => filters[f.key] ?? "";
  const hiddenActive = moreFilters.filter(f => valueOf(f)).length;
  const chips: FilterChip[] = filterDefs
    .filter(f => valueOf(f))
    .map(f => ({
      id: f.id,
      label: `${h.filters[f.id].label}: ${
        f.options.find(o => o.id === valueOf(f))?.label ?? valueOf(f)
      }`,
      onRemove: () => set({ [f.key]: null }),
    }));
  const renderFilter = (f: FilterDef) => (
    <Filter
      key={f.id}
      id={f.id}
      label={h.filters[f.id].label}
      value={valueOf(f)}
      options={f.options}
      onChange={v => set({ [f.key]: v })}
    />
  );

  return (
    <div className="flex flex-col gap-5 font-primary" data-testid="debriefs-home">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-secondary text-[32px] font-normal leading-tight text-typography-900">
          {en.debriefs.title}
        </h1>
        {home.data && !team ? (
          <p
            className="m-0 max-w-[980px] text-[22px] font-light leading-snug text-typography-900"
            data-testid="home-headline"
          >
            {home.data.needsYou.length > 0 ? (
              <Link
                to={changesPath()}
                className="font-semibold text-primary-500"
                data-testid="home-needs-link"
              >
                {t.advisorHeadline(home.data.needsYou.length)}
              </Link>
            ) : (
              <b className="font-semibold">{t.advisorHeadline(0)}</b>
            )}
          </p>
        ) : home.data ? (
          <Headline home={home.data} margin={margin} />
        ) : home.isError ? (
          <p className="m-0 text-sm text-neutral-700" data-testid="home-summary-error">
            {t.loadFailed}{" "}
            <button
              type="button"
              className="text-primary-500 underline"
              onClick={() => void home.refetch()}
            >
              {en.debriefs.v2.conversation.retry}
            </button>
          </p>
        ) : (
          <LoadingBlock lines={1} />
        )}
      </header>

      {home.data && (
        <div className="flex flex-col gap-4">
          <NeedsYouList items={home.data.needsYou} advisor={!team} />
        </div>
      )}

      {/* One row at lg and up: layout, Changes and Analytics; Settings goes in More. Below lg the
          actions take a second row, on purpose. */}
      <div
        className="flex flex-col gap-3 min-[1056px]:flex-row min-[1056px]:flex-nowrap min-[1056px]:items-center"
        data-testid="home-toolbar"
      >
        <div className="hidden min-w-0 flex-1 lg:block" />
        <div className="flex flex-nowrap items-center gap-3" data-testid="home-actions">
          <div
            role="group"
            aria-label={h.layoutLabel}
            className="flex shrink-0 overflow-hidden rounded-sm border border-neutral-400"
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
          {team && (
            <Link
              to={changesPath()}
              data-testid="changes-button"
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
            >
              {t.changes}
            </Link>
          )}
          {team && (
            <Link
              to={analyticsDebriefsPath()}
              data-testid="analytics-button"
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
            >
              <BarChart3 aria-hidden="true" className="h-4 w-4" />
              {h.analytics}
            </Link>
          )}
          {team && (
            <MoreActions
              testId="home-more"
              items={[{ id: "settings", label: h.settings, to: settingsPath() }]}
            />
          )}
        </div>
      </div>

      {/* The three most-used filters stay in the bar; fallback step, risk cue and cost sit behind
          More filters, which counts the ones set. Every set filter shows as a removable chip. */}
      <div className="flex flex-col gap-2.5 border-b border-neutral-100 pb-4">
        <div
          className="flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center"
          data-testid="home-filters"
        >
          {mainFilters.map(renderFilter)}
          <MoreFiltersButton
            open={moreOpen}
            onToggle={() => setMoreOpen(o => !o)}
            active={hiddenActive}
            controls="home-more-filters"
            testId="home-more-filters-button"
          />
          <div className="hidden min-w-0 flex-1 sm:block" />
          <KeyboardHint keys={h.keysNoEscalate} testId="home-keys" />
        </div>
        {moreOpen && (
          <div
            id="home-more-filters"
            className="flex flex-col gap-2 bg-neutral-50 p-3 sm:flex-row sm:flex-nowrap sm:items-center"
            data-testid="home-more-filters"
          >
            {moreFilters.map(renderFilter)}
          </div>
        )}
        <FilterChips
          chips={chips}
          onClearAll={() => set(Object.fromEntries(FILTER_KEYS.map(k => [k, null])))}
          testId="home-chips"
        />
      </div>

      {sessions.isError && !page ? (
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={h.loadFailed}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
        />
      ) : !page ? (
        <LoadingBlock lines={6} />
      ) : shown.length === 0 ? (
        <EmptyPanel title={t.empty.title} message={t.empty.message} />
      ) : (
        <div ref={listRef} className="flex flex-col gap-5" data-testid="home-list">
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
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {page && shown.length > 0 && (
        <div
          className="flex flex-nowrap items-center gap-4 text-sm text-neutral-700"
          data-testid="home-paging"
        >
          <span className="shrink-0">{h.showing(shown.length, page.counts.all)}</span>
          {shown.length < page.counts.all &&
            (limit < MAX_LIMIT ? (
              <button
                type="button"
                className="shrink-0 font-semibold text-primary-500"
                disabled={sessions.isFetching}
                onClick={() => setLimit(l => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
              >
                {h.showMore(Math.min(PAGE_SIZE, page.counts.all - shown.length))}
              </button>
            ) : (
              <span className="min-w-0 truncate">{h.narrowFilters}</span>
            ))}
        </div>
      )}
    </div>
  );
};

const PAGE_SIZE = 50;
const MAX_LIMIT = 1000;
