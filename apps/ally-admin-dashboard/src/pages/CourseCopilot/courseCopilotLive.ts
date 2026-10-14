import { CourseCopilotEvent, CourseOutline, CourseOutlineItem } from "@types";

/** Dollars as the header and banners show them. A missing or NaN figure reads as $0.00, not "$NaN". */
export const formatUsd = (value: number | null | undefined): string => {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(2)}`;
};

/**
 * Folds the events the socket pushed into the ones the detail endpoint returned, de-duplicated by
 * seq and in seq order. The detail is the source of truth; the socket only gets its rows to the
 * activity list a few hundred milliseconds sooner than the debounced refetch would.
 */
export const mergeEvents = (
  base: CourseCopilotEvent[],
  extra: CourseCopilotEvent[],
): CourseCopilotEvent[] => {
  const safeBase = Array.isArray(base) ? base : [];
  if (!extra.length) return safeBase;
  const bySeq = new Map<number, CourseCopilotEvent>();
  for (const event of [...safeBase, ...extra]) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

const outlineItems = (outline: CourseOutline | null | undefined): CourseOutlineItem[] => {
  const sections = outline?.sections;
  return (Array.isArray(sections) ? sections : []).flatMap(section =>
    Array.isArray(section.items) ? section.items : [],
  );
};

/**
 * Ids of the items a `course_patch` changed, by diffing the patch's outline against the one the
 * page was showing: new items, and items whose content differs. `order` is left out of the
 * comparison — inserting one item renumbers every item after it, and flashing the whole tail of
 * the course for a one-item edit would bury the one that actually changed.
 */
export const changedItemIds = (
  previous: CourseOutline | null | undefined,
  next: CourseOutline | null | undefined,
): string[] => {
  const signature = (item: CourseOutlineItem) => JSON.stringify({ ...item, order: 0 });
  const before = new Map(outlineItems(previous).map(item => [item.id, signature(item)]));
  return outlineItems(next)
    .filter(item => before.get(item.id) !== signature(item))
    .map(item => item.id);
};
