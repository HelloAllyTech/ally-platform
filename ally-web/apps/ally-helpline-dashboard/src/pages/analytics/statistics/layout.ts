import type {
  StatisticsChartEntry,
  StatisticsFilterKey,
  StatisticsFilterValues,
  StatisticsViewConfig,
} from "@types";

/**
 * What a person sees on each Statistics tab, and in what order. Pure functions,
 * so the rules are testable without rendering.
 *
 * A saved layout is an ordered list of card keys per tab. ABSENT means "never
 * customised": the tab's default layout applies. An EMPTY list means the person
 * removed everything, which is a choice and is kept.
 */

/** Preferences key for the layouts: `{ organisation, course, learner, pins }`, each a list of card keys. */
export const STATISTICS_LAYOUTS_PREF_KEY = "statistics_layouts";
/** The older single list, read as the Organisation layout. */
export const STATISTICS_LEGACY_LAYOUT_PREF_KEY = "statistics_dashboard";
/** Preferences key for the course and learner last chosen. */
export const STATISTICS_SUBJECTS_PREF_KEY = "statistics_subjects";

export type StatisticsLayoutKey = "organisation" | "course" | "learner" | "pins" | "customers";
export type SavedLayouts = Partial<Record<StatisticsLayoutKey, string[]>>;

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

/** Every chart id a view lists, in section order. */
export const viewChartIds = (view: StatisticsViewConfig): string[] =>
  view.sections.flatMap(section => section.charts);

/** The section a chart is in on a view, or undefined when the view does not list it. */
export const sectionOf = (view: StatisticsViewConfig, chartId: string) =>
  view.sections.find(section => section.charts.includes(chartId));

/**
 * The default layout for a tab: every chart of the view that the organisation can
 * fill (enough data, or a small sample that shows counts only), in section order.
 * A chart it cannot fill is not drawn as an empty box; it waits in the library
 * with the reason. A person removes, reorders and brings back charts from there.
 */
export const buildDefaultLayout = (
  view: StatisticsViewConfig,
  charts: readonly StatisticsChartEntry[],
): string[] => {
  const fillable = new Set(charts.filter(c => c.state !== "unavailable").map(c => c.id));
  return viewChartIds(view).filter(id => fillable.has(id));
};

/**
 * The card keys to draw on a tab, in order.
 *
 * - Nothing saved: the default layout.
 * - Saved: keep the saved order; drop a chart the view does not list or the
 *   backend no longer offers, drop a filter the card no longer offers, and drop
 *   a chart that appears twice (a chart is on a tab once). A chart the
 *   organisation has since lost eligibility for is KEPT (its card says it is
 *   unavailable). Charts the person never added are never appended.
 */
export const resolveViewLayout = (
  saved: unknown,
  view: StatisticsViewConfig,
  charts: readonly StatisticsChartEntry[],
): string[] => {
  if (!Array.isArray(saved)) return buildDefaultLayout(view, charts);
  const offered = new Map(charts.map(c => [c.id, c]));
  const listed = new Set(viewChartIds(view));
  const seen = new Set<string>();
  const out: string[] = [];
  saved.forEach(key => {
    const item = typeof key === "string" ? parseLayoutKey(key) : null;
    const entry = item ? offered.get(item.id) : undefined;
    if (!item || !entry || !listed.has(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    const allowed = new Set(entry.filters.map(f => f.key));
    const kept: StatisticsFilterValues = {};
    FILTER_KEYS.forEach(k => {
      if (item.filters[k] && allowed.has(k)) kept[k] = item.filters[k];
    });
    out.push(layoutKey(item.id, kept));
  });
  return out;
};

/**
 * The pinned cards, in order. `canPin` says whether a chart can be drawn as a
 * pinned card (it is a property of the chart's renderer, so it is passed in).
 */
export const resolvePins = (
  saved: unknown,
  charts: readonly StatisticsChartEntry[],
  canPin: (chartId: string) => boolean,
  /** Pinned when the person has never saved a list (not when they saved an empty one). */
  defaults: readonly string[] = [],
): string[] => {
  const fromDefaults = !Array.isArray(saved);
  const list: unknown[] = Array.isArray(saved) ? saved : [...defaults];
  const offered = new Set(
    charts.filter(c => !fromDefaults || c.state !== "unavailable").map(c => c.id),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  list.forEach(key => {
    const item = typeof key === "string" ? parseLayoutKey(key) : null;
    if (!item || !offered.has(item.id) || !canPin(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item.key);
  });
  return out;
};

/** One tab's saved layout, reading the older single list for Organisation. */
export const savedLayoutFor = (
  prefs: Record<string, unknown> | null | undefined,
  tab: StatisticsLayoutKey,
): unknown => {
  const layouts = prefs?.[STATISTICS_LAYOUTS_PREF_KEY] as SavedLayouts | undefined;
  if (layouts && Array.isArray(layouts[tab])) return layouts[tab];
  return tab === "organisation" ? prefs?.[STATISTICS_LEGACY_LAYOUT_PREF_KEY] : undefined;
};

/**
 * An older single-list layout, put into section order. The old page had no
 * sections, so its order would repeat headings; grouping keeps what the person
 * had and arranges it under the headings once. Their own arranging afterwards is kept as it is.
 */
export const groupBySection = (view: StatisticsViewConfig, keys: readonly string[]): string[] => {
  const rank = (key: string) => {
    const item = parseLayoutKey(key);
    const index = item ? view.sections.findIndex(s => s.charts.includes(item.id)) : -1;
    return index === -1 ? view.sections.length : index;
  };
  return keys
    .map((key, position) => ({ key, position, rank: rank(key) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map(entry => entry.key);
};

/**
 * A chart put into a layout at the end of its own section, leaving the rest of
 * the person's arrangement as it is. Used to show a chart a link points at when
 * they have not put it on the tab.
 */
export const insertIntoSection = (
  view: StatisticsViewConfig,
  keys: readonly string[],
  chartId: string,
): string[] => {
  const sections = view.sections.map(s => s.charts);
  const own = sections.findIndex(charts => charts.includes(chartId));
  if (own === -1 || keys.some(k => parseLayoutKey(k)?.id === chartId)) return [...keys];
  const rank = (key: string) => {
    const item = parseLayoutKey(key);
    return item ? sections.findIndex(charts => charts.includes(item.id)) : -1;
  };
  let at = keys.length;
  for (let i = 0; i < keys.length; i += 1) {
    if (rank(keys[i]) > own) {
      at = i;
      break;
    }
  }
  return [...keys.slice(0, at), chartId, ...keys.slice(at)];
};

/** True when a tab's layout comes from the older single list rather than one saved for the tab. */
export const isLegacyLayout = (
  prefs: Record<string, unknown> | null | undefined,
  tab: StatisticsLayoutKey,
): boolean => {
  const layouts = prefs?.[STATISTICS_LAYOUTS_PREF_KEY] as SavedLayouts | undefined;
  return (
    tab === "organisation" &&
    !(layouts && Array.isArray(layouts.organisation)) &&
    Array.isArray(prefs?.[STATISTICS_LEGACY_LAYOUT_PREF_KEY])
  );
};

/** The headings to draw: a card whose section differs from the one before it starts a new run. */
export const sectionRuns = (view: StatisticsViewConfig, items: readonly LayoutItem[]) => {
  const runs: Array<{ section: string; subject: boolean; items: LayoutItem[] }> = [];
  items.forEach(item => {
    const section = sectionOf(view, item.id);
    if (!section) return;
    const last = runs[runs.length - 1];
    if (last && last.section === section.key) last.items.push(item);
    else runs.push({ section: section.key, subject: section.subject, items: [item] });
  });
  return runs;
};
