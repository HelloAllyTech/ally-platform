import { describe, expect, it } from "vitest";

import type { BuilderPullRequest } from "@types";

import { automationBudget, formatTimeLeft } from "../issueBuild";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-14T12:00:00Z");

const pr = (extra: Partial<BuilderPullRequest> = {}): BuilderPullRequest =>
  ({
    id: "pr-1",
    merged: false,
    state: "open",
    fixRunCount: 0,
    reviewHistory: [{ sha: "a", count: 1, keys: [], at: "2026-10-14T11:00:00Z" }],
    ...extra,
  }) as BuilderPullRequest;

describe("formatTimeLeft", () => {
  it("reads in hours and minutes, and gives up under a minute", () => {
    expect(formatTimeLeft(70 * 60_000)).toBe("1h 10m");
    expect(formatTimeLeft(2 * HOUR)).toBe("2h");
    expect(formatTimeLeft(45 * 60_000)).toBe("45m");
    expect(formatTimeLeft(30_000)).toBeNull();
  });
});

describe("automationBudget", () => {
  it("counts the round from fix runs and the clock from the first review", () => {
    expect(automationBudget(pr({ fixRunCount: 1 }), 3, 3 * HOUR, NOW)).toEqual({
      round: 2,
      maxRounds: 3,
      msLeft: 2 * HOUR,
    });
  });

  it("never reads past the ceiling, or below zero time", () => {
    expect(automationBudget(pr({ fixRunCount: 5 }), 3, HOUR / 2, NOW)).toEqual({
      round: 3,
      maxRounds: 3,
      msLeft: 0,
    });
  });

  it("is absent before the first review, once escalated, merged or closed", () => {
    expect(automationBudget(pr({ reviewHistory: [] }), 3, HOUR, NOW)).toBeNull();
    expect(automationBudget(pr({ reviewHistory: null }), 3, HOUR, NOW)).toBeNull();
    expect(automationBudget(pr({ needsHumanAt: "2026-10-14T11:30:00Z" }), 3, HOUR, NOW)).toBeNull();
    expect(automationBudget(pr({ merged: true }), 3, HOUR, NOW)).toBeNull();
    expect(automationBudget(pr({ state: "closed" }), 3, HOUR, NOW)).toBeNull();
  });

  it("keeps the round when the first review carries no time", () => {
    expect(
      automationBudget(pr({ reviewHistory: [{ sha: "a", count: 1, keys: [] }] }), 3, HOUR, NOW),
    ).toEqual({ round: 1, maxRounds: 3, msLeft: null });
  });
});
