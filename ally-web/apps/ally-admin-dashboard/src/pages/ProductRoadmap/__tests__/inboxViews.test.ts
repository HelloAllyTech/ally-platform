import { describe, expect, it } from "vitest";

import { RoadmapBoardLayout } from "@types";

import { displayStage, expandStageFilter, stageLabel } from "../utils/stages";
import { parseUrlState, writeUrlState } from "../utils/urlState";
import {
  INBOX_VIEW_ID,
  INBOX_VIEW_STATE,
  QUEUE_VIEW_ID,
  QUEUE_VIEW_STATE,
  isPipelineViewId,
  normaliseStageFilter,
  pseudoViewState,
} from "../utils/views";

describe("Inbox view", () => {
  it("is Ideas only, as a list, needs-triage first then oldest first", () => {
    expect(INBOX_VIEW_STATE.stageFilter).toEqual(["new"]);
    expect(INBOX_VIEW_STATE.layout).toBe(RoadmapBoardLayout.LIST);
    expect(INBOX_VIEW_STATE.sort).toEqual({ field: "triage", dir: "asc" });
  });

  it("resolves pseudo views by id and treats both as pipeline views", () => {
    expect(pseudoViewState(INBOX_VIEW_ID)).toBe(INBOX_VIEW_STATE);
    expect(pseudoViewState(QUEUE_VIEW_ID)).toBe(QUEUE_VIEW_STATE);
    expect(pseudoViewState("some-uuid")).toBeUndefined();
    expect(isPipelineViewId(INBOX_VIEW_ID)).toBe(true);
    expect(isPipelineViewId(null)).toBe(false);
  });
});

describe("stage vocabulary", () => {
  it("shows new as Idea and the retired under_development as Prioritised", () => {
    expect(stageLabel("new")).toBe("Idea");
    expect(stageLabel("under_development")).toBe("Prioritised");
    expect(displayStage("under_development")).toBe("prioritised");
  });

  it("hides archived by default but still sends the legacy stage with Prioritised", () => {
    expect(expandStageFilter([], false)).toEqual([
      "new",
      "prioritised",
      "under_development",
      "released",
    ]);
    expect(expandStageFilter([], true)).toBeUndefined();
    expect(expandStageFilter(["prioritised"], false)).toEqual(["prioritised", "under_development"]);
    expect(expandStageFilter(["released"], true)).toEqual(["released", "archived"]);
  });

  it("folds a saved view's stages into the three visible ones", () => {
    expect(normaliseStageFilter(["new", "under_development", "prioritised", "archived"])).toEqual({
      stages: ["new", "prioritised"],
      archived: true,
    });
    expect(normaliseStageFilter(undefined)).toEqual({ stages: [], archived: false });
  });

  it("carries show-archived in the URL, except on pipeline views", () => {
    const on = writeUrlState(new URLSearchParams(), { showArchived: true });
    expect(parseUrlState(on).showArchived).toBe(true);
    const pipeline = writeUrlState(
      new URLSearchParams(),
      { showArchived: true },
      { omitStage: true },
    );
    expect(pipeline.has("archived")).toBe(false);
  });
});
