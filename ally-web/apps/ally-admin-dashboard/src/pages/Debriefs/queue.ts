import {
  DebriefCalibrationSampleItem,
  DebriefReviewFlag,
  DebriefReviewQueue,
  DebriefReviewRun,
  DebriefRunMode,
  DebriefRunRow,
  DebriefRunStatus,
} from "@types";

/** The Debriefs home's categories, in the order the switcher shows them. */
export const HOME_CATEGORIES = ["needs", "flagged", "below", "published", "all", "score"] as const;
export type HomeCategory = (typeof HOME_CATEGORIES)[number];

/** Queue order (build notes item 1): urgent flag → other flags → below the bar → the rest. */
export type QueueRank = 0 | 1 | 2 | 3;

/** One debriefed session as the home and the session page see it. */
export interface SessionItem {
  runId: string;
  sessionId: string;
  scenarioName: string | null;
  tenantName: string | null;
  language: string | null;
  recipeKey: string | null;
  mode: DebriefRunMode | null;
  status: DebriefRunStatus;
  judge: number | null;
  evaluator: number | null;
  costUsd: number | null;
  seconds: number | null;
  fallbackRung: number | null;
  createdAt: string;
  hasRiskCue: boolean;
  learnerDistress: boolean;
  flags: DebriefReviewFlag[];
  review: DebriefReviewRun | null;
  urgent: boolean;
  flagged: boolean;
  belowBar: boolean;
  escalated: boolean;
  /** In the viewer's scoring sample and not yet scored by them. */
  toScore: boolean;
  rank: QueueRank;
  /** When the oldest thing waiting on a person arrived; the run's time otherwise. */
  waitingSince: string;
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

const clampRank = (r: number | null | undefined): QueueRank | null =>
  r === null || r === undefined ? null : (Math.max(0, Math.min(3, Math.round(r))) as QueueRank);

/**
 * Merges the runs list, the review queue and the scoring sample into one item per run. ally-be's
 * own `queueRank` wins when it sends one; otherwise the rank is worked out here.
 */
export function buildSessionItems(
  runs: DebriefRunRow[] | undefined,
  review: DebriefReviewQueue | undefined,
  sample: DebriefCalibrationSampleItem[] | undefined,
): SessionItem[] {
  const toScore = new Set((sample ?? []).filter(i => !i.ratedByMe).map(i => i.scenarioSessionId));
  const flagsByRun = new Map<string, DebriefReviewFlag[]>();
  for (const f of review?.flags ?? []) {
    flagsByRun.set(f.runId, [...(flagsByRun.get(f.runId) ?? []), f]);
  }
  const reviewByRun = new Map((review?.runs ?? []).map(r => [r.id, r]));
  const out = new Map<string, SessionItem>();

  const make = (base: {
    runId: string;
    sessionId: string;
    row?: DebriefRunRow;
    rev?: DebriefReviewRun;
    flag?: DebriefReviewFlag;
  }): SessionItem => {
    const { row, rev, flag } = base;
    const flags = flagsByRun.get(base.runId) ?? [];
    const status = (row?.status ?? rev?.status ?? "published") as DebriefRunStatus;
    const judgeBelow = !!rev?.judgeBelowBar;
    const belowBar = status === "below_bar" || status === "needs_person" || judgeBelow;
    const distress = !!(row?.learnerDistress || rev?.learnerDistress);
    const urgent = flags.some(f => f.urgent);
    const computed: QueueRank =
      urgent || (distress && !!rev) ? 0 : flags.length ? 1 : rev || belowBar ? 2 : 3;
    const rank = clampRank(row?.queueRank ?? rev?.queueRank) ?? computed;
    const createdAt = row?.createdAt ?? rev?.createdAt ?? flag?.createdAt ?? "";
    const waiting = [...flags.map(f => f.createdAt), rev?.createdAt]
      .filter((x): x is string => !!x)
      .sort()[0];
    return {
      runId: base.runId,
      sessionId: base.sessionId,
      scenarioName: row?.scenarioName ?? rev?.scenarioName ?? flag?.scenarioName ?? null,
      tenantName: row?.tenantName ?? rev?.tenantName ?? flag?.tenantName ?? null,
      language: row?.language ?? rev?.language ?? flag?.language ?? null,
      recipeKey: row?.recipeKey ?? null,
      mode: row?.mode ?? null,
      status,
      judge: num(row?.judgeOverall ?? rev?.judgeOverall),
      evaluator: num(row?.evaluatorOverall ?? rev?.evaluatorOverall),
      costUsd: num(row?.costUsd),
      seconds: num(row?.seconds),
      fallbackRung: row ? row.fallbackRung : null,
      createdAt,
      hasRiskCue: !!(row?.hasRiskCue || rev?.hasRiskCue),
      learnerDistress: distress,
      flags,
      review: rev ?? null,
      urgent,
      flagged: flags.length > 0,
      belowBar,
      escalated: !!rev?.escalation || flags.some(f => f.status === "escalated"),
      toScore: toScore.has(base.sessionId),
      rank,
      waitingSince: waiting ?? createdAt,
    };
  };

  for (const row of runs ?? []) {
    out.set(
      row.id,
      make({ runId: row.id, sessionId: row.scenarioSessionId, row, rev: reviewByRun.get(row.id) }),
    );
  }
  for (const rev of review?.runs ?? []) {
    if (!out.has(rev.id)) {
      out.set(rev.id, make({ runId: rev.id, sessionId: rev.scenarioSessionId, rev }));
    }
  }
  for (const flag of review?.flags ?? []) {
    if (!out.has(flag.runId)) {
      out.set(flag.runId, make({ runId: flag.runId, sessionId: flag.scenarioSessionId, flag }));
    }
  }
  return [...out.values()];
}

export const inCategory = (item: SessionItem, cat: HomeCategory): boolean => {
  switch (cat) {
    case "needs":
      return item.rank < 3;
    case "flagged":
      return item.flagged;
    case "below":
      return item.belowBar;
    case "published":
      return item.status === "published";
    case "score":
      return item.toScore;
    default:
      return true;
  }
};

/** The home's filter row. Every value is optional; empty means "all". */
export interface HomeFilters {
  org?: string;
  language?: string;
  recipe?: string;
  /** `none` ran as written, `low` fell back one or two steps, `high` three or more. */
  fallback?: "none" | "low" | "high";
  risk?: "yes" | "no";
  /** `over` costs more than $0.20; `ceiling` hit the run ceiling. */
  cost?: "over" | "ceiling";
}

export const HIGH_COST_USD = 0.2;

export const matchesFilters = (
  item: SessionItem,
  f: HomeFilters,
  runCeilingUsd?: number | null,
): boolean => {
  if (f.org && item.tenantName !== f.org) return false;
  if (f.language && item.language !== f.language) return false;
  if (f.recipe && item.recipeKey !== f.recipe) return false;
  if (f.fallback) {
    const r = item.fallbackRung;
    if (r === null) return false;
    if (f.fallback === "none" && r !== 0) return false;
    if (f.fallback === "low" && (r < 1 || r > 2)) return false;
    if (f.fallback === "high" && r < 3) return false;
  }
  if (f.risk && item.hasRiskCue !== (f.risk === "yes")) return false;
  if (f.cost) {
    const c = item.costUsd;
    if (c === null) return false;
    if (f.cost === "over" && c <= HIGH_COST_USD) return false;
    if (f.cost === "ceiling" && (runCeilingUsd == null || c < runCeilingUsd)) return false;
  }
  return true;
};

/**
 * The order a category lists its items in. "Needs a person" is the queue: by rank, then whoever
 * has waited longest. Every other category is newest first.
 */
export const orderFor = (items: SessionItem[], cat: HomeCategory): SessionItem[] =>
  [...items].sort((a, b) =>
    cat === "needs"
      ? a.rank - b.rank || a.waitingSince.localeCompare(b.waitingSince)
      : b.createdAt.localeCompare(a.createdAt),
  );

/** The items a category shows, filtered and in order: the home and Previous / Next share it. */
export const categoryList = (
  items: SessionItem[],
  cat: HomeCategory,
  filters: HomeFilters,
  runCeilingUsd?: number | null,
): SessionItem[] =>
  orderFor(
    items.filter(i => inCategory(i, cat) && matchesFilters(i, filters, runCeilingUsd)),
    cat,
  );

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Groups a newest-first list by calendar day: "Today", "Yesterday", then the date. */
export function groupByDay(
  items: SessionItem[],
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): Array<{ label: string; items: SessionItem[] }> {
  const today = dayKey(now.toISOString());
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = dayKey(y.toISOString());
  const groups: Array<{ key: string; label: string; items: SessionItem[] }> = [];
  for (const item of items) {
    const key = item.createdAt ? dayKey(item.createdAt) : "";
    let g = groups.find(x => x.key === key);
    if (!g) {
      const label =
        key === today
          ? labels.today
          : key === yesterday
            ? labels.yesterday
            : item.createdAt
              ? new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })
              : "—";
      g = { key, label, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups.map(({ label, items: list }) => ({ label, items: list }));
}

/** Search-param keys the home keeps its state in, so a link (and Back) opens exactly there. */
export const FILTER_KEYS = ["org", "language", "recipe", "fallback", "risk", "cost"] as const;

export const readHomeState = (
  params: URLSearchParams,
  canScore: boolean,
): { cat: HomeCategory; filters: HomeFilters; list: boolean } => {
  const raw = params.get("cat") as HomeCategory | null;
  const cat =
    raw && (HOME_CATEGORIES as readonly string[]).includes(raw) && (raw !== "score" || canScore)
      ? raw
      : "needs";
  const filters: HomeFilters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) (filters as Record<string, string>)[k] = v;
  }
  return { cat, filters, list: params.get("view") === "list" };
};

/** Minutes, hours or days since `iso`, in words ("20 min", "2 h", "3 d"). */
export const waitedFor = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
};
