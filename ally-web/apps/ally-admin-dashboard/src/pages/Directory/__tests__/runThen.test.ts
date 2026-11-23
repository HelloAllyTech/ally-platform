import { describe, expect, it, vi } from "vitest";

import { runThen } from "../ui";

describe("runThen", () => {
  it("runs the call even when there is no follow-up (the bug: `after?.(await fn())` skipped it)", async () => {
    const fn = vi.fn().mockResolvedValue("saved");
    await runThen(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hands the result to the follow-up", async () => {
    const after = vi.fn();
    await runThen(() => Promise.resolve(42), after);
    expect(after).toHaveBeenCalledWith(42);
  });

  it("rejects when the call fails, and does not run the follow-up", async () => {
    const after = vi.fn();
    await expect(runThen(() => Promise.reject(new Error("nope")), after)).rejects.toThrow("nope");
    expect(after).not.toHaveBeenCalled();
  });
});
