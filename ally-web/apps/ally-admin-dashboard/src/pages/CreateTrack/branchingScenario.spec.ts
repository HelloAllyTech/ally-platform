import { describe, expect, it } from "vitest";

import { BranchingExperience, BranchingScenarioContent, TrackItemType } from "@types";

import {
  addStep,
  addStepBlockedReason,
  BRANCHING_COLUMN_WIDTH,
  BRANCHING_ROW_HEIGHT,
  connectChoice,
  createBranchingTemplate,
  createEnding,
  endingScore,
  layoutBranching,
  DEFAULT_BUTTON_TEXT,
  removeChoiceFromNode,
  runResult,
  sceneMode,
  serializeBranching,
  setSceneMode,
  storyPhotoFor,
  storyPhotoSummary,
  storyPhotoWarning,
  validateBranching,
} from "./branchingScenario";
import { createItemOfType } from "./trackFormUtils";

/** The template with every text field filled, so only graph rules can fail. */
const filledTemplate = (): BranchingScenarioContent => {
  const content = createBranchingTemplate();
  content.nodes.forEach((node, index) => {
    node.text = `Scene ${index}`;
    node.choices?.forEach((choice, choiceIndex) => {
      choice.text = `Choice ${choiceIndex}`;
    });
  });
  return content;
};

const messages = (content: BranchingScenarioContent) =>
  validateBranching(content).map(problem => problem.message);

describe("createBranchingTemplate", () => {
  it("is one decision: a start scene with 3 choices to 3 endings, pass mark 70", () => {
    const content = createBranchingTemplate();
    const start = content.nodes.find(node => node.id === content.startNodeId)!;
    expect(start.choices).toHaveLength(3);
    const endings = start.choices!.map(c => content.nodes.find(n => n.id === c.nextNodeId)!);
    expect(endings.map(e => [e.outcome, e.score])).toEqual([
      ["POSITIVE", 100],
      ["MIXED", 50],
      ["NEGATIVE", 0],
    ]);
    expect(content.settings).toEqual({ passScore: 70, maxAttempts: null });
    expect(new Set(content.nodes.map(n => n.id)).size).toBe(4);
  });

  it("is what a new item starts with", () => {
    expect(createItemOfType(TrackItemType.BRANCHING_SCENARIO).branching?.nodes).toHaveLength(4);
  });
});

describe("endingScore", () => {
  it("prefers an explicit score, then the outcome default, then full marks", () => {
    expect(endingScore({ ...createEnding("MIXED"), score: 65 })).toBe(65);
    expect(endingScore({ id: "a", text: "", outcome: "NEGATIVE" })).toBe(0);
    expect(endingScore({ id: "a", text: "", outcome: "MIXED" })).toBe(50);
    expect(endingScore({ id: "a", text: "" })).toBe(100);
  });
});

describe("validateBranching", () => {
  it("accepts a filled-in template", () => {
    expect(messages(filledTemplate())).toEqual([]);
  });

  it("asks for scene and choice text on the blank template", () => {
    const all = messages(createBranchingTemplate());
    expect(all.some(m => m.includes("needs some text"))).toBe(true);
  });

  it("flags a choice with no destination", () => {
    const content = filledTemplate();
    content.nodes[0].choices![0].nextNodeId = "";
    expect(messages(content).some(m => m.includes("pick where it leads"))).toBe(true);
  });

  it("flags a scene that cannot be reached", () => {
    const content = filledTemplate();
    content.nodes.push({ ...createEnding("POSITIVE"), text: "Orphan" });
    expect(messages(content).some(m => m.includes("can't be reached"))).toBe(true);
  });

  it("flags a loop with no way out", () => {
    const content = filledTemplate();
    const a = {
      id: "a",
      text: "A",
      choices: [] as NonNullable<(typeof content.nodes)[0]["choices"]>,
    };
    const b = { id: "b", text: "B", choices: [] as typeof a.choices };
    a.choices.push(
      { id: "ca1", text: "x", nextNodeId: "b" },
      { id: "ca2", text: "y", nextNodeId: "b" },
    );
    b.choices.push(
      { id: "cb1", text: "x", nextNodeId: "a" },
      { id: "cb2", text: "y", nextNodeId: "a" },
    );
    content.nodes[0].choices![2].nextNodeId = "a";
    content.nodes.push(a, b);
    expect(messages(content).some(m => m.includes("no way to reach an ending"))).toBe(true);
  });

  it("rejects a pass mark above every ending score", () => {
    const content = filledTemplate();
    content.settings = { passScore: 100, maxAttempts: null };
    content.nodes.forEach(node => {
      if (node.outcome === "POSITIVE") node.score = 90;
    });
    expect(messages(content).some(m => m.includes("nobody could pass"))).toBe(true);
  });

  it("accepts a single-button scene (one choice)", () => {
    const content = filledTemplate();
    content.nodes[0].choices = content.nodes[0].choices!.slice(0, 1);
    // The two endings it no longer leads to are now unreachable; nothing else is wrong.
    expect(messages(content).filter(m => !m.includes("can't be reached"))).toEqual([]);
    expect(messages(content).some(m => m.includes("choices"))).toBe(false);
  });

  it("allows at most 6 choices on a scene", () => {
    const content = filledTemplate();
    const target = content.nodes[1].id;
    content.nodes[0].choices = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      text: `Choice ${i}`,
      nextNodeId: target,
    }));
    expect(messages(content).some(m => m.includes("needs 1 to 6 choices"))).toBe(true);
  });

  it("accepts Classic, Story or no experience, and rejects anything else", () => {
    const content = filledTemplate();
    expect(messages(content)).toEqual([]);
    content.experience = BranchingExperience.STORY;
    expect(messages(content)).toEqual([]);
    content.experience = BranchingExperience.CLASSIC;
    expect(messages(content)).toEqual([]);
    content.experience = "CINEMA" as BranchingExperience;
    expect(messages(content)).toContain("Experience must be Classic or Story.");
  });

  it("does not block saving a Story scenario that has no photos", () => {
    const content = filledTemplate();
    content.experience = BranchingExperience.STORY;
    expect(content.nodes.some(n => n.image)).toBe(false);
    expect(messages(content)).toEqual([]);
  });
});

describe("serializeBranching", () => {
  it("drops blanks and keeps outcome/score only on endings", () => {
    const content = filledTemplate();
    content.intro = "  ";
    const out = serializeBranching(content);
    expect(out.intro).toBeUndefined();
    const start = out.nodes.find(n => n.id === out.startNodeId)!;
    expect(start.outcome).toBeUndefined();
    expect(start.score).toBeUndefined();
    expect(start.title).toBeUndefined();
    const ending = out.nodes.find(n => n.outcome === "MIXED")!;
    expect(ending.score).toBe(50);
    expect(ending.takeaway).toBeUndefined();
    expect(out.settings).toEqual({ passScore: 70, maxAttempts: null });
  });

  it("writes experience only for Story, so Classic content is unchanged", () => {
    const content = filledTemplate();
    expect("experience" in serializeBranching(content)).toBe(false);
    content.experience = BranchingExperience.CLASSIC;
    expect("experience" in serializeBranching(content)).toBe(false);
    content.experience = BranchingExperience.STORY;
    expect(serializeBranching(content).experience).toBe("STORY");
  });

  it("keeps a single-button scene's one choice", () => {
    const content = filledTemplate();
    content.nodes[0].choices = content.nodes[0].choices!.slice(0, 1);
    const start = serializeBranching(content).nodes[0];
    expect(start.choices).toEqual([content.nodes[0].choices[0]]);
  });
});

describe("runResult", () => {
  it("reports pass status against the pass mark, or null when ungated", () => {
    const content = filledTemplate();
    const mixed = content.nodes.find(n => n.outcome === "MIXED")!;
    expect(runResult(content, mixed)).toMatchObject({ score: 50, passed: false });
    content.settings = { passScore: 0, maxAttempts: null };
    expect(runResult(content, mixed).passed).toBeNull();
  });
});

const scene = (id: string, ...targets: string[]) => ({
  id,
  text: id,
  ...(targets.length
    ? { choices: targets.map((to, i) => ({ id: `${id}-${i}`, text: `c${i}`, nextNodeId: to })) }
    : {}),
});
const graph = (
  startNodeId: string,
  nodes: ReturnType<typeof scene>[],
): BranchingScenarioContent => ({
  startNodeId,
  nodes,
});
const noOverlap = (points: Map<string, { x: number; y: number }>) => {
  const seen = new Set<string>();
  for (const { x, y } of points.values()) {
    const key = `${x}:${Math.round(y)}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
};

describe("layoutBranching", () => {
  it("fans out and re-joins: the join sits one column after the branches", () => {
    const content = graph("a", [
      scene("a", "b", "c"),
      scene("b", "d"),
      scene("c", "d"),
      scene("d"),
    ]);
    const pos = layoutBranching(content);
    expect(pos.get("a")!.x).toBe(0);
    expect(pos.get("b")!.x).toBe(BRANCHING_COLUMN_WIDTH);
    expect(pos.get("c")!.x).toBe(BRANCHING_COLUMN_WIDTH);
    expect(pos.get("d")!.x).toBe(2 * BRANCHING_COLUMN_WIDTH);
    expect(Math.abs(pos.get("b")!.y - pos.get("c")!.y)).toBeGreaterThanOrEqual(
      BRANCHING_ROW_HEIGHT,
    );
    noOverlap(pos);
  });

  it("handles a loop back to an earlier scene", () => {
    const content = graph("a", [scene("a", "b", "e"), scene("b", "a", "e"), scene("e")]);
    const pos = layoutBranching(content);
    expect(pos.size).toBe(3);
    expect(pos.get("b")!.x).toBe(BRANCHING_COLUMN_WIDTH);
    expect(pos.get("e")!.x).toBe(BRANCHING_COLUMN_WIDTH);
    noOverlap(pos);
  });

  it("puts scenes the start can't reach in a row below the chart", () => {
    const content = graph("a", [
      scene("a", "b", "c"),
      scene("b"),
      scene("c"),
      scene("x"),
      scene("y", "x"),
    ]);
    const pos = layoutBranching(content);
    const chartBottom = Math.max(pos.get("a")!.y, pos.get("b")!.y, pos.get("c")!.y);
    expect(pos.get("x")!.y).toBeGreaterThan(chartBottom);
    expect(pos.get("y")!.y).toBeGreaterThan(chartBottom);
    noOverlap(pos);
  });

  it("lays out everything below when the start scene is missing", () => {
    const pos = layoutBranching(graph("nope", [scene("a"), scene("b")]));
    expect(pos.size).toBe(2);
    noOverlap(pos);
  });

  it("lays out 100 scenes without overlap, all coordinates finite", () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      i >= 80
        ? scene(`n${i}`)
        : scene(`n${i}`, `n${i * 2 + 1 < 100 ? i * 2 + 1 : 99}`, `n${(i * 3 + 2) % 100}`),
    );
    const pos = layoutBranching(graph("n0", nodes));
    expect(pos.size).toBe(100);
    for (const { x, y } of pos.values()) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
    noOverlap(pos);
  });
});

describe("canvas edits", () => {
  it("addStep adds a choice and a new scene it leads to", () => {
    const content = filledTemplate();
    const result = addStep(content, content.startNodeId)!;
    const start = result.content.nodes.find(n => n.id === content.startNodeId)!;
    expect(start.choices).toHaveLength(4);
    expect(start.choices![3]).toMatchObject({ text: "New choice", nextNodeId: result.newNodeId });
    expect(result.content.nodes).toHaveLength(5);
  });

  it("addStep refuses at the 6-choice cap and the scene cap", () => {
    let content = filledTemplate();
    for (let i = 0; i < 3; i += 1) content = addStep(content, content.startNodeId)!.content;
    expect(content.nodes.find(n => n.id === content.startNodeId)!.choices).toHaveLength(6);
    expect(addStepBlockedReason(content, content.startNodeId)).toMatch(/at most 6 choices/);
    expect(addStep(content, content.startNodeId)).toBeNull();
    const full = graph(
      "n0",
      Array.from({ length: 100 }, (_, i) => scene(`n${i}`)),
    );
    expect(addStepBlockedReason(full, "n0")).toMatch(/at most 100 scenes/);
  });

  it("addStep on an ending turns it into a decision with two new scenes", () => {
    const content = filledTemplate();
    const ending = content.nodes.find(n => n.outcome === "POSITIVE")!;
    const next = addStep(content, ending.id)!.content;
    const converted = next.nodes.find(n => n.id === ending.id)!;
    expect(converted.choices).toHaveLength(2);
    expect(converted.outcome).toBeUndefined();
    expect(next.nodes).toHaveLength(6);
  });

  it("connectChoice re-joins a branch, fills an open choice first, and rejects duplicates and itself", () => {
    const content = graph("a", [scene("a", "b", "c"), scene("b", "d"), scene("c"), scene("d")]);
    const joined = connectChoice(content, "c", "d");
    expect(joined).toBeNull(); // c is an ending
    const rejoin = connectChoice(content, "a", "d")!;
    expect(rejoin.nodes[0].choices).toHaveLength(3);
    expect(rejoin.nodes[0].choices![2]).toMatchObject({ text: "New choice", nextNodeId: "d" });
    expect(connectChoice(content, "a", "b")).toBeNull();
    expect(connectChoice(content, "a", "a")).toBeNull();
    const open = graph("a", [
      {
        id: "a",
        text: "a",
        choices: [
          { id: "k", text: "kept", nextNodeId: "" },
          { id: "l", text: "l", nextNodeId: "b" },
        ],
      },
      scene("b"),
      scene("c"),
    ]);
    const filled = connectChoice(open, "a", "c")!;
    expect(filled.nodes[0].choices![0]).toEqual({ id: "k", text: "kept", nextNodeId: "c" });
    expect(filled.nodes[0].choices).toHaveLength(2);
  });

  it("removeChoiceFromNode drops a choice but never the last one", () => {
    const content = graph("a", [scene("a", "b", "c"), scene("b"), scene("c")]);
    const fewer = removeChoiceFromNode(content, "a", "a-0")!;
    expect(fewer.nodes[0].choices).toHaveLength(1);
    // One choice left is a valid single-button scene.
    expect(messages(fewer as BranchingScenarioContent).join(" ")).not.toMatch(/choices/);
    expect(removeChoiceFromNode(fewer, "a", "a-1")).toBeNull();
  });
});

describe("scene mode", () => {
  it("reads 0 choices as an ending, 1 as one button, 2+ as choose", () => {
    expect(sceneMode(scene("a"))).toBe("ending");
    expect(sceneMode(scene("a", "b"))).toBe("oneButton");
    expect(sceneMode(scene("a", "b", "c"))).toBe("choose");
    expect(sceneMode({ id: "a", text: "", choices: [] })).toBe("ending");
  });

  it("choose -> one button keeps the first choice and where it leads, and drops the rest", () => {
    const content = filledTemplate();
    const before = content.nodes[0].choices!;
    const next = setSceneMode(content, content.startNodeId, "oneButton")!;
    expect(next.nodes).toHaveLength(content.nodes.length);
    expect(next.nodes[0].choices).toEqual([before[0]]);
    expect(sceneMode(next.nodes[0])).toBe("oneButton");
    // The dropped choices' endings are left for the trainer: unreachable, as when deleting a choice.
    expect(messages(next).filter(m => m.includes("can't be reached"))).toHaveLength(2);
  });

  it("choose -> one button gives a blank first choice the default button text", () => {
    const content = graph("a", [scene("a", "b", "c"), scene("b"), scene("c")]);
    content.nodes[0].choices![0].text = "  ";
    const next = setSceneMode(content, "a", "oneButton")!;
    expect(next.nodes[0].choices).toEqual([
      { id: "a-0", text: DEFAULT_BUTTON_TEXT, nextNodeId: "b" },
    ]);
    expect(DEFAULT_BUTTON_TEXT).toBe("Continue");
  });

  it("ending -> one button adds one new ending scene and a Continue button to it", () => {
    const content = filledTemplate();
    const ending = content.nodes.find(n => n.outcome === "POSITIVE")!;
    const next = setSceneMode(content, ending.id, "oneButton")!;
    expect(next.nodes).toHaveLength(content.nodes.length + 1);
    const converted = next.nodes.find(n => n.id === ending.id)!;
    expect(converted.choices).toHaveLength(1);
    expect(converted.choices![0].text).toBe("Continue");
    const added = next.nodes[next.nodes.length - 1];
    expect(converted.choices![0].nextNodeId).toBe(added.id);
    expect(sceneMode(added)).toBe("ending");
    expect(converted.outcome).toBeUndefined();
    expect(converted.score).toBeUndefined();
    expect(converted.takeaway).toBeUndefined();
  });

  it("one button -> choose adds a second choice leading to a new ending", () => {
    const content = graph("a", [scene("a", "b"), scene("b")]);
    const next = setSceneMode(content, "a", "choose")!;
    const choices = next.nodes[0].choices!;
    expect(choices).toHaveLength(2);
    expect(choices[0]).toEqual({ id: "a-0", text: "c0", nextNodeId: "b" });
    expect(next.nodes).toHaveLength(3);
    expect(choices[1]).toMatchObject({ text: "", nextNodeId: next.nodes[2].id });
    expect(sceneMode(next.nodes[0])).toBe("choose");
  });

  it("ending -> choose gives two blank choices, as before", () => {
    const content = graph("a", [scene("a", "b", "c"), scene("b"), scene("c")]);
    const next = setSceneMode(content, "b", "choose")!;
    expect(next.nodes).toHaveLength(3);
    expect(next.nodes[1].choices).toHaveLength(2);
    expect(next.nodes[1].choices!.every(c => c.text === "" && c.nextNodeId === "")).toBe(true);
  });

  it("one button or choose -> ending drops the choices", () => {
    const content = graph("a", [scene("a", "b"), scene("b", "c", "d"), scene("c"), scene("d")]);
    expect(setSceneMode(content, "a", "ending")!.nodes[0].choices).toBeUndefined();
    expect(setSceneMode(content, "b", "ending")!.nodes[1].choices).toBeUndefined();
  });

  it("leaves the destination to pick when the scenario is full of scenes", () => {
    const full = graph(
      "n0",
      Array.from({ length: 100 }, (_, i) => scene(`n${i}`)),
    );
    const next = setSceneMode(full, "n0", "oneButton")!;
    expect(next.nodes).toHaveLength(100);
    expect(next.nodes[0].choices).toEqual([
      expect.objectContaining({ text: "Continue", nextNodeId: "" }),
    ]);
  });

  it("returns null for a missing scene or the mode it is already in", () => {
    const content = graph("a", [scene("a", "b"), scene("b")]);
    expect(setSceneMode(content, "a", "oneButton")).toBeNull();
    expect(setSceneMode(content, "b", "ending")).toBeNull();
    expect(setSceneMode(content, "zzz", "choose")).toBeNull();
  });

  it("addStep on an ending still makes a two-choice decision; on one button it adds a second", () => {
    const content = graph("a", [scene("a", "b"), scene("b")]);
    const fromEnding = addStep(content, "b")!.content;
    expect(fromEnding.nodes[1].choices).toHaveLength(2);
    const fromButton = addStep(content, "a")!.content;
    expect(fromButton.nodes[0].choices).toHaveLength(2);
    expect(sceneMode(fromButton.nodes[0])).toBe("choose");
  });
});

describe("story photos", () => {
  const photo = (url: string) => ({ url: `https://cdn.test/${url}.jpg` });
  const withPhotos = (...urls: (string | null)[]): BranchingScenarioContent => {
    const nodes = urls.map((url, i) => ({
      ...scene(`n${i}`, ...(i < urls.length - 1 ? [`n${i + 1}`] : [])),
      ...(url ? { image: photo(url) } : {}),
    }));
    return graph("n0", nodes);
  };

  it("counts scenes without a photo", () => {
    expect(storyPhotoSummary(withPhotos("a", null, "c", null))).toEqual({
      total: 4,
      missing: 2,
      startMissing: false,
    });
    expect(storyPhotoSummary(withPhotos(null, "b")).startMissing).toBe(true);
  });

  it("warns nothing when every scene has a photo", () => {
    expect(storyPhotoWarning(withPhotos("a", "b", "c"))).toBeNull();
  });

  it("says how many scenes will reuse the photo before", () => {
    expect(storyPhotoWarning(withPhotos("a", null, "c", null))).toBe(
      "2 of 4 scenes have no photo. In Story mode they'll reuse the photo from the scene before.",
    );
    expect(storyPhotoWarning(withPhotos("a", null, "c"))).toBe(
      "1 of 3 scenes has no photo. In Story mode it'll reuse the photo from the scene before.",
    );
  });

  it("asks for photos when there are none", () => {
    expect(storyPhotoWarning(withPhotos(null, null))).toBe(
      "Story mode needs photos. Add a photo to at least the first scene.",
    );
  });

  it("asks for a first-scene photo, which has nothing earlier to reuse", () => {
    expect(storyPhotoWarning(withPhotos(null, "b", "c"))).toBe(
      "Add a photo to the first scene — there is no earlier photo for it to reuse.",
    );
    expect(storyPhotoWarning(withPhotos(null, "b", null))).toBe(
      "2 of 3 scenes have no photo. In Story mode they'll reuse the photo from the scene before. Add a photo to the first scene — there is no earlier photo for it to reuse.",
    );
  });

  it("storyPhotoFor uses the scene's own photo, else the latest on the path, else the first", () => {
    const content = withPhotos(null, "b", null, "d", null);
    expect(storyPhotoFor(content, ["n0", "n1"])?.url).toContain("b.jpg");
    expect(storyPhotoFor(content, ["n0", "n1", "n2"])?.url).toContain("b.jpg");
    expect(storyPhotoFor(content, ["n0", "n1", "n2", "n3", "n4"])?.url).toContain("d.jpg");
    expect(storyPhotoFor(content, ["n0"])?.url).toContain("b.jpg");
    expect(storyPhotoFor(withPhotos(null, null), ["n0", "n1"])).toBeUndefined();
  });
});
