import { describe, expect, it, vi } from "vitest";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

import {
  addItem,
  addSection,
  changeItemType,
  computeTotals,
  createItem,
  createSection,
  findBlueprintProblems,
  moveItem,
  parseVideoUrl,
  removeItem,
  removeSection,
  renameItem,
  renameSection,
  reorderItems,
  reorderSections,
  setVideoUrl,
} from "../blueprintEdit";
import { makeBlueprint } from "./fixtures";

const ids = (blueprint: ReturnType<typeof makeBlueprint>) =>
  blueprint.sections.map(section => section.items.map(entry => entry.id));

describe("reordering", () => {
  it("moves a section and leaves its items with it", () => {
    const next = reorderSections(makeBlueprint(), 0, 1);
    expect(next.sections.map(section => section.id)).toEqual(["s2", "s1"]);
    expect(ids(next)).toEqual([
      ["r", "v"],
      ["a", "q"],
    ]);
  });

  it("moves an item within its own section only", () => {
    const next = reorderItems(makeBlueprint(), "s1", 0, 1);
    expect(ids(next)).toEqual([
      ["q", "a"],
      ["r", "v"],
    ]);
  });

  it("ignores an out-of-range move instead of corrupting the tree", () => {
    const blueprint = makeBlueprint();
    expect(reorderItems(blueprint, "s1", 0, 9).sections[0].items.map(i => i.id)).toEqual(["a", "q"]);
    expect(reorderSections(blueprint, -1, 0)).toMatchObject({ sections: blueprint.sections });
  });

  it("does not mutate the blueprint it was given", () => {
    const blueprint = makeBlueprint();
    reorderSections(blueprint, 0, 1);
    removeItem(blueprint, "a");
    changeItemType(blueprint, "a", "JOURNAL");
    expect(ids(blueprint)).toEqual([
      ["a", "q"],
      ["r", "v"],
    ]);
    expect(blueprint.sections[0].items[0].type).toBe("ARTICLE");
  });
});

describe("moveItem", () => {
  it("swaps with the neighbour inside a section", () => {
    expect(ids(moveItem(makeBlueprint(), "q", -1))).toEqual([
      ["q", "a"],
      ["r", "v"],
    ]);
  });

  it("moves the last item of a section to the START of the next one", () => {
    expect(ids(moveItem(makeBlueprint(), "q", 1))).toEqual([["a"], ["q", "r", "v"]]);
  });

  it("moves the first item of a section to the END of the previous one", () => {
    expect(ids(moveItem(makeBlueprint(), "r", -1))).toEqual([["a", "q", "r"], ["v"]]);
  });

  it("is a no-op at the very top and bottom of the course", () => {
    const blueprint = makeBlueprint();
    expect(moveItem(blueprint, "a", -1)).toBe(blueprint);
    expect(moveItem(blueprint, "v", 1)).toBe(blueprint);
  });

  it("leaves an emptied section in place rather than deleting it", () => {
    let next = moveItem(makeBlueprint(), "a", 1);
    next = moveItem(next, "a", 1);
    next = moveItem(next, "q", 1);
    expect(next.sections).toHaveLength(2);
    expect(ids(next)).toEqual([[], ["q", "a", "r", "v"]]);
  });
});

describe("removing and renaming", () => {
  it("removes an item", () => {
    expect(ids(removeItem(makeBlueprint(), "q"))).toEqual([["a"], ["r", "v"]]);
  });

  it("removes a section with its items", () => {
    const next = removeSection(makeBlueprint(), "s1");
    expect(next.sections.map(section => section.id)).toEqual(["s2"]);
  });

  it("renames sections and items", () => {
    const next = renameItem(renameSection(makeBlueprint(), "s1", "Basics"), "a", "Listening 101");
    expect(next.sections[0].title).toBe("Basics");
    expect(next.sections[0].items[0].title).toBe("Listening 101");
  });
});

describe("changeItemType", () => {
  it("resets spec, source, completion rule and minutes — everything the old type owned", () => {
    const quiz = changeItemType(makeBlueprint(), "q", "JOURNAL").sections[0].items[1];
    expect(quiz).toMatchObject({
      type: "JOURNAL",
      spec: {},
      source: { kind: "new" },
      estimatedMinutes: 5,
      // Title and purpose are the trainer's intent for the slot and survive.
      title: "Check your understanding",
    });
    expect(quiz.completionCriteria).toBeUndefined();
  });

  it("drops a library reference when a roleplay-like source is switched to an inline type", () => {
    const article = changeItemType(makeBlueprint(), "v", "ARTICLE").sections[1].items[1];
    expect(article.source).toEqual({ kind: "new" });
  });

  it("returns the same blueprint when the type does not change", () => {
    const blueprint = makeBlueprint();
    expect(changeItemType(blueprint, "a", "ARTICLE").sections[0].items[0]).toBe(
      blueprint.sections[0].items[0],
    );
  });
});

describe("video links", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc123", "youtube"],
    ["https://youtu.be/abc123", "youtube"],
    ["https://vimeo.com/123456", "vimeo"],
    ["https://www.loom.com/share/abc", "loom"],
    ["https://bucket.s3.ap-south-1.amazonaws.com/track-media/clip.mp4", "s3"],
    ["https://d111.cloudfront.net/clip.mp4", "s3"],
  ])("infers the player for %s", (url, source) => {
    expect(parseVideoUrl(url)).toEqual({ url, source });
  });

  it.each([
    "",
    "not a url",
    "javascript:alert(1)",
    "ftp://youtube.com/watch?v=1",
    "https://example.com/video.mp4",
    "https://notyoutube.com/watch?v=1",
  ])("rejects %j", raw => {
    expect(parseVideoUrl(raw)).toBeNull();
  });

  it("fills spec.url and spec.source and clears the needs-input marker", () => {
    const { blueprint, valid } = setVideoUrl(
      makeBlueprint(),
      "v",
      " https://youtu.be/abc123 ",
    );
    expect(valid).toBe(true);
    expect(blueprint.sections[1].items[1]).toMatchObject({
      source: { kind: "new" },
      spec: { url: "https://youtu.be/abc123", source: "youtube" },
    });
  });

  it("changes nothing for an invalid link, so the draft never holds one the build would choke on", () => {
    const original = makeBlueprint();
    const { blueprint, valid } = setVideoUrl(original, "v", "https://example.com/clip.mp4");
    expect(valid).toBe(false);
    expect(blueprint).toBe(original);
  });

  it("puts the needs-input marker back when the link is cleared", () => {
    const withLink = setVideoUrl(makeBlueprint(), "v", "https://vimeo.com/123456").blueprint;
    const cleared = setVideoUrl(withLink, "v", "  ").blueprint.sections[1].items[1];
    expect(cleared.source).toEqual({ kind: "needs-input", what: "video-url" });
    expect(cleared.spec).toEqual({});
  });
});

describe("adding", () => {
  it("adds an item of a given type to the end of a section with a fresh id", () => {
    const added = createItem("QUIZ", "new-id");
    expect(added).toMatchObject({
      id: "new-id",
      type: "QUIZ",
      source: { kind: "new" },
      title: "New quiz",
      estimatedMinutes: 5,
      spec: {},
    });
    expect(ids(addItem(makeBlueprint(), "s2", added))).toEqual([
      ["a", "q"],
      ["r", "v", "new-id"],
    ]);
  });

  it("starts a video as needing a link", () => {
    expect(createItem("VIDEO").source).toEqual({ kind: "needs-input", what: "video-url" });
  });

  it("mints distinct ids", () => {
    expect(createItem("ARTICLE").id).not.toBe(createItem("ARTICLE").id);
  });

  it("appends a section", () => {
    const next = addSection(makeBlueprint(), createSection("s3"));
    expect(next.sections.map(section => section.id)).toEqual(["s1", "s2", "s3"]);
    expect(next.sections[2]).toMatchObject({ title: "New section", items: [] });
  });
});

describe("totals and problems", () => {
  it("totals what the tree holds, not what the last estimate said", () => {
    expect(computeTotals(makeBlueprint())).toEqual({ minutes: 33, items: 4, sections: 2 });
    expect(computeTotals(removeItem(makeBlueprint(), "r"))).toEqual({
      minutes: 18,
      items: 3,
      sections: 2,
    });
  });

  it("flags a video with no link, an empty section and a blank title", () => {
    let blueprint = makeBlueprint();
    blueprint = renameItem(blueprint, "a", "  ");
    blueprint = addSection(blueprint, createSection("s3"));
    const problems = findBlueprintProblems(blueprint);
    expect(problems).toContain('"Watch a real call" needs a video link.');
    expect(problems).toContain('"New section" has no items.');
    expect(problems).toContain('An item in "Foundations" needs a title.');
  });

  it("flags a course with no sections", () => {
    expect(findBlueprintProblems({ ...makeBlueprint(), sections: [] })).toEqual([
      "Add at least one section.",
    ]);
  });

  it("survives a section whose items array the agent left out", () => {
    const broken = {
      ...makeBlueprint(),
      sections: [{ id: "x", title: "Broken", description: "", purpose: "" }],
    } as never;
    expect(computeTotals(broken)).toEqual({ minutes: 0, items: 0, sections: 1 });
    expect(findBlueprintProblems(broken)).toEqual(['"Broken" has no items.']);
  });
});
