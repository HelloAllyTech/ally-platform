import { describe, expect, it } from "vitest";

import type { ContextCollection } from "@types";

import {
  changeHeadline,
  formatPercent,
  formatScore,
  gapAction,
  isLoopOn,
  judgeIdle,
  keyHint,
  mayHaveMore,
  mcpEndpoint,
  oldestChange,
  sampleRatePercent,
  setupRows,
  shellLines,
  weeklyLines,
  weeklySpark,
  withLoop,
} from "../insightsFormat";

const settings = (paused: string[], judgeSampleRate = 0.2) => ({
  judgeSampleRate,
  paused,
  loops: [],
  searchSetup: null,
  searchSetupIsDefault: true,
  setupPromotedAt: null,
});

describe("numbers", () => {
  it("formats percentages and scores, with a dash for nothing", () => {
    expect(formatPercent(0.625)).toBe("63%");
    expect(formatPercent(null)).toBe("—");
    expect(formatScore(0.7123)).toBe("0.71");
    expect(formatScore(undefined)).toBe("—");
  });

  it("keeps a week with nothing judged as a gap, not a zero", () => {
    const weekly = [
      { week: "2026-10-19T00:00:00Z", precision: 0.5, judged: 10 },
      { week: "2026-10-26T00:00:00Z", precision: null, judged: 0 },
    ];
    expect(weeklySpark(weekly)).toEqual([50, null]);
    expect(weeklyLines(weekly)).toEqual([
      "Week of 19 Oct: 50% of 10 judged",
      "Week of 26 Oct: nothing judged",
    ]);
  });

  it("clamps the sample rate to a whole percentage", () => {
    expect(sampleRatePercent(0.2)).toBe(20);
    expect(sampleRatePercent(1.4)).toBe(100);
    expect(sampleRatePercent(undefined)).toBe(0);
  });
});

describe("loops", () => {
  it("on means not paused, and switching keeps the rest of the list", () => {
    expect(isLoopOn(settings(["tuning"]), "judge")).toBe(true);
    expect(isLoopOn(settings(["tuning"]), "tuning")).toBe(false);
    expect(withLoop(["tuning"], "judge", false)).toEqual(["tuning", "judge"]);
    expect(withLoop(["tuning", "judge"], "judge", true)).toEqual(["tuning"]);
    expect(withLoop(undefined, "judge", true)).toEqual([]);
  });

  it("the judge is idle when paused or sampling nothing", () => {
    expect(judgeIdle(settings([]))).toBe(false);
    expect(judgeIdle(settings(["judge"]))).toBe(true);
    expect(judgeIdle(settings([], 0))).toBe(true);
    expect(judgeIdle(undefined)).toBe(false);
  });

  it("writes the search setup in force as label and value", () => {
    expect(
      setupRows({
        weights: { bm25: 1, statement: 1.25, situations: 0.6 },
        rerank: false,
        mmrLambda: 0.7,
        contextualise: true,
        rrfK: 40,
      }),
    ).toEqual([
      { label: "Weights", value: "Keyword 1.0 · Meaning 1.3 · Situations 0.6" },
      { label: "Re-rank", value: "Off" },
      { label: "Diversity", value: "0.70" },
      { label: "Fusion constant", value: "40" },
    ]);
  });
});

describe("what changed", () => {
  it("says each change in plain words, with the collection's noun", () => {
    expect(changeHeadline({ action: "archive", code: "FP-0001" }, "principle")).toBe(
      "Archived FP-0001",
    );
    expect(changeHeadline({ action: "merge", code: "FP-0001" }, "principle")).toBe(
      "Merged FP-0001 into another principle",
    );
    expect(changeHeadline({ action: "learn_query", code: null }, "principle")).toBe(
      "Taught a principle a new way to be found",
    );
    expect(changeHeadline({ action: "promote_setup", code: null }, "principle")).toBe(
      "Changed how this collection is searched",
    );
    expect(changeHeadline({ action: "reindex", code: "FP-0001" }, "principle")).toBe(
      "Reindex on FP-0001",
    );
  });

  it("says what the agent curator did to lessons and notes", () => {
    expect(changeHeadline({ action: "agree", code: "BL-0009" }, "lesson")).toBe(
      "Folded BL-0009 into a lesson that already said it",
    );
    expect(changeHeadline({ action: "add", code: "BN-0003" }, "note")).toBe("Added BN-0003");
    expect(changeHeadline({ action: "retire", code: "BN-0004" }, "note")).toBe(
      "Retired BN-0004: it wasn't helping",
    );
  });

  it("pages back from the oldest change, and only when the page was full", () => {
    const at = (createdAt: string) => ({ createdAt }) as never;
    expect(oldestChange([at("2026-11-08T02:00:00Z"), at("2026-11-07T02:00:00Z")])).toBe(
      "2026-11-07T02:00:00Z",
    );
    expect(oldestChange([])).toBeUndefined();
    expect(mayHaveMore(new Array(30))).toBe(true);
    expect(mayHaveMore(new Array(29))).toBe(false);
  });
});

describe("gapAction", () => {
  const collection = (takesDocuments: boolean, authored: boolean) =>
    ({
      takesDocuments,
      allowedOrigins: authored ? ["distilled", "authored"] : ["synced"],
    }) as Pick<ContextCollection, "takesDocuments" | "allowedOrigins">;

  it("offers the suggested way in, or the other one when the collection can't take it", () => {
    expect(gapAction({ action: "upload_documents" }, collection(true, true))).toBe("upload");
    expect(gapAction({ action: "add_entries" }, collection(true, true))).toBe("entry");
    expect(gapAction({ action: "upload_documents" }, collection(false, true))).toBe("entry");
    expect(gapAction({ action: "add_entries" }, collection(true, false))).toBe("upload");
    expect(gapAction({ action: "add_entries" }, collection(false, false))).toBeNull();
    expect(gapAction({ action: "add_entries" }, undefined)).toBeNull();
  });
});

describe("Connect Claude Code", () => {
  const path = "/v1/context-library/mcp";

  it("derives the MCP endpoint from the configured API base, never a fixed host", () => {
    expect(mcpEndpoint("https://api.example.test", "https://admin.example.test", path)).toBe(
      "https://api.example.test/api/v1/context-library/mcp",
    );
    expect(mcpEndpoint("https://api.example.test/", "https://admin.example.test", path)).toBe(
      "https://api.example.test/api/v1/context-library/mcp",
    );
    // A relative or missing base is served from the page's own origin.
    expect(mcpEndpoint("", "https://admin.example.test", path)).toBe(
      "https://admin.example.test/api/v1/context-library/mcp",
    );
    expect(mcpEndpoint(undefined, "https://admin.example.test", path)).toBe(
      "https://admin.example.test/api/v1/context-library/mcp",
    );
  });

  it("writes the two shell lines and a key's visible start", () => {
    expect(shellLines("https://x.test/api/v1/context-library/mcp", "clr_abc")).toBe(
      "export ALLY_CONTEXT_LIBRARY_URL=https://x.test/api/v1/context-library/mcp\nexport ALLY_CONTEXT_LIBRARY_KEY=clr_abc",
    );
    expect(keyHint("clr_AbCdEf")).toBe("clr_AbCdEf…");
  });
});
