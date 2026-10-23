import { describe, expect, it } from "vitest";

import type { GuideCard } from "../../contract/wire";

import type { JourneySpineSection } from "../../contract/bootstrap";
import { buildSpineModel, chapterHasWarnings, findNode } from "../spineModel";

const item = (id: string, state: "locked" | "available" | "done", extra = {}) => ({
  id,
  type: "ARTICLE" as const,
  title: id,
  state,
  minutes: 4,
  boss: false,
  tension: "low" as const,
  hasWarnings: false,
  ...extra,
});

const sections: JourneySpineSection[] = [
  { id: "s1", title: "Opening", items: [item("a", "done"), item("b", "available")] },
  {
    id: "s2",
    title: "Hearing what's under the words",
    items: [
      item("c", "locked", { hasWarnings: true }),
      item("d", "locked", { type: "ROLEPLAY", boss: true }),
    ],
  },
];

const doneCard = (itemId: string, kind: GuideCard["kind"] = "course_item"): GuideCard => ({
  cardId: `card-${itemId}-${kind}`,
  kind,
  presentation: "shelf",
  state: "done",
  title: itemId,
  trackItem: { id: itemId, type: "ARTICLE", title: itemId },
});

describe("buildSpineModel", () => {
  it("takes the first open item as current before the server names one", () => {
    const model = buildSpineModel({ sections });
    expect(model.currentItemId).toBe("b");
    expect(model.currentChapterId).toBe("s1");
    expect(model.chapters[0]).toMatchObject({ completed: 1, total: 2, current: true, done: false });
    expect(findNode(model, "b")?.state).toBe("current");
    expect(model).toMatchObject({ completed: 1, total: 4, percent: 25 });
  });

  it("follows spine.updated for the current item and the counts", () => {
    const model = buildSpineModel({
      sections,
      progress: { currentItemId: "c", completedItems: 2, totalItems: 4 },
    });
    expect(model.currentItemId).toBe("c");
    expect(model.currentChapterId).toBe("s2");
    expect(findNode(model, "c")?.state).toBe("current");
    // b is still "available" from bootstrap; only the server unlocks.
    expect(findNode(model, "b")?.state).toBe("available");
    expect(model.completed).toBe(2);
  });

  it("fills a node as soon as its course card is done", () => {
    const model = buildSpineModel({ sections, cards: { x: doneCard("b") } });
    expect(findNode(model, "b")?.state).toBe("done");
    expect(model.chapters[0].done).toBe(true);
    expect(model.completed).toBe(2);
  });

  it("puts a pip under an item for each finished optional practice", () => {
    const pip = doneCard("b", "micro_activity");
    const model = buildSpineModel({ sections, cards: { [pip.cardId]: pip } });
    expect(findNode(model, "b")?.practicePips).toBe(1);
    expect(findNode(model, "b")?.state).toBe("current");
  });

  it("never counts more done than there are items", () => {
    const model = buildSpineModel({
      sections,
      progress: { currentItemId: null, completedItems: 9, totalItems: 4 },
    });
    expect(model).toMatchObject({ completed: 4, percent: 100 });
  });

  it("knows which chapters carry trigger warnings", () => {
    const model = buildSpineModel({ sections });
    expect(chapterHasWarnings(model, "s2")).toBe(true);
    expect(chapterHasWarnings(model, "s1")).toBe(false);
    expect(chapterHasWarnings(model, null)).toBe(false);
  });

  it("handles an empty course", () => {
    expect(buildSpineModel({ sections: [] })).toMatchObject({
      completed: 0,
      total: 0,
      percent: 0,
      currentItemId: null,
    });
  });
});
