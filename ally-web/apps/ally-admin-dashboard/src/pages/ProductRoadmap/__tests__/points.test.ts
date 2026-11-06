import { describe, expect, it } from "vitest";

import { formatMultiplier, formatPoints } from "../utils/points";

describe("formatPoints", () => {
  it("keeps whole numbers whole and fractions to one decimal", () => {
    expect(formatPoints(41)).toBe("41");
    expect(formatPoints(41.3)).toBe("41.3");
    expect(formatPoints(41.30000001)).toBe("41.3");
    expect(formatPoints(41.96)).toBe("42");
    expect(formatPoints(0)).toBe("0");
  });
  it("treats a missing score as 0", () => {
    expect(formatPoints(undefined)).toBe("0");
    expect(formatPoints(Number.NaN)).toBe("0");
  });
});

describe("formatMultiplier", () => {
  it.each([
    [1, "×1.0"],
    [1.2, "×1.2"],
    [1.15, "×1.15"],
    [1.3, "×1.3"],
  ])("%f -> %s", (m, expected) => {
    expect(formatMultiplier(m)).toBe(expected);
  });
});
