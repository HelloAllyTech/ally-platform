import type { RoadmapItemRow } from "@types";

/**
 * To do grouped by the Owner's next step (idea-to-plan audit rec 9). The Owner's To do only: it is
 * the triage list (TriageView), shown to whoever can review; everyone else's To do stays one ranked
 * list, because these groups are the Owner's next moves, not stages anyone else acts on.
 *
 * - Review: submitted, waiting for Start planning or Decline.
 * - Plan next: the ten highest-ranked accepted ideas nobody is planning yet.
 * - Planning in progress: Start planning was pressed; the plan is not closed.
 * - Plan closed: waiting for a builder.
 * - Later: every other accepted idea.
 */
export type TodoGroupKey = "review" | "planNext" | "planning" | "planClosed" | "later";

export const TODO_GROUP_ORDER: TodoGroupKey[] = [
  "review",
  "planNext",
  "planning",
  "planClosed",
  "later",
];

/** How many accepted ideas Plan next holds, by rank. */
export const PLAN_NEXT_SIZE = 10;

/** Groups whose rows wait on the Owner: their age turns amber like a review's does. */
export const WAITING_GROUPS: TodoGroupKey[] = ["review", "planning", "planClosed"];

export interface TodoGroup {
  key: TodoGroupKey;
  rows: RoadmapItemRow[];
}

const planClosed = (row: RoadmapItemRow): boolean =>
  !!(row.statusParts as { planClosed?: unknown } | undefined)?.planClosed;

/** Which group a row is in, before the rank split of accepted ideas. */
const baseGroup = (row: RoadmapItemRow): TodoGroupKey => {
  if (row.shownStage === "submitted") return "review";
  if (row.shownStage === "planning") return planClosed(row) ? "planClosed" : "planning";
  return "later";
};

const rankOf = (row: RoadmapItemRow): number =>
  typeof row.queueRank === "number" ? row.queueRank : Number.POSITIVE_INFINITY;

/**
 * Pure: the rows in their groups, in group order, each group keeping the order the rows came in
 * (the list's sort). Plan next is picked by rank whatever the sort. Every group is returned, empty
 * or not, so the page can decide what an empty group shows.
 */
export const todoGroups = (rows: RoadmapItemRow[]): TodoGroup[] => {
  const accepted = rows.filter(row => baseGroup(row) === "later");
  const next = new Set(
    [...accepted]
      .sort((a, b) => rankOf(a) - rankOf(b))
      .slice(0, PLAN_NEXT_SIZE)
      .map(row => row.code),
  );
  const byKey = new Map<TodoGroupKey, RoadmapItemRow[]>(TODO_GROUP_ORDER.map(key => [key, []]));
  for (const row of rows) {
    const base = baseGroup(row);
    const key = base === "later" && next.has(row.code) ? "planNext" : base;
    byKey.get(key)!.push(row);
  }
  return TODO_GROUP_ORDER.map(key => ({ key, rows: byKey.get(key) ?? [] }));
};
