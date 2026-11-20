import { describe, expect, it } from "vitest";

import { ApiEndpoints } from "@constants";

import { roadmapV2FlowAPI } from "../../../api/roadmapV2Flow";
import { ROADMAP_CHECK_ORDER } from "../../../types/roadmapV2Flow";

describe("draft split API", () => {
  it("posts to the draft's split route, encoding the code", () => {
    expect(ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_SPLIT("OPP-0042")).toBe(
      "/v1/roadmap/drafts/OPP-0042/split",
    );
    expect(ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_SPLIT("a/b")).toBe("/v1/roadmap/drafts/a%2Fb/split");
  });

  it("exposes the split mutation", () => {
    expect(roadmapV2FlowAPI.endpoints.splitRoadmapDraft).toBeDefined();
  });

  it("lists the eight checks, new ones last", () => {
    expect(ROADMAP_CHECK_ORDER).toHaveLength(8);
    expect(ROADMAP_CHECK_ORDER.slice(5)).toEqual([
      "strategic_fit",
      "success_signal",
      "scope_boundary",
    ]);
  });
});
