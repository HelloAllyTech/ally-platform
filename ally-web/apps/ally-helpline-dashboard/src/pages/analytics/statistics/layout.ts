import type { StatisticsChartEntry, StatisticsFilterKey, StatisticsFilterValues } from "@types";

/**
 * Which charts a tenant admin sees on the Statistics dashboard, and in what
 * order. Pure functions, so the rule is testable without rendering.
 *
 * The saved layout is an ordered list of chart ids in the user's preferences
 * under `statistics_dashboard`. ABSENT means "never customised": the default
 * layout applies. An EMPTY list means the admin removed everything, which is a
 * choice and is kept.
 */

/** Preferences key for the saved layout (an ordered `string[]` of chart ids). */
export const STATISTICS_LAYOUT_PREF_KEY = "statistics_dashboard";

/**
 * Default layout priority, from TENANT_STATS_DESIGN.md section 8.
 *
 * The first five are the floor: they need no minimum sample, so every
 * organisation gets them. The rest are added in this order, each only if the
 * organisation meets its minimum (state `available`), until the cap. Ids not
 * yet offered by the backend are skipped, so this list can name the full
 * Release 1 order before every chart is built.
 */
export const DEFAULT_LAYOUT_ORDER: readonly string[] = [
  "TSQ-001", // Headline numbers
  "TSQ-007", // Learner status
  "TSQ-023", // Learners who need attention
  "TSQ-008", // Top learners
  "TSQ-009", // Learner table
  "TSQ-002", // Usage over time
  "TSQ-013", // Course table
  "TSQ-017", // Course completion funnel
  "TSQ-020", // Session scores
  "TSQ-024", // Skills before and after
  "TSQ-026", // Ratings and comments
  "TSQ-027", // Sessions reviewed
];

/** The filters a card can carry, in the order they are written. */
export const FILTER_KEYS: readonly StatisticsFilterKey[] = ["course", "simulation", "learner"];

export interface LayoutItem {
  /** The saved string: `TSQ-020`, or `TSQ-020?course=<id>` for a card with a filter set. */
  key: string;
  id: string;
  filters: StatisticsFilterValues;
}

const KEY_PATTERN = new RegExp(
  `^(TSQ-\\d{3})((?:[?&](?:${FILTER_KEYS.join("|")})=[A-Za-z0-9-]{1,64})*)$`,
);

/** The saved string for a card and the filters set on it. */
export const layoutKey = (id: string, filters: StatisticsFilterValues = {}): string => {
  const parts = FILTER_KEYS.filter(k => filters[k]).map(k => `${k}=${filters[k]}`);
  return parts.length ? `${id}?${parts.join("&")}` : id;
};

/** Reads a saved string; null when it is not one this build understands. */
export const parseLayoutKey = (key: string): LayoutItem | null => {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const filters: StatisticsFilterValues = {};
  match[2]
    .split(/[?&]/)
    .filter(Boolean)
    .forEach(pair => {
      const [k, v] = pair.split("=");
      filters[k as StatisticsFilterKey] = v;
    });
  return { key, id: match[1], filters };
};

/** The most cards the default layout holds. */
export const DEFAULT_LAYOUT_CAP = 10;

/** The default layout for an organisation, given the charts the backend offers. */
export const buildDefaultLayout = (charts: readonly StatisticsChartEntry[]): string[] => {
  const available = new Set(charts.filter(c => c.state === "available").map(c => c.id));
  return DEFAULT_LAYOUT_ORDER.filter(id => available.has(id)).slice(0, DEFAULT_LAYOUT_CAP);
};

/**
 * The ids to render, in order.
 *
 * - Nothing saved: the default layout.
 * - Saved: keep the saved order, drop ids the backend no longer offers (a stale
 *   or retired chart), drop a filter the card no longer offers, drop duplicates (a chart appears once). A chart the organisation has since lost
 *   eligibility for is KEPT (its card says it is unavailable) rather than
 *   vanishing. Charts the admin never added are never appended.
 */
export const resolveDashboardLayout = (
  saved: unknown,
  charts: readonly StatisticsChartEntry[],
): string[] => {
  if (!Array.isArray(saved)) return buildDefaultLayout(charts);
  const offered = new Map(charts.map(c => [c.id, c]));
  const seen = new Set<string>();
  const out: string[] = [];
  saved.forEach(key => {
    const item = typeof key === "string" ? parseLayoutKey(key) : null;
    const entry = item ? offered.get(item.id) : undefined;
    if (!item || !entry || seen.has(item.id)) return;
    seen.add(item.id);
    // Keep only the filters the card still offers; the card itself stays.
    const allowed = new Set(entry.filters.map(f => f.key));
    const kept: StatisticsFilterValues = {};
    FILTER_KEYS.forEach(k => {
      if (item.filters[k] && allowed.has(k)) kept[k] = item.filters[k];
    });
    out.push(layoutKey(item.id, kept));
  });
  return out;
};
