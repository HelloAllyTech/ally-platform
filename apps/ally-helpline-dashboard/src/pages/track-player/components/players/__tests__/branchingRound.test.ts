import { describe, expect, it } from "vitest";

import { timeUntilRound } from "../branchingRound";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe("timeUntilRound", () => {
  it("rounds down to whole hours from an hour up", () => {
    expect(timeUntilRound(at(23.7 * 3_600_000), NOW)).toEqual({ unit: "hour", count: 23 });
    expect(timeUntilRound(at(3_600_000), NOW)).toEqual({ unit: "hour", count: 1 });
  });

  it("uses minutes under an hour and never reads below one minute", () => {
    expect(timeUntilRound(at(59 * 60_000), NOW)).toEqual({ unit: "minute", count: 59 });
    expect(timeUntilRound(at(5_000), NOW)).toEqual({ unit: "minute", count: 1 });
  });

  it("is null once the time has passed or is invalid", () => {
    expect(timeUntilRound(at(0), NOW)).toBeNull();
    expect(timeUntilRound(at(-1000), NOW)).toBeNull();
    expect(timeUntilRound("nope", NOW)).toBeNull();
  });
});
