/**
 * The sixteen analytics tabs, grouped by who reads them and what they are for.
 * A flat row of sixteen made every tab equally hard to find; the group row
 * answers "which kind of question" first, then the tabs answer "which one".
 *
 * Order matters: the first group is the landing one, and tab order within a
 * group follows this list. A tab not listed lands in the last group so a new tab
 * is never invisible.
 */
export interface AnalyticsTabGroup {
  id: string;
  label: string;
  blurb: string;
  tabIds: string[];
}

export const ANALYTICS_TAB_GROUPS: AnalyticsTabGroup[] = [
  {
    id: "product",
    label: "Product & learners",
    blurb: "How learners use Ally and what they think of it.",
    tabIds: ["highlights", "ratings-comments", "ally", "debriefs", "scribe"],
  },
  {
    id: "quality",
    label: "Simulator quality",
    blurb: "How well the AI actors, voices and language hold up.",
    tabIds: ["weak-metrics", "latency", "drift", "language", "glossary", "retrieval-quality"],
  },
  {
    id: "cost",
    label: "Cost & engineering",
    blurb: "What the platform and our coding agents cost to run.",
    tabIds: ["cost", "bug-agent-performance"],
  },
  {
    id: "planning",
    label: "Planning (internal)",
    blurb: "Our own delivery, plus the ask-anything agent, its audit and the weekly automation.",
    tabIds: ["product", "agent", "audit", "automation"],
  },
];

export const groupForTab = (tabId: string): AnalyticsTabGroup =>
  ANALYTICS_TAB_GROUPS.find(g => g.tabIds.includes(tabId)) ??
  ANALYTICS_TAB_GROUPS[ANALYTICS_TAB_GROUPS.length - 1];

/** Keep only the tabs the reader may see, ordered as the group lists them. */
export const tabsInGroup = <T extends { id: string }>(group: AnalyticsTabGroup, tabs: T[]): T[] =>
  group.tabIds.map(id => tabs.find(t => t.id === id)).filter((t): t is T => !!t);
