import { describe, expect, it } from "vitest";

import { AllyGuideStageTiming } from "@types";

import { buildWaterfall } from "../waterfall";

const stage = (
  name: string,
  startedAt: number,
  ms: number,
  outcome: AllyGuideStageTiming["outcome"] = "ok",
): AllyGuideStageTiming => ({ stage: name, startedAt, ms, outcome });

describe("buildWaterfall", () => {
  it("lays stages on one shared scale, offset from the first stage that ran", () => {
    const result = buildWaterfall(
      [stage("admit", 1_000, 100), stage("sentinel", 1_100, 300), stage("reply", 1_400, 600)],
      null,
    );

    expect(result.totalMs).toBe(1_000);
    expect(result.rows.map(row => [row.stage, row.offsetPct, row.widthPct])).toEqual([
      ["admit", 0, 10],
      ["sentinel", 10, 30],
      ["reply", 40, 60],
    ]);
  });

  it("places the first-token marker on the same scale as the bars", () => {
    const result = buildWaterfall([stage("admit", 0, 200), stage("reply", 200, 800)], 500);

    expect(result.firstTokenPct).toBe(50);
  });

  it("has no marker when the turn never produced a first token", () => {
    expect(buildWaterfall([stage("admit", 0, 10)], null).firstTokenPct).toBeNull();
    expect(buildWaterfall([stage("admit", 0, 10)], undefined).firstTokenPct).toBeNull();
  });

  it("keeps a marker that landed after the last stage inside the track", () => {
    expect(buildWaterfall([stage("admit", 0, 100)], 5_000).firstTokenPct).toBe(100);
  });

  it("gives a very fast stage a bar wide enough to find", () => {
    const [fast, slow] = buildWaterfall([stage("fast", 0, 1), stage("slow", 1, 9_999)], null).rows;

    expect(fast.widthPct).toBeGreaterThan(0.5);
    expect(slow.offsetPct + slow.widthPct).toBeLessThanOrEqual(100);
  });

  it("gives a skipped stage no bar, because its start time says nothing about where it would sit", () => {
    const result = buildWaterfall(
      [stage("admit", 1_000, 100), stage("guard", 9_999_999, 0, "skipped")],
      null,
    );

    const guard = result.rows.find(row => row.stage === "guard");
    expect(guard).toMatchObject({ widthPct: 0, outcome: "skipped" });
    // And it does not stretch the scale to its own meaningless timestamp.
    expect(result.totalMs).toBe(100);
  });

  it("carries a stopped or failed stage's outcome through for the caller to colour and spell out", () => {
    const result = buildWaterfall(
      [stage("guard.input", 0, 50, "stopped"), stage("reply", 50, 80, "error")],
      null,
    );

    expect(result.rows.map(row => row.outcome)).toEqual(["stopped", "error"]);
  });

  it("copes with stages that all took no time at all", () => {
    const result = buildWaterfall([stage("admit", 5, 0), stage("persist", 5, 0)], null);

    expect(result.totalMs).toBe(1);
    expect(result.rows.every(row => Number.isFinite(row.offsetPct + row.widthPct))).toBe(true);
  });

  it("copes with nothing, and with only skipped stages", () => {
    expect(buildWaterfall([], 100)).toMatchObject({ totalMs: 0, rows: [], firstTokenPct: null });
    expect(buildWaterfall(undefined, null).rows).toEqual([]);
    const onlySkipped = buildWaterfall([stage("a", 1, 0, "skipped")], 100);
    expect(onlySkipped.rows).toHaveLength(1);
    expect(onlySkipped.firstTokenPct).toBeNull();
  });
});
