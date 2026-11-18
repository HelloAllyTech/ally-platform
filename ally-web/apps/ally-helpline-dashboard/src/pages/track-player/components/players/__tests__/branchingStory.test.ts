import { describe, expect, it } from "vitest";

import { branchingExperience, isStoryScenario, storyPhotoFor } from "../branchingStory";
import { BranchingChoice, BranchingNode } from "../../../../../types/tracks";

const img = (name: string) => ({ url: `https://x/${name}.png`, alt: `${name} alt` });

// s -> a -> b -> end, with a side branch s -> side.
const nodes: BranchingNode[] = [
  { id: "late", text: "Unreached", image: img("late") },
  {
    id: "s",
    text: "Start",
    image: img("s"),
    choices: [
      { id: "c1", text: "On", nextNodeId: "a" },
      { id: "c2", text: "Side", nextNodeId: "side" },
    ],
  },
  { id: "a", text: "A", image: img("a"), choices: [{ id: "c3", text: "On", nextNodeId: "b" }] },
  { id: "b", text: "B", choices: [{ id: "c4", text: "On", nextNodeId: "end" }] },
  { id: "side", text: "Side", image: img("side") },
  { id: "end", text: "End", outcome: "POSITIVE" },
];
const byId = (id: string) => nodes.find(n => n.id === id) as BranchingNode;
const choice = (id: string): BranchingChoice =>
  nodes.flatMap(n => n.choices ?? []).find(c => c.id === id) as BranchingChoice;

describe("branchingExperience", () => {
  it("reads STORY only when the server says so", () => {
    expect(branchingExperience({ experience: "STORY" })).toBe("STORY");
    expect(branchingExperience({ experience: "CLASSIC" })).toBe("CLASSIC");
    expect(branchingExperience({})).toBe("CLASSIC");
    expect(branchingExperience({ experience: "CINEMA" as never })).toBe("CLASSIC");
  });
});

describe("isStoryScenario", () => {
  it("needs STORY and at least one photo", () => {
    expect(isStoryScenario({ experience: "STORY", nodes })).toBe(true);
    expect(isStoryScenario({ experience: "CLASSIC", nodes })).toBe(false);
    expect(
      isStoryScenario({ experience: "STORY", nodes: nodes.map(n => ({ ...n, image: undefined })) }),
    ).toBe(false);
  });
});

describe("storyPhotoFor", () => {
  it("uses the scene's own photo with its alt text", () => {
    expect(storyPhotoFor(byId("a"), nodes, "s", [choice("c1")])).toEqual({
      url: "https://x/a.png",
      alt: "a alt",
      reused: false,
    });
  });

  it("borrows the most recent photo on the path walked, without alt text", () => {
    expect(storyPhotoFor(byId("b"), nodes, "s", [choice("c1"), choice("c3")])).toEqual({
      url: "https://x/a.png",
      alt: "",
      reused: true,
    });
    // Two scenes on, still the last photo passed (not the start's, not a side branch's).
    expect(
      storyPhotoFor(byId("end"), nodes, "s", [choice("c1"), choice("c3"), choice("c4")])?.url,
    ).toBe("https://x/a.png");
  });

  it("falls back to the start scene's photo when nothing later had one", () => {
    const noA = nodes.map(n => (n.id === "a" ? { ...n, image: undefined } : n));
    expect(storyPhotoFor(byId("b"), noA, "s", [choice("c1"), choice("c3")])?.url).toBe(
      "https://x/s.png",
    );
  });

  it("falls back to the first scene in the scenario with a photo when the path has none", () => {
    const pathless = nodes.map(n => (["s", "a"].includes(n.id) ? { ...n, image: undefined } : n));
    const start = pathless.find(n => n.id === "s") as BranchingNode;
    expect(storyPhotoFor(start, pathless, "s", [])).toEqual({
      url: "https://x/late.png",
      alt: "",
      reused: true,
    });
  });

  it("is null when the scenario has no photos at all", () => {
    const bare = nodes.map(n => ({ ...n, image: undefined }));
    const b = bare.find(n => n.id === "b") as BranchingNode;
    expect(storyPhotoFor(b, bare, "s", [choice("c1"), choice("c3")])).toBeNull();
  });
});
