import { describe, expect, it } from "vitest";

import { RoadmapBoardLayout } from "@types";

import { overlayUrlState, parseUrlState, writeUrlState } from "../utils/urlState";

describe("urlState", () => {
  it("round-trips filters, sort and layout", () => {
    const state = {
      searchQuery: "voice notes",
      goalFilter: ["Scribe, notes", "Learn"],
      effortFilter: ["unsized"],
      sort: { field: "createdAt", dir: "asc" as const },
      layout: RoadmapBoardLayout.LIST,
    };
    const params = writeUrlState(new URLSearchParams("tab=opportunities"), state);
    expect(params.get("tab")).toBe("opportunities");
    expect(parseUrlState(params)).toEqual(state);
  });

  it("writes nothing for empty values and always names the layout", () => {
    const params = writeUrlState(new URLSearchParams("q=old&goal=x"), { searchQuery: "" });
    expect(params.has("q")).toBe(false);
    expect(params.has("goal")).toBe(false);
    expect(params.get("layout")).toBe("table");
  });

  it("omits stage for the queue", () => {
    const params = writeUrlState(
      new URLSearchParams(),
      { stageFilter: ["new"] },
      { omitStage: true },
    );
    expect(params.has("stage")).toBe(false);
  });

  it("ignores an unknown layout and tolerates bad escapes", () => {
    const params = new URLSearchParams("layout=cube");
    params.set("goal", "%E0%A4%A"); // a literal, undecodable value after URLSearchParams' own decode
    const state = parseUrlState(params);
    expect(state.layout).toBeUndefined();
    expect(state.goalFilter).toEqual(["%E0%A4%A"]);
  });

  it("overlays only the keys present in the URL", () => {
    const merged = overlayUrlState(
      { stageFilter: ["new"], goalFilter: ["A"], layout: RoadmapBoardLayout.LIST },
      { goalFilter: ["B"] },
    );
    expect(merged).toEqual({ stageFilter: ["new"], goalFilter: ["B"], layout: "list" });
  });

  it("can ignore a URL stage on the queue", () => {
    const merged = overlayUrlState(
      { stageFilter: ["new"] },
      { stageFilter: ["released"] },
      { ignoreStage: true },
    );
    expect(merged.stageFilter).toEqual(["new"]);
  });
});
