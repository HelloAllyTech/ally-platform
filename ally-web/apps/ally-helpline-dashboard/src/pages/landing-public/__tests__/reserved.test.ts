import { describe, expect, it } from "vitest";

import { isReservedFirstSegment, RESERVED_FIRST_SEGMENTS } from "../reserved";

describe("reserved first segments", () => {
  it.each([
    "login",
    "terms",
    "privacy",
    "blog",
    "learn",
    "track",
    "scenario",
    "health",
    "api",
    "admin",
  ])("treats /%s as the app's own", segment => {
    expect(isReservedFirstSegment(segment)).toBe(true);
  });

  it("ignores case", () => {
    expect(isReservedFirstSegment("Blog")).toBe(true);
  });

  it("does not reserve an organization code", () => {
    expect(isReservedFirstSegment("agatsu")).toBe(false);
  });

  it("never contains a parameter segment or an empty one", () => {
    for (const segment of RESERVED_FIRST_SEGMENTS) {
      expect(segment).not.toMatch(/^:/);
      expect(segment).not.toBe("");
    }
  });
});
