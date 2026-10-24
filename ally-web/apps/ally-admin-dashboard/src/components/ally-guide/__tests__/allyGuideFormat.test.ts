import { describe, expect, it } from "vitest";

import {
  approverLabel,
  errorStatus,
  flattenToRows,
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  isForbiddenError,
  isNotFoundError,
  toPrettyJson,
} from "../allyGuideFormat";

describe("formatMs", () => {
  it("uses milliseconds under a second and seconds above it", () => {
    expect(formatMs(840)).toBe("840 ms");
    expect(formatMs(1_240)).toBe("1.24 s");
    expect(formatMs(12_400)).toBe("12.4 s");
  });

  it("shows a dash rather than a number it does not have", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(undefined)).toBe("—");
    expect(formatMs(Number.NaN)).toBe("—");
  });
});

describe("formatUsd", () => {
  it("keeps four places under a cent so almost-nothing is not shown as nothing", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.3456)).toBe("$12.35");
  });

  it("accepts the string a numeric column arrives as", () => {
    expect(formatUsd("0.120000")).toBe("$0.12");
    expect(formatUsd("")).toBe("—");
    expect(formatUsd(null)).toBe("—");
  });
});

describe("formatPercent and formatCount", () => {
  it("formats a ratio and compacts a count", () => {
    expect(formatPercent(0.9842)).toBe("98.4%");
    expect(formatPercent(null)).toBe("—");
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12_345)).toBe("12.3k");
    expect(formatCount(1_200_000)).toBe("1.2M");
    expect(formatCount(null)).toBe("—");
  });
});

describe("flattenToRows", () => {
  it("flattens nested policy to one dotted row per leaf, in order", () => {
    expect(
      flattenToRows({ prose: { maxWords: { lead: 90, walk: 60 } }, firstWinMaxMinutes: 5 }),
    ).toEqual([
      { key: "prose.maxWords.lead", value: "90" },
      { key: "prose.maxWords.walk", value: "60" },
      { key: "firstWinMaxMinutes", value: "5" },
    ]);
  });

  it("spells out booleans and nulls instead of printing raw JSON", () => {
    expect(flattenToRows({ a: true, b: false, c: null })).toEqual([
      { key: "a", value: "yes" },
      { key: "b", value: "no" },
      { key: "c", value: "none" },
    ]);
  });

  it("joins an array of scalars and indexes an array of objects", () => {
    expect(flattenToRows({ lessons: ["x", "y"] })).toEqual([{ key: "lessons", value: "x, y" }]);
    expect(flattenToRows({ routes: [{ model: "m1" }, { model: "m2" }] })).toEqual([
      { key: "routes.0.model", value: "m1" },
      { key: "routes.1.model", value: "m2" },
    ]);
  });

  it("drops an empty object or array instead of showing a row with nothing in it", () => {
    expect(flattenToRows({ a: {}, b: [], c: 1 })).toEqual([{ key: "c", value: "1" }]);
    expect(flattenToRows(undefined)).toEqual([{ key: "", value: "none" }]);
  });
});

describe("toPrettyJson", () => {
  it("returns a string as it is and indents everything else", () => {
    expect(toPrettyJson("steer: level 2")).toBe("steer: level 2");
    expect(toPrettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("does not throw on something JSON cannot hold", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toPrettyJson(cyclic)).not.toThrow();
  });
});

describe("error helpers", () => {
  it("reads the HTTP status off an RTK Query error", () => {
    expect(errorStatus({ status: 403, data: {} })).toBe(403);
    expect(errorStatus({ status: "FETCH_ERROR" })).toBeUndefined();
    expect(errorStatus(null)).toBeUndefined();
    expect(isForbiddenError({ status: 403 })).toBe(true);
    expect(isForbiddenError({ status: 500 })).toBe(false);
    expect(isNotFoundError({ status: 404 })).toBe(true);
  });
});

describe("approverLabel", () => {
  const strings = { you: "you", user: (id: number) => `user ${id}`, unknown: "someone unrecorded" };

  it("says 'you' for the signed-in admin, a user id otherwise, and admits when it is unrecorded", () => {
    expect(approverLabel(12, 12, strings)).toBe("you");
    expect(approverLabel(12, "12", strings)).toBe("you");
    expect(approverLabel(12, 7, strings)).toBe("user 12");
    expect(approverLabel(null, 7, strings)).toBe("someone unrecorded");
    expect(approverLabel(12, undefined, strings)).toBe("user 12");
  });

  it("prefers the person's name to their id, and 'you' to their name", () => {
    expect(approverLabel(12, 7, strings, "Dr Rao")).toBe("Dr Rao");
    expect(approverLabel(12, 12, strings, "Dr Rao")).toBe("you");
    // A blank or missing name falls back to the id rather than showing nothing.
    expect(approverLabel(12, 7, strings, "  ")).toBe("user 12");
    expect(approverLabel(12, 7, strings, null)).toBe("user 12");
  });
});
