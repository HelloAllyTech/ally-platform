import { describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));

import {
  asArray,
  asHttpUrl,
  formatElapsed,
  formatMinutes,
  formatSeconds,
  formatUsd,
  humanizeToken,
  summarizeCompletion,
} from "../courseCopilotFormat";

describe("formatUsd", () => {
  it("rounds to cents", () => {
    expect(formatUsd(2.4)).toBe("$2.40");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("does not call real but tiny spend free", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("copes with missing values", () => {
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsd(undefined)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("durations", () => {
  it("formats planned minutes", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(75)).toBe("1 h 15 min");
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(192_000)).toBe("3m 12s");
    expect(formatElapsed(3_840_000)).toBe("1h 4m");
    expect(formatElapsed(-5)).toBe("0s");
  });

  it("formats completion-rule seconds", () => {
    expect(formatSeconds(45)).toBe("45 s");
    expect(formatSeconds(180)).toBe("3 min");
  });
});

describe("asArray", () => {
  it("returns arrays as they are and everything else as an empty list", () => {
    expect(asArray<number>([1, 2])).toEqual([1, 2]);
    // The Builder crash: a string has a length and then fails on .map.
    expect(asArray<number>("not a list")).toEqual([]);
    expect(asArray<number>(null)).toEqual([]);
    expect(asArray<number>({ 0: "x" })).toEqual([]);
  });
});

describe("humanizeToken", () => {
  it("makes a raw id readable", () => {
    expect(humanizeToken("mcq_single")).toBe("Mcq single");
    expect(humanizeToken("TREX_RUNNER")).toBe("Trex runner");
    expect(humanizeToken("")).toBe("");
  });
});

describe("summarizeCompletion", () => {
  it("names each rule that is set", () => {
    expect(
      summarizeCompletion({ minScore: 60, passScore: 70, watchPct: 90, minReadSeconds: 120 }),
    ).toEqual(["Min score 60", "Pass mark 70", "Watch 90%", "Read for 2 min"]);
  });

  it("ignores anything that is not a finite number", () => {
    expect(summarizeCompletion({ passScore: "70", watchPct: null, minScore: Number.NaN })).toEqual(
      [],
    );
    expect(summarizeCompletion(null)).toEqual([]);
    expect(summarizeCompletion("pass")).toEqual([]);
  });
});

describe("asHttpUrl", () => {
  it("passes plain http(s) links through", () => {
    expect(asHttpUrl(" https://youtu.be/abc ")).toBe("https://youtu.be/abc");
    expect(asHttpUrl("http://example.com/clip.mp4")).toBe("http://example.com/clip.mp4");
  });

  it("refuses anything that would run script or is not a link at all", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<script>", "//evil.test", "nope", "", null, 7]) {
      expect(asHttpUrl(value)).toBeNull();
    }
  });
});
