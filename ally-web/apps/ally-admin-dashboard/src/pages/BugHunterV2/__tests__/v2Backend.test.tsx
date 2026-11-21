import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BugFinding } from "@types";

import { byId, isV2Id, mergeFindings } from "../v2BackendCore";

const f = (id: string, reportedBugId: string | null = null) =>
  ({ id, reportedBugId, title: id }) as unknown as BugFinding;

describe("Bug Hunter v2 behind the old page", () => {
  it("tells a v2 bug from an old finding by its id", () => {
    expect(isV2Id("v2-10")).toBe(true);
    expect(isV2Id("976eb704-4a94-43a6-a593-f1d4e09ecc98")).toBe(false);
    expect(isV2Id(null)).toBe(false);
  });

  it("lists v2's bugs first, then the old history, without a reported bug twice", () => {
    const out = mergeFindings(
      { items: [f("v2-10", "opp-1")], count: 1 },
      { items: [f("old-a", "opp-1"), f("old-b")], count: 2 },
    );
    expect(out?.items.map(x => x.id)).toEqual(["v2-10", "old-b"]);
    expect(out?.count).toBe(2);
    // the old history alone still shows when v2 has nothing yet
    expect(mergeFindings(undefined, { items: [f("old-b")], count: 1 })?.items).toHaveLength(1);
    expect(mergeFindings(undefined, undefined)).toBeUndefined();
  });

  it("each button acts on v2 for a v2 bug and on the old Bug Hunter for its own", () => {
    const v2 = vi.fn();
    const v1 = vi.fn();
    const useApprove = byId(
      () => [v2, { isLoading: false }] as const,
      () => [v1, { isLoading: true }] as const,
    );
    const { result } = renderHook(() => useApprove());
    act(() => {
      result.current[0]("v2-10");
      result.current[0]({ id: "976eb704-4a94-43a6-a593-f1d4e09ecc98" });
    });
    expect(v2).toHaveBeenCalledWith("v2-10");
    expect(v1).toHaveBeenCalledWith({ id: "976eb704-4a94-43a6-a593-f1d4e09ecc98" });
    expect(result.current[1].isLoading).toBe(true);
  });
});
