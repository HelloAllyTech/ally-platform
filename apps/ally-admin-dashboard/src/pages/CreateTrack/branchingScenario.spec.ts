import { describe, expect, it } from "vitest";

import { BranchingScenarioContent, TrackItemType } from "@types";

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
  removeChoiceFromNode,
  runResult,
  serializeBranching,
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

  it("requires 2 to 6 choices on a decision scene", () => {
    const content = filledTemplate();
    content.nodes[0].choices = content.nodes[0].choices!.slice(0, 1);
    expect(messages(content).some(m => m.includes("2 to 6 choices"))).toBe(true);
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
    expect(messages(fewer as BranchingScenarioContent).join(" ")).toMatch(/needs 2 to 6 choices/);
    expect(removeChoiceFromNode(fewer, "a", "a-1")).toBeNull();
  });
});
