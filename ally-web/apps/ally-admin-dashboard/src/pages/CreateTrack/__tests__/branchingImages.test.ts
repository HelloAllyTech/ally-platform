import { describe, expect, it } from "vitest";

import { BranchingNode, BranchingScenarioContent } from "@types";

import {
  buildFillSceneRequests,
  emptyScenes,
  parentSceneIds,
  sceneDescription,
  sceneReferenceOptions,
  sceneSlotKey,
} from "../branchingImages";
import { serializeBranching } from "../branchingScenario";

const node = (
  id: string,
  nextIds: string[] = [],
  extra: Partial<BranchingNode> = {},
): BranchingNode => ({
  id,
  text: `Text of ${id}`,
  choices: nextIds.map((nextNodeId, index) => ({ id: `${id}-c${index}`, text: "Go", nextNodeId })),
  ...extra,
});

const img = (id: string) => ({ image: { url: `https://bucket/${id}.webp` } });

/**
 * start → a, b; a → c; b → c; c → a (a loop back); c → c (self loop); d unreachable.
 */
const content: BranchingScenarioContent = {
  startNodeId: "start",
  nodes: [
    node("start", ["a", "b"], { title: "The call starts", ...img("start") }),
    node("a", ["c"], { title: "She goes quiet", ...img("a") }),
    node("b", ["c"]),
    node("c", ["a", "c"], { ...img("c") }),
    node("d", [], { title: "Unused", ...img("d") }),
  ],
};

describe("parentSceneIds", () => {
  it("returns every scene with a choice leading here, one step back only", () => {
    expect(parentSceneIds(content, "c").sort()).toEqual(["a", "b"]);
    expect(parentSceneIds(content, "start")).toEqual([]);
  });

  it("handles loops: a scene reached back from later is a parent, a scene is never its own", () => {
    expect(parentSceneIds(content, "a").sort()).toEqual(["c", "start"]);
    expect(parentSceneIds(content, "c")).not.toContain("c");
  });
});

describe("sceneReferenceOptions", () => {
  it("offers parents with a picture as 'previous' (off) and other pictures as 'setting'", () => {
    const options = sceneReferenceOptions(content, "c");

    expect(options.suggested).toEqual([
      {
        key: "previous:a",
        role: "previous",
        label: "Scene: She goes quiet",
        thumbnailUrl: "https://bucket/a.webp",
        url: "https://bucket/a.webp",
        selected: false,
      },
    ]);
    // b has no picture; c is this scene.
    expect(options.available?.map(option => [option.key, option.label])).toEqual([
      ["setting:start", "Scene: The call starts"],
      ["setting:d", "Scene: Unused"],
    ]);
  });

  it("names an untitled parent by its position", () => {
    const options = sceneReferenceOptions(content, "a");
    expect(options.suggested?.map(option => option.label)).toEqual([
      "Scene: The call starts",
      "Scene: Scene 4",
    ]);
  });
});

describe("Fill empty scenes", () => {
  it("lists scenes without a picture", () => {
    expect(emptyScenes(content).map(scene => scene.id)).toEqual(["b"]);
  });

  it("describes a scene by its title and text", () => {
    expect(sceneDescription(node("x", [], { title: "Tea", text: "She pours tea." }))).toBe(
      "Tea. She pours tea.",
    );
    expect(sceneDescription(node("x", [], { text: "  Only text " }))).toBe("Only text");
  });

  it("builds one single-variant request per scene, with the cast and a per-scene slotKey", () => {
    const withCast = { ...content, imageCast: [{ characterId: "c-ravi", name: "Ravi" }] };
    const requests = buildFillSceneRequests({
      content: withCast,
      nodes: [node("b", [], { title: "", text: "He waits." }), node("e", [], { text: "" })],
      trackId: "t-1",
      itemId: "i-1",
      styleId: "watercolour",
      courseTitle: "Listening Well",
    });

    // A scene with no words at all can't be described, so it is skipped.
    expect(requests).toEqual([
      {
        slotKind: "scene",
        slotKey: "track:t-1:item:i-1:node:b",
        styleId: "watercolour",
        description: "He waits.",
        variants: 1,
        castCharacterIds: ["c-ravi"],
        context: { text: "He waits.", courseTitle: "Listening Well" },
      },
    ]);
    expect(sceneSlotKey(null, "i-1", "b")).toBe("track:new:item:i-1:node:b");
  });
});

describe("imageCast in the saved content", () => {
  it("is written only when someone is cast", () => {
    expect(serializeBranching(content)).not.toHaveProperty("imageCast");
    expect(serializeBranching({ ...content, imageCast: [] })).not.toHaveProperty("imageCast");
    expect(
      serializeBranching({ ...content, imageCast: [{ characterId: "c-1", name: "Meera" }] })
        .imageCast,
    ).toEqual([{ characterId: "c-1", name: "Meera" }]);
  });
});
