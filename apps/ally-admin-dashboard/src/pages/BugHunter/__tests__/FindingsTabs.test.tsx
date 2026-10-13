import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// See BugFindingsTable's note: @constants reads `cellTypes` off this barrel at
// module-eval time.
vi.mock("@components", () => ({ cellTypes: {} }));

import { FindingsTabs } from "../FindingsTabs";
import { emptyBucketCounts, LifecycleBucket } from "../lifecycleBucket";

const mount = (value: LifecycleBucket = "needs_you", counts = emptyBucketCounts()) => {
  const onChange = vi.fn();
  render(<FindingsTabs counts={counts} value={value} onChange={onChange} panelId="panel" />);
  return { onChange };
};

describe("FindingsTabs", () => {
  it("is a real tablist of five, with one selected and the rest out of the tab order", () => {
    mount("in_progress");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map(tab => tab.textContent)).toEqual([
      "Needs you0",
      "Failed0",
      "In progress0",
      "Backlog0",
      "Done0",
    ]);
    expect(screen.getByRole("tab", { name: /In progress/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /In progress/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Done/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: /Done/ })).toHaveAttribute("aria-controls", "panel");
  });

  it("walks the strip with the arrow keys, wrapping at the ends", () => {
    const { onChange } = mount("needs_you");
    const current = screen.getByRole("tab", { name: /Needs you/ });

    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("failed");
    fireEvent.keyDown(current, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("done");
    fireEvent.keyDown(current, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("done");
    fireEvent.keyDown(current, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("needs_you");
  });

  // Only the two tabs whose next move is a human's get a colour, and only when
  // non-empty: "Backlog 52" is big, not urgent.
  it("colours the Needs you and Failed counts only when they hold something", () => {
    mount("needs_you", { needs_you: 3, failed: 1, in_progress: 2, backlog: 52, done: 400 });

    const pill = (name: RegExp) =>
      screen.getByRole("tab", { name }).querySelector("span") as HTMLElement;
    expect(pill(/Needs you/).className).toContain("orange");
    expect(pill(/Failed/).className).toContain("destructive");
    expect(pill(/Backlog/).className).not.toMatch(/orange|destructive/);
  });
});
