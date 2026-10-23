import type { RoadmapCard, RoadmapCategory, RoadmapStage } from "@api";

/**
 * The public roadmap's fixed frame: its two categories (rows) and five
 * maturity stages (columns), with the copy that explains each. Only the cards
 * placed in this grid are data — they are edited from the admin console's
 * Settings → Roadmap tab. Changing a stage or category means changing this
 * file and ally-be's `public-roadmap.constants.ts` together.
 */

export const ROADMAP_HEADLINE = "From the practice room to the field.";

export const ROADMAP_INTRO =
  "What we are building to prepare frontline mental health workers, and to support them as they perform — voice-first, in their own languages.";

export type StageInfo = { id: RoadmapStage; label: string; description: string };

/** Least to most mature — the order of the page's columns and of the dots. */
export const ROADMAP_STAGES: StageInfo[] = [
  { id: "idea", label: "Idea", description: "Worth exploring. Not yet built." },
  { id: "lab", label: "Lab", description: "Prototyping and testing with a small group." },
  { id: "beta", label: "Beta", description: "Live with early partners and learners." },
  { id: "released", label: "Released", description: "Available to every partner." },
  { id: "stable", label: "Stable", description: "Mature, dependable, running at scale." },
];

export type CategoryInfo = { id: RoadmapCategory; label: string; description: string };

export const ROADMAP_CATEGORIES: CategoryInfo[] = [
  {
    id: "prepare",
    label: "Prepare",
    description: "Training and practice before workers meet the people they serve.",
  },
  {
    id: "perform",
    label: "Perform",
    description: "Support on the job, while workers and listeners are helping people.",
  },
];

/** How many of the five maturity dots a stage fills: Idea one, Stable all five. */
export const stageLevel = (stage: RoadmapStage): number =>
  ROADMAP_STAGES.findIndex(s => s.id === stage) + 1;

export type RoadmapGrid = Record<RoadmapCategory, Record<RoadmapStage, RoadmapCard[]>>;

/**
 * Sorts cards into their category × stage cells, each cell top to bottom.
 * A card with a category or stage this build does not know is dropped rather
 * than guessed into a cell — it can only come from a newer backend.
 */
export const groupIntoGrid = (cards: RoadmapCard[]): RoadmapGrid => {
  const grid = Object.fromEntries(
    ROADMAP_CATEGORIES.map(category => [
      category.id,
      Object.fromEntries(ROADMAP_STAGES.map(stage => [stage.id, [] as RoadmapCard[]])),
    ]),
  ) as RoadmapGrid;

  for (const card of cards) grid[card.category]?.[card.stage]?.push(card);

  for (const byStage of Object.values(grid)) {
    for (const cell of Object.values(byStage)) cell.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return grid;
};
