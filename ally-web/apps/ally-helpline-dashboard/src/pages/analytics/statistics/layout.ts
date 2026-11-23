import type { StatisticsChartEntry } from "@types";

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
 *   or retired chart), drop duplicates. A chart the organisation has since lost
 *   eligibility for is KEPT (its card says it is unavailable) rather than
 *   vanishing. Charts the admin never added are never appended.
 */
export const resolveDashboardLayout = (
  saved: unknown,
  charts: readonly StatisticsChartEntry[],
): string[] => {
  if (!Array.isArray(saved)) return buildDefaultLayout(charts);
  const offered = new Set(charts.map(c => c.id));
  const seen = new Set<string>();
  const out: string[] = [];
  saved.forEach(id => {
    if (typeof id === "string" && offered.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  });
  return out;
};
