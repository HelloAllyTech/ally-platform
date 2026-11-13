import React, { useEffect, useMemo, useRef, useState } from "react";

import { BarChart3 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import {
  useEscalateDebriefMutation,
  useGetDebriefAttentionQuery,
  useGetDebriefSessionsQuery,
} from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefAttention } from "@types";
import { getErrorMessage } from "@utils";

import { languageLabel, recipeLabel } from "../consoleLabels";
import {
  ANALYTICS_DEBRIEFS_TAB,
  analyticsDebriefsPath,
  pmAgentPath,
  settingsPath,
} from "../consoleRoutes";
import {
  FilterChip,
  FilterChips,
  KeyboardHint,
  MoreActions,
  MoreFiltersButton,
} from "../consoleRows";
import { AlertBanner } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import {
  categoriesFor,
  categoryCount,
  FILTER_KEYS,
  blindToChecks,
  defaultCategory,
  groupByDay,
  queueNoteFor,
  queueOrder,
  readHomeState,
  sessionsQuery,
  waitedFor,
} from "../queue";
import { SessionCard, SessionRow } from "./SessionCard";

/** A session link that keeps the home's category and filters, so Back returns there. */
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

type Banner = DebriefAttention["banners"][number];

/** Where a banner's link goes. Banners link to the thing to read; they never act. */
export const bannerHref = (b: Banner): string => {
  if (b.kind === "release_waiting") return pmAgentPath("releases");
  switch (b.link.page) {
    case "session":
      return b.link.runId ? ROUTES.DEBRIEF_SESSION(b.link.runId) : ROUTES.DEBRIEFS;
    case "pm_agent":
      return pmAgentPath("ideas", b.link.ideaId);
    case "settings":
      return settingsPath(b.kind === "cap" ? "budget" : undefined);
    case "analytics":
      return `${ROUTES.ANALYTICS}?tab=${ANALYTICS_DEBRIEFS_TAB}`;
    default:
      return `${ROUTES.DEBRIEFS}${b.link.category ? `?cat=${b.link.category === "agreement_sample" ? "agreement" : b.link.category}` : ""}`;
  }
};

/** A banner in the console's words; ally-be's sentence only for a kind this build doesn't know. */
export const bannerText = (b: Banner): string => {
  const t = en.debriefs.home.banners;
  const n = b.count ?? 1;
  const waited = b.oldestSince ? waitedFor(b.oldestSince) : null;
  switch (b.kind) {
    case "urgent":
      return t.urgent(n, waited);
    case "held":
      return t.held(n, waited, !!b.overdue);
    case "escalated":
      return t.escalated(n);
    case "canary_reverted":
      return t.reverted(n);
    case "approval_expiring":
      return t.expiring(n);
    case "agent_off":
      return t.off;
    case "cap":
      return t.cap(b.level === "red");
    case "provider_down":
      return t.provider;
    case "language_not_recorded":
      return t.language;
    case "release_waiting":
      return t.releaseWaiting(n);
    default:
      return b.message;
  }
};

const BANNER_ACTION: Record<string, keyof typeof en.debriefs.home.bannerActions> = {
  session: "open",
  home: "show",
  pm_agent: "answer",
  settings: "settings",
  analytics: "analytics",
};

/**
 * The Debriefs home (redesign 2026-11-12): every debriefed session as a card, by category, the
 * queue of what needs a person first. Opening one goes to its session page.
 */
export const DebriefsHome: React.FC = () => {
  const h = en.debriefs.home;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [polling, setPolling] = useState(false);
  // More filters starts open when one of the filters behind it is set, so a shared link shows it.
  const [moreOpen, setMoreOpen] = useState(() =>
    ["fallback", "riskCue", "cost"].some(k => params.get(k)),
  );
  const attention = useGetDebriefAttentionQuery(undefined, { pollingInterval: 60_000 });
  // The access before the list has said: the attention payload, then the user's permissions.
  const preAccess = useDebriefAccess(attention.data?.viewer);
  const allowedBefore = categoriesFor({
    escalations: preAccess.receivesEscalations,
    verdict: preAccess.verdict,
    team: !blindToChecks(preAccess),
  });
  const { cat, filters, list } = readHomeState(
    params,
    [...allowedBefore, "escalated", "agreement"],
    defaultCategory(preAccess),
  );
  // Fresh on every visit, and every 15 s while a debrief is being written.
  const sessions = useGetDebriefSessionsQuery(sessionsQuery(cat, filters), {
    refetchOnMountOrArgChange: true,
    pollingInterval: polling ? 15_000 : 0,
  });
  const page = sessions.data;
  const access = useDebriefAccess(page?.viewer ?? attention.data?.viewer);
  // Blind to the checks until their verdict (the clinical advisor): no hint of the result.
  const blind = blindToChecks(access);
  const anyRunning = !!page?.items.some(r => r.status === "running" || r.status === "queued");
  if (anyRunning !== polling) setPolling(anyRunning);
  const [escalate] = useEscalateDebriefMutation();

  const categories = useMemo(
    () =>
      categoriesFor({
        escalations: access.receivesEscalations,
        verdict: access.verdict,
        team: !blind,
      }),
    [access.receivesEscalations, access.verdict, blind],
  );

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // ally-be sends the queue in order; it is kept in that order whatever the transport did.
  const shown = useMemo(() => {
    const items = page?.items ?? [];
    return cat === "needs" || cat === "escalated" ? queueOrder(items) : items;
  }, [page, cat]);
  const queue = cat === "needs" || cat === "escalated";
  const queueNote = queueNoteFor(cat, blind, { team: h.queueNote, blind: h.queueNoteBlind });
  const groups = queue
    ? shown.length
      ? [{ label: h.inOrder, items: shown }]
      : []
    : groupByDay(shown, { today: h.today, yesterday: h.yesterday });

  // j / k move through what is shown, Enter opens it, e escalates it (the Ally team only).
  // One "Show" dropdown instead of a row of buttons (design B1, 2026-11-13): each view with its count.
  const categoryItems: Item[] = categories.map(c => {
    const n = categoryCount(page?.counts, c);
    return { id: c, label: n == null ? h.categories[c] : `${h.categories[c]} (${n})` };
  });
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
      } else if (e.key === "e" && access.escalate && current.needsPerson && !current.escalated) {
        e.preventDefault();
        escalate({ kind: "runs", id: current.runId })
          .unwrap()
          .then(() => toast.success(en.debriefs.review.escalatedDone))
          .catch(err => toast.error(getErrorMessage(err, en.debriefs.review.failed)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, navigate, params, access.escalate, escalate]);

  const needsYou = attention.data?.counts.pmAgentNeedsYou ?? 0;
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
        (options?.tenants ?? []).map(t => ({ id: t.id, label: t.name })),
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
        <p className="text-[15px] text-neutral-600">{h.intro}</p>
      </header>

      {(attention.data?.banners ?? []).map((b, i) => (
        <AlertBanner
          key={`${b.kind}-${i}`}
          kind={b.level === "red" ? "error" : "warning"}
          testId={`home-banner-${b.kind}`}
          action={
            <Link
              to={bannerHref(b)}
              className={
                b.level === "red" && b.link.page === "session"
                  ? "inline-flex h-9 items-center rounded-sm bg-destructive-500 px-3.5 text-sm font-semibold text-white no-underline"
                  : "text-sm font-semibold"
              }
            >
              {
                h.bannerActions[
                  b.kind === "release_waiting" ? "releases" : (BANNER_ACTION[b.link.page] ?? "show")
                ]
              }
            </Link>
          }
        >
          {bannerText(b)}
        </AlertBanner>
      ))}

      {/* One row at lg and up: Show, then layout, Analytics and PM agent; Settings goes in More.
          Below lg the actions take a second row, on purpose (design B1, 2026-11-13). */}
      <div
        className="flex flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-center"
        data-testid="home-toolbar"
      >
        <div className="min-w-[16rem] lg:shrink-0" data-testid="home-category">
          <Dropdown
            id="debriefs-category"
            type="inline"
            size="md"
            titleText={h.showLabel}
            label={h.showLabel}
            items={categoryItems}
            selectedItem={categoryItems.find(o => o.id === cat) ?? categoryItems[0]}
            itemToString={(o: Item | null) => o?.label ?? ""}
            onChange={({ selectedItem }: { selectedItem: Item | null }) => {
              const c = (selectedItem?.id ?? defaultCategory(preAccess)) as typeof cat;
              set({ cat: c === defaultCategory(preAccess) ? null : c });
            }}
          />
        </div>
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
          <Link
            to={analyticsDebriefsPath()}
            data-testid="analytics-button"
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
          >
            <BarChart3 aria-hidden="true" className="h-4 w-4" />
            {h.analytics}
          </Link>
          <Link
            to={pmAgentPath()}
            data-testid="pm-agent-button"
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
          >
            {h.pmAgent}
            {needsYou > 0 && (
              <span
                aria-label={h.needsYouCount(needsYou)}
                data-testid="pm-needs-you"
                className="rounded-full bg-primary-500 px-[7px] py-px text-[11px] font-semibold text-white"
              >
                {needsYou}
              </span>
            )}
          </Link>
          <MoreActions
            testId="home-more"
            items={[{ id: "settings", label: h.settings, to: settingsPath() }]}
          />
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
          <KeyboardHint keys={access.escalate ? h.keys : h.keysNoEscalate} testId="home-keys" />
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

      {queueNote && shown.length > 0 && (
        <p className="text-sm text-neutral-700" data-testid="queue-note">
          {queueNote}
        </p>
      )}

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
        <EmptyPanel
          title={((blind && h.emptyBlind[cat]) || h.empty[cat]).title}
          message={((blind && h.emptyBlind[cat]) || h.empty[cat]).message}
        />
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
    </div>
  );
};
