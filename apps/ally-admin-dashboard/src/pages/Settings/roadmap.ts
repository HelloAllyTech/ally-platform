import type { PublicRoadmapCategory, PublicRoadmapItem, PublicRoadmapStage } from "@api";

/**
 * The public roadmap's fixed axes, in page order. The public page
 * (ally-helpline-dashboard `pages/blog/roadmapContent.ts`) and ally-be
 * (`public-roadmap.constants.ts`) hold the same lists; a new stage or category
 * means changing all three.
 */
export const ROADMAP_CATEGORIES: PublicRoadmapCategory[] = ["prepare", "perform"];

export const ROADMAP_STAGES: PublicRoadmapStage[] = ["idea", "lab", "beta", "released", "stable"];

/** Mirrors the column widths in ally-be's `public_roadmap_items`. */
export const ROADMAP_LIMITS = { title: 60, description: 200, note: 40 } as const;

export const ROADMAP_PUBLIC_PATH = "/blog/roadmap";

export type RoadmapCells = Record<
  PublicRoadmapCategory,
  Record<PublicRoadmapStage, PublicRoadmapItem[]>
>;

/** Cards sorted into their category × stage cells, each top to bottom. */
export const groupRoadmapItems = (items: PublicRoadmapItem[]): RoadmapCells => {
  const cells = Object.fromEntries(
    ROADMAP_CATEGORIES.map(category => [
      category,
      Object.fromEntries(ROADMAP_STAGES.map(stage => [stage, [] as PublicRoadmapItem[]])),
    ]),
  ) as RoadmapCells;

  for (const item of items) cells[item.category]?.[item.stage]?.push(item);

  for (const byStage of Object.values(cells)) {
    for (const cell of Object.values(byStage)) cell.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return cells;
};

/**
 * The cell's ids with one card moved a step up (-1) or down (+1) — the whole
 * cell, because that is what the reorder endpoint takes. Null at either end.
 */
export const reorderedIds = (
  cell: PublicRoadmapItem[],
  id: string,
  direction: -1 | 1,
): string[] | null => {
  const from = cell.findIndex(item => item.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= cell.length) return null;

  const ids = cell.map(item => item.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
};
