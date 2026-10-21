import { en } from "@constants";
import type {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBlueprintSection,
  CourseItemType,
} from "@types";

import { asArray } from "./courseCopilotFormat";
import { getItemTypeLabel } from "./courseItemMeta";

/**
 * The blueprint tree's edits as pure functions over an immutable draft.
 *
 * Kept out of the component for two reasons: the component then only wires
 * events to these (so the rules — what a type change resets, how an item crosses
 * a section boundary — are tested without a DOM), and every function here
 * tolerates the draft the agent actually produced, where a section can arrive
 * with `items` missing.
 */

/**
 * Hard ceilings the server enforces on approve (plan section 4.6). Mirrored here only so
 * the "Add" buttons stop offering what the server would refuse; the server's `problems`
 * stay the authority if these ever drift.
 */
export const BLUEPRINT_LIMITS = { sections: 8, items: 40 } as const;

/**
 * Minutes a freshly added or retyped item is planned at. The server recomputes the
 * estimate on save, so these only need to be sensible for the second or so before the
 * response lands — they are not a content decision.
 */
export const DEFAULT_ITEM_MINUTES: Record<CourseItemType, number> = {
  ARTICLE: 8,
  QUIZ: 5,
  JOURNAL: 5,
  ANNOTATED_ARTIFACT: 10,
  GAME: 3,
  BRANCHING_SCENARIO: 8,
  BUCKET_SORT: 4,
  VIDEO: 5,
  ROLEPLAY: 15,
  CASE: 30,
};

export type VideoSourceKind = "youtube" | "vimeo" | "loom" | "s3";

/** Mints an id for a new section or item. `crypto.randomUUID` is absent in insecure contexts, hence the fallback. */
export const newId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const sectionItems = (section: CourseBlueprintSection): CourseBlueprintItem[] =>
  asArray<CourseBlueprintItem>(section?.items);

/** Sections with `items` guaranteed to be an array. */
export const getSections = (blueprint: CourseBlueprint): CourseBlueprintSection[] =>
  asArray<CourseBlueprintSection>(blueprint?.sections).map(section => ({
    ...section,
    items: sectionItems(section),
  }));

export const countItems = (blueprint: CourseBlueprint): number =>
  getSections(blueprint).reduce((total, section) => total + section.items.length, 0);

const moveInArray = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

const withSections = (
  blueprint: CourseBlueprint,
  sections: CourseBlueprintSection[],
): CourseBlueprint => ({ ...blueprint, sections });

const mapSection = (
  blueprint: CourseBlueprint,
  sectionId: string,
  update: (section: CourseBlueprintSection) => CourseBlueprintSection,
): CourseBlueprint =>
  withSections(
    blueprint,
    getSections(blueprint).map(section => (section.id === sectionId ? update(section) : section)),
  );

const mapItem = (
  blueprint: CourseBlueprint,
  itemId: string,
  update: (item: CourseBlueprintItem) => CourseBlueprintItem,
): CourseBlueprint =>
  withSections(
    blueprint,
    getSections(blueprint).map(section => ({
      ...section,
      items: section.items.map(item => (item.id === itemId ? update(item) : item)),
    })),
  );

export const renameCourse = (blueprint: CourseBlueprint, title: string): CourseBlueprint => ({
  ...blueprint,
  title,
});

export const renameSection = (
  blueprint: CourseBlueprint,
  sectionId: string,
  title: string,
): CourseBlueprint => mapSection(blueprint, sectionId, section => ({ ...section, title }));

export const renameItem = (
  blueprint: CourseBlueprint,
  itemId: string,
  title: string,
): CourseBlueprint => mapItem(blueprint, itemId, item => ({ ...item, title }));

export const reorderSections = (
  blueprint: CourseBlueprint,
  from: number,
  to: number,
): CourseBlueprint => withSections(blueprint, moveInArray(getSections(blueprint), from, to));

export const reorderItems = (
  blueprint: CourseBlueprint,
  sectionId: string,
  from: number,
  to: number,
): CourseBlueprint =>
  mapSection(blueprint, sectionId, section => ({
    ...section,
    items: moveInArray(section.items, from, to),
  }));

/**
 * Move an item one step up (-1) or down (+1) through the whole course.
 *
 * Crossing a boundary is the point: dragging is scoped to one section (each section
 * owns its drag context, like the outline rail), so the up/down buttons are also how
 * an item changes section — the first item moves to the END of the previous section,
 * the last to the START of the next. Returns the blueprint unchanged at either end.
 */
export const moveItem = (
  blueprint: CourseBlueprint,
  itemId: string,
  direction: -1 | 1,
): CourseBlueprint => {
  const sections = getSections(blueprint);
  const sectionIndex = sections.findIndex(section =>
    section.items.some(item => item.id === itemId),
  );
  if (sectionIndex === -1) return blueprint;

  const section = sections[sectionIndex];
  const itemIndex = section.items.findIndex(item => item.id === itemId);
  const target = itemIndex + direction;

  if (target >= 0 && target < section.items.length) {
    return reorderItems(blueprint, section.id, itemIndex, target);
  }

  const neighbourIndex = sectionIndex + direction;
  if (neighbourIndex < 0 || neighbourIndex >= sections.length) return blueprint;

  const item = section.items[itemIndex];
  return withSections(
    blueprint,
    sections.map((candidate, index) => {
      if (index === sectionIndex) {
        return { ...candidate, items: candidate.items.filter(entry => entry.id !== itemId) };
      }
      if (index === neighbourIndex) {
        return {
          ...candidate,
          items: direction === -1 ? [...candidate.items, item] : [item, ...candidate.items],
        };
      }
      return candidate;
    }),
  );
};

export const removeItem = (blueprint: CourseBlueprint, itemId: string): CourseBlueprint =>
  withSections(
    blueprint,
    getSections(blueprint).map(section => ({
      ...section,
      items: section.items.filter(item => item.id !== itemId),
    })),
  );

export const removeSection = (blueprint: CourseBlueprint, sectionId: string): CourseBlueprint =>
  withSections(
    blueprint,
    getSections(blueprint).filter(section => section.id !== sectionId),
  );

/**
 * Switch an item to another type.
 *
 * Resets everything the old type owned: `spec` (a quiz's question mix means nothing to a
 * journal), the source (a library reference cannot follow an item into a type that has
 * no library), the completion rule (a pass mark on a game), and the minutes (an 8-minute
 * article is not a 3-minute game). The title and purpose stay — they are the trainer's
 * intent for the slot, and the copilot regenerates the content from them.
 */
export const changeItemType = (
  blueprint: CourseBlueprint,
  itemId: string,
  type: CourseItemType,
): CourseBlueprint =>
  mapItem(blueprint, itemId, item => {
    if (item.type === type) return item;
    const retyped: CourseBlueprintItem = {
      ...item,
      type,
      spec: {},
      source: { kind: "new" },
      estimatedMinutes: DEFAULT_ITEM_MINUTES[type] ?? item.estimatedMinutes,
    };
    delete retyped.completionCriteria;
    return retyped;
  });

/**
 * A video link the pane will accept, with the player it implies. Only hosts the course
 * player can actually play are accepted — the same three embeds the course editor's video
 * item takes, plus an uploaded file on our own storage — so a typo or a page URL is caught
 * here instead of failing a build job later.
 */
export const parseVideoUrl = (raw: string): { url: string; source: VideoSourceKind } | null => {
  const text = (raw ?? "").trim();
  if (!text) return null;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase();
  const isHost = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (isHost("youtube.com") || isHost("youtu.be")) return { url: text, source: "youtube" };
  if (isHost("vimeo.com")) return { url: text, source: "vimeo" };
  if (isHost("loom.com")) return { url: text, source: "loom" };
  if (isHost("amazonaws.com") || isHost("cloudfront.net")) return { url: text, source: "s3" };
  return null;
};

/**
 * Put a link on a VIDEO item. A valid link fills `spec.url` / `spec.source` and clears the
 * "needs input" marker; an empty one puts the marker back. An invalid one changes nothing,
 * so the caller can show the problem without the draft ever holding a link the build
 * would choke on.
 */
export const setVideoUrl = (
  blueprint: CourseBlueprint,
  itemId: string,
  raw: string,
): { blueprint: CourseBlueprint; valid: boolean } => {
  const text = (raw ?? "").trim();

  if (!text) {
    return {
      valid: true,
      blueprint: mapItem(blueprint, itemId, item => {
        const spec = { ...(item.spec ?? {}) };
        delete spec.url;
        delete spec.source;
        return { ...item, spec, source: { kind: "needs-input", what: "video-url" } };
      }),
    };
  }

  const parsed = parseVideoUrl(text);
  if (!parsed) return { blueprint, valid: false };

  return {
    valid: true,
    blueprint: mapItem(blueprint, itemId, item => ({
      ...item,
      spec: { ...(item.spec ?? {}), url: parsed.url, source: parsed.source },
      source: { kind: "new" },
    })),
  };
};

export const createItem = (type: CourseItemType, id: string = newId()): CourseBlueprintItem => ({
  id,
  type,
  title: en.courseCopilotPane.blueprint.newItemTitle(getItemTypeLabel(type)),
  purpose: "",
  objectiveRefs: [],
  estimatedMinutes: DEFAULT_ITEM_MINUTES[type],
  // A video cannot be built without a link — mark it so the tree asks for one instead of
  // letting the build discover it.
  source: type === "VIDEO" ? { kind: "needs-input", what: "video-url" } : { kind: "new" },
  spec: {},
});

export const addItem = (
  blueprint: CourseBlueprint,
  sectionId: string,
  item: CourseBlueprintItem,
): CourseBlueprint =>
  mapSection(blueprint, sectionId, section => ({ ...section, items: [...section.items, item] }));

export const createSection = (id: string = newId()): CourseBlueprintSection => ({
  id,
  title: en.courseCopilotPane.blueprint.newSectionTitle,
  description: "",
  purpose: "",
  items: [],
});

export const addSection = (
  blueprint: CourseBlueprint,
  section: CourseBlueprintSection,
): CourseBlueprint => withSections(blueprint, [...getSections(blueprint), section]);

export interface BlueprintTotals {
  minutes: number;
  items: number;
  sections: number;
}

/** Totals the footer shows between a save landing: the tree is the truth, not the last estimate. */
export const computeTotals = (blueprint: CourseBlueprint): BlueprintTotals => {
  const sections = getSections(blueprint);
  let minutes = 0;
  let items = 0;
  for (const section of sections) {
    for (const item of section.items) {
      items += 1;
      minutes += Number.isFinite(item.estimatedMinutes) ? item.estimatedMinutes : 0;
    }
  }
  return { minutes, items, sections: sections.length };
};

/**
 * Problems visible from the draft alone — what the footer says while an edit has not
 * yet been through the server. Once a save lands, the server's own `problems` replace
 * these: it is the authority, this is only the early, cheap hint.
 */
export const findBlueprintProblems = (blueprint: CourseBlueprint): string[] => {
  const strings = en.courseCopilotPane.blueprint.problems;
  const sections = getSections(blueprint);
  const problems: string[] = [];

  if (sections.length === 0) problems.push(strings.noSections);

  sections.forEach((section, sectionIndex) => {
    const sectionName = section.title?.trim() || strings.untitledSection(sectionIndex + 1);
    if (!section.title?.trim()) problems.push(strings.sectionNeedsTitle(sectionIndex + 1));
    if (section.items.length === 0) problems.push(strings.sectionEmpty(sectionName));

    section.items.forEach(item => {
      const itemName = item.title?.trim() || getItemTypeLabel(item.type);
      if (!item.title?.trim()) problems.push(strings.itemNeedsTitle(sectionName));
      if (item.source?.kind === "needs-input") problems.push(strings.videoNeedsLink(itemName));
    });
  });

  return problems;
};
