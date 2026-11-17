import "@constants";
import React from "react";

import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@ally-ui-mono/ui-shared", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureEvent: capture,
}));

import {
  JOB_STALE_AFTER_MS,
  ROADMAP_ENTRY_GAP_MS,
  isRoadmapEntry,
  jobClock,
  useRoadmapJobTimer,
  useRoadmapPresence,
} from "../hooks/useRoadmapJobTimer";
import { RoadmapRoleProvider } from "../RoadmapGate";

const owner = ({ children }: { children: React.ReactNode }) => (
  <RoadmapRoleProvider value={{ role: "owner", can: {} } as never}>{children}</RoadmapRoleProvider>
);

const T0 = new Date("2026-11-17T10:00:00Z").getTime();

describe("jobClock", () => {
  beforeEach(() => jobClock.reset());

  it("times one attempt from start to complete", () => {
    expect(jobClock.start("capture_idea", null, T0)).toBe(true);
    expect(jobClock.complete("capture_idea", null, T0 + 12_000)).toBe(12_000);
    // Completed: a second completion has nothing to time.
    expect(jobClock.complete("capture_idea", null, T0 + 13_000)).toBeNull();
  });

  it("keeps the running attempt unless told to restart", () => {
    jobClock.start("draft_to_submitted", "OPP-0001", T0);
    expect(jobClock.start("draft_to_submitted", "OPP-0001", T0 + 5_000)).toBe(false);
    expect(jobClock.complete("draft_to_submitted", "OPP-0001", T0 + 60_000)).toBe(60_000);

    jobClock.start("triage_one", "OPP-0002", T0);
    expect(jobClock.start("triage_one", "OPP-0002", T0 + 5_000, true)).toBe(true);
    expect(jobClock.complete("triage_one", "OPP-0002", T0 + 9_000)).toBe(4_000);
  });

  it("keeps a clock per idea for per-idea jobs, case-insensitively", () => {
    jobClock.start("triage_one", "OPP-0001", T0);
    jobClock.start("triage_one", "opp-0002", T0 + 1_000);
    expect(jobClock.complete("triage_one", "OPP-0002", T0 + 4_000)).toBe(3_000);
    expect(jobClock.complete("triage_one", "OPP-0001", T0 + 4_000)).toBe(4_000);
  });

  it("uses one clock for find_my_idea, whichever idea completes it", () => {
    jobClock.start("find_my_idea", null, T0);
    expect(jobClock.complete("find_my_idea", "OPP-0042", T0 + 7_000)).toBe(7_000);
  });

  it("treats a stale start as abandoned: no completion, and a new start replaces it", () => {
    jobClock.start("settle_answers", "OPP-0003", T0);
    expect(jobClock.isRunning("settle_answers", "OPP-0003", T0 + JOB_STALE_AFTER_MS)).toBe(false);
    expect(jobClock.complete("settle_answers", "OPP-0003", T0 + JOB_STALE_AFTER_MS)).toBeNull();

    jobClock.start("settle_answers", "OPP-0003", T0);
    expect(jobClock.start("settle_answers", "OPP-0003", T0 + JOB_STALE_AFTER_MS + 1)).toBe(true);
  });

  it("never completes a job that did not start", () => {
    expect(jobClock.complete("answer_from_notification", "OPP-0009", T0)).toBeNull();
  });
});

describe("isRoadmapEntry and useRoadmapPresence", () => {
  beforeEach(() => jobClock.reset());
  afterEach(() => vi.useRealTimers());

  const Frame: React.FC = () => {
    useRoadmapPresence();
    return null;
  };

  it("is an entry the first time, and not while a frame is mounted", () => {
    expect(isRoadmapEntry()).toBe(true);
    const { unmount } = render(<Frame />);
    expect(isRoadmapEntry()).toBe(false);
    unmount();
  });

  it("is not an entry right after moving between Roadmap pages, but is after leaving", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { unmount } = render(<Frame />);
    unmount();
    expect(isRoadmapEntry(T0 + 100)).toBe(false);
    expect(isRoadmapEntry(T0 + ROADMAP_ENTRY_GAP_MS + 1)).toBe(true);
  });
});

describe("useRoadmapJobTimer", () => {
  beforeEach(() => {
    jobClock.reset();
    capture.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("sends started once per attempt, then completed with the duration, role and item id", () => {
    const { result } = renderHook(() => useRoadmapJobTimer(), { wrapper: owner });
    act(() => result.current.start("triage_one", { itemId: "OPP-0414" }));
    act(() => result.current.start("triage_one", { itemId: "OPP-0414" }));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("roadmap_job_started", {
      job: "triage_one",
      role: "owner",
      item_id: "OPP-0414",
    });

    vi.setSystemTime(T0 + 21_500);
    act(() => result.current.complete("triage_one", { itemId: "OPP-0414" }));
    expect(capture).toHaveBeenLastCalledWith("roadmap_job_completed", {
      job: "triage_one",
      role: "owner",
      duration_ms: 21_500,
      item_id: "OPP-0414",
    });
  });

  it("leaves out item_id where there is none, and sends nothing for a completion with no start", () => {
    const { result } = renderHook(() => useRoadmapJobTimer(), { wrapper: owner });
    act(() => result.current.complete("find_my_idea", { itemId: "OPP-0001" }));
    expect(capture).not.toHaveBeenCalled();

    act(() => result.current.start("find_my_idea"));
    expect(capture).toHaveBeenCalledWith("roadmap_job_started", {
      job: "find_my_idea",
      role: "owner",
    });
  });

  it("reads the role as none outside the Roadmap gate", () => {
    const { result } = renderHook(() => useRoadmapJobTimer());
    act(() => result.current.start("capture_idea"));
    expect(capture).toHaveBeenCalledWith("roadmap_job_started", {
      job: "capture_idea",
      role: "none",
    });
  });

  it("never sends free text: only the known keys", () => {
    const { result } = renderHook(() => useRoadmapJobTimer(), { wrapper: owner });
    act(() => result.current.start("settle_answers", { itemId: "OPP-0007" }));
    vi.setSystemTime(T0 + 1_000);
    act(() => result.current.complete("settle_answers", { itemId: "OPP-0007" }));
    for (const [, props] of capture.mock.calls) {
      expect(Object.keys(props).sort()).toEqual(expect.arrayContaining(["job", "role"]));
      Object.keys(props).forEach(key =>
        expect(["job", "role", "item_id", "duration_ms"]).toContain(key),
      );
    }
  });
});
