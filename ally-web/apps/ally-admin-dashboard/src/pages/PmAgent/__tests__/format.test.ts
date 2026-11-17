import { describe, expect, it } from "vitest";

import { freshnessAge, relativeTime, stepIndex } from "../format";
import { deriveStatusKind } from "../statePanels";
import { stateOf } from "./fixtures";

describe("format", () => {
  it("renders relative times", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(relativeTime("2026-11-15T12:00:00Z", now)).toBe("2d ago");
    expect(relativeTime("2026-11-17T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-11-17T12:00:20Z", now)).toBe("just now");
  });
  it("flags evidence older than a week as stale", () => {
    expect(freshnessAge(10)?.stale).toBe(true);
    expect(freshnessAge(2)).toEqual({ label: "2 days ago", stale: false });
  });
  it("maps statuses to the six steps", () => {
    expect(stepIndex("queued")).toBe(0);
    expect(stepIndex("pr_open")).toBe(3);
    expect(stepIndex("released")).toBe(5);
    expect(stepIndex("handed_off")).toBe(-1);
  });
  it("picks one status to show", () => {
    expect(deriveStatusKind(stateOf({ agentState: "budget_exhausted" }))).toBe("budget_exhausted");
    expect(deriveStatusKind(stateOf({ lastRun: { status: "failed" } }))).toBe("run_failed");
    expect(deriveStatusKind(stateOf())).toBe("none");
  });
});
