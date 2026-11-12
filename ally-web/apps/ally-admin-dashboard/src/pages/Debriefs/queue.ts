import {
  DebriefHomeCategoryParam,
  DebriefSessionListItem,
  DebriefSessionsPage,
  DebriefSessionsQuery,
} from "@types";

/**
 * The Debriefs home's categories, in the order the switcher shows them. "Escalated to you" shows
 * only to someone who receives escalations; "Agreement sample" only to whoever gives verdicts (the
 * clinical advisor).
 */
export const HOME_CATEGORIES = [
  "needs",
  "escalated",
  "flagged",
  "below",
  "published",
  "all",
  "agreement",
] as const;
export type HomeCategory = (typeof HOME_CATEGORIES)[number];

export type SessionItem = DebriefSessionListItem;

/** The home's category as ally-be names it. */
export const CATEGORY_PARAM: Record<HomeCategory, DebriefHomeCategoryParam> = {
  needs: "needs",
  escalated: "escalated",
  flagged: "flagged",
  below: "below",
  published: "published",
  all: "all",
  agreement: "agreement_sample",
};

/** A category's count from ally-be's `counts` (null when the viewer can't see it). */
export const categoryCount = (
  counts: DebriefSessionsPage["counts"] | undefined,
  cat: HomeCategory,
): number | null => {
  if (!counts) return null;
  if (cat === "agreement") return counts.agreementSample ?? null;
  return counts[cat];
};

/** The home's filter row, as ally-be's `sessions` query takes it. Empty means "all". */
export const FILTER_KEYS = [
  "tenantId",
  "language",
  "recipe",
  "fallback",
  "riskCue",
  "cost",
] as const;
export type HomeFilters = Pick<DebriefSessionsQuery, (typeof FILTER_KEYS)[number]>;

/** Which categories this viewer gets. */
export const categoriesFor = (opts: { escalations: boolean; verdict?: boolean }): HomeCategory[] =>
  HOME_CATEGORIES.filter(
    c => (c !== "escalated" || opts.escalations) && (c !== "agreement" || !!opts.verdict),
  );

/**
 * The home's state lives in the URL, so a link (and Back) opens exactly there and the session
 * page's Previous / Next read the same list.
 */
export const readHomeState = (
  params: URLSearchParams,
  allowed: HomeCategory[],
  fallback: HomeCategory = "needs",
): { cat: HomeCategory; filters: HomeFilters; list: boolean } => {
  const raw = params.get("cat") as HomeCategory | null;
  const cat = raw && allowed.includes(raw) ? raw : fallback;
  const filters: HomeFilters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) (filters as Record<string, string>)[k] = v;
  }
  return { cat, filters, list: params.get("view") === "list" };
};

/**
 * Where the home opens with no category in the link. A clinical advisor who is not on the Ally
 * team has nothing to do in "Needs a person" (the team's queue): they open on "Escalated to you",
 * or "Agreement sample" when they get no escalations.
 */
export const defaultCategory = (access: {
  team: boolean;
  owner: boolean;
  advisor: boolean;
  receivesEscalations: boolean;
  verdict?: boolean;
}): HomeCategory => {
  if (access.team || access.owner || !access.advisor) return "needs";
  if (access.receivesEscalations) return "escalated";
  return access.verdict ? "agreement" : "needs";
};

/** The query for a category and its filters. */
export const sessionsQuery = (cat: HomeCategory, filters: HomeFilters): DebriefSessionsQuery => ({
  category: CATEGORY_PARAM[cat],
  ...filters,
});

/**
 * Queue order (build notes item 1), as ally-be sends it: rank 0 urgent → 1 other flags → 2 below
 * the bar → 3 the rest, the longest wait first within a rank. Kept here so the order the home
 * shows never depends on the transport.
 */
export const queueOrder = (items: SessionItem[]): SessionItem[] =>
  [...items].sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.waitingSince ?? a.createdAt).localeCompare(b.waitingSince ?? b.createdAt),
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

/** Minutes, hours or days since `iso`, in words ("20 min", "2 h", "3 d"). */
export const waitedFor = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
};
