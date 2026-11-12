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
import { AlertBanner, Segmented } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import {
  categoriesFor,
  categoryCount,
  FILTER_KEYS,
  defaultCategory,
  groupByDay,
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
      return `${ROUTES.DEBRIEFS}${b.link.category ? `?cat=${b.link.category === "to_score" ? "score" : b.link.category}` : ""}`;
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
  const attention = useGetDebriefAttentionQuery(undefined, { pollingInterval: 60_000 });
  // The access before the list has said: the attention payload, then the user's permissions.
  const preAccess = useDebriefAccess(attention.data?.viewer);
  const allowedBefore = categoriesFor({
    score: preAccess.score,
    escalations: preAccess.receivesEscalations,
  });
  const { cat, filters, list } = readHomeState(
    params,
    [...allowedBefore, "score", "escalated"],
    defaultCategory(preAccess),
  );
  // Fresh on every visit, and every 15 s while a debrief is being written.
  const sessions = useGetDebriefSessionsQuery(sessionsQuery(cat, filters), {
    refetchOnMountOrArgChange: true,
    pollingInterval: polling ? 15_000 : 0,
  });
  const page = sessions.data;
  const access = useDebriefAccess(page?.viewer ?? attention.data?.viewer);
  const anyRunning = !!page?.items.some(r => r.status === "running" || r.status === "queued");
  if (anyRunning !== polling) setPolling(anyRunning);
  const [escalate] = useEscalateDebriefMutation();

  const categories = useMemo(
    () => categoriesFor({ score: access.score, escalations: access.receivesEscalations }),
    [access.score, access.receivesEscalations],
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
  const groups = queue
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

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={h.categoriesLabel}
          value={cat}
          onChange={c => set({ cat: c === defaultCategory(preAccess) ? null : c })}
          items={categories.map(c => ({
            id: c,
            label: (
              <>
                {h.categories[c]}
                <span className="text-xs opacity-75" data-testid={`count-${c}`}>
                  {categoryCount(page?.counts, c) ?? ""}
                </span>
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
          to={analyticsDebriefsPath()}
          data-testid="analytics-button"
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
        >
          <BarChart3 aria-hidden="true" className="h-4 w-4" />
          {h.analytics}
        </Link>
        <Link
          to={pmAgentPath()}
          data-testid="pm-agent-button"
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary-500 px-3.5 text-sm font-medium text-primary-500 no-underline"
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
          value={filters.tenantId ?? ""}
          options={opts(
            "org",
            (options?.tenants ?? []).map(t => ({ id: t.id, label: t.name })),
          )}
          onChange={v => set({ tenantId: v })}
        />
        <Filter
          id="language"
          label={h.filters.language.label}
          value={filters.language ?? ""}
          options={opts(
            "language",
            (options?.languages ?? []).map(l => ({ id: l, label: languageLabel(l) })),
          )}
          onChange={v => set({ language: v })}
        />
        <Filter
          id="recipe"
          label={h.filters.recipe.label}
          value={filters.recipe ?? ""}
          options={opts(
            "recipe",
            (options?.recipes ?? []).map(r => ({ id: r, label: recipeLabel(r) })),
          )}
          onChange={v => set({ recipe: v })}
        />
        <Filter
          id="fallback"
          label={h.filters.fallback.label}
          value={filters.fallback ?? ""}
          options={opts(
            "fallback",
            (["none", "light", "heavy"] as const).map(id => ({
              id,
              label: h.filters.fallback[id],
            })),
          )}
          onChange={v => set({ fallback: v })}
        />
        <Filter
          id="risk"
          label={h.filters.risk.label}
          value={filters.riskCue ?? ""}
          options={opts(
            "risk",
            (["true", "false"] as const).map(id => ({ id, label: h.filters.risk[id] })),
          )}
          onChange={v => set({ riskCue: v })}
        />
        <Filter
          id="cost"
          label={h.filters.cost.label}
          value={filters.cost ?? ""}
          options={opts(
            "cost",
            (["over_0_20", "hit_ceiling"] as const).map(id => ({ id, label: h.filters.cost[id] })),
          )}
          onChange={v => set({ cost: v })}
        />
        <span className="ml-auto text-xs text-neutral-600" data-testid="home-keys">
          {access.escalate ? h.keys : h.keysNoEscalate}
        </span>
      </div>

      {queue && <p className="text-sm text-neutral-700">{h.queueNote}</p>}

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
        <EmptyPanel title={h.empty[cat].title} message={h.empty[cat].message} />
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
