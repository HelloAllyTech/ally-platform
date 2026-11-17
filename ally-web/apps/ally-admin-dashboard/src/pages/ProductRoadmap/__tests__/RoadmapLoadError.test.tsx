import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoadmapLoadError } from "../RoadmapLoadError";

describe("RoadmapLoadError", () => {
  it("says it could not load, not that nothing exists, and retries", () => {
    const onRetry = vi.fn();
    render(<RoadmapLoadError what="the queue" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the queue");
    expect(screen.queryByText(/No opportunities yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables retry while retrying", () => {
    render(<RoadmapLoadError what="the board" onRetry={() => undefined} isRetrying />);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  });
});
