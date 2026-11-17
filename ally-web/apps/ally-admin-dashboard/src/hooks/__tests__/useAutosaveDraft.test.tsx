import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutosaveDraft } from "../useAutosaveDraft";

describe("useAutosaveDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("saves after a quiet period, writes a local draft, and reports Saved", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosaveDraft({ storageKey: "k", value: v, save, delayMs: 100 }),
      { initialProps: { v: { a: 1 } } },
    );
    expect(result.current.status).toBe("idle");
    rerender({ v: { a: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(save).toHaveBeenCalledWith({ a: 2 });
    expect(result.current.status).toBe("saved");
    expect(localStorage.getItem("k")).toBe('{"a":2}');
  });

  it("reports error when save rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("x"));
    const { result, rerender } = renderHook(
      ({ v }) => useAutosaveDraft({ storageKey: "k", value: v, save, delayMs: 10 }),
      { initialProps: { v: 1 } },
    );
    rerender({ v: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(result.current.status).toBe("error");
  });
});
