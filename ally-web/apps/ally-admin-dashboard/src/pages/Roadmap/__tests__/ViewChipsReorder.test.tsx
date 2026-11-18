import "@constants";
import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { RoadmapQueueView } from "@types";

import { ViewChips } from "../components/ViewBar";

const VIEWS: RoadmapQueueView[] = ["to-triage", "all", "leading", "for-you"];

const renderChips = (onReorder?: (views: RoadmapQueueView[]) => void) =>
  render(
    <ViewChips
      views={VIEWS}
      active="all"
      savedChips={[]}
      savedOverflow={[]}
      onSelectView={vi.fn()}
      onSelectSaved={vi.fn()}
      onReorder={onReorder}
      scroll={false}
    />,
  );

const labels = () => screen.getAllByRole("button").map(b => b.textContent?.trim());

describe("ViewChips order", () => {
  it("renders the tabs in the order given", () => {
    renderChips();
    expect(labels()).toEqual(VIEWS.map(v => en.roadmapV2.views[v]));
  });

  it("moves a tab with Alt+→ and Alt+← and reports the whole new order", () => {
    const onReorder = vi.fn();
    renderChips(onReorder);
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views["to-triage"] }), {
      key: "ArrowRight",
      altKey: true,
    });
    expect(onReorder).toHaveBeenLastCalledWith(["all", "to-triage", "leading", "for-you"]);
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views["for-you"] }), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(onReorder).toHaveBeenLastCalledWith(["to-triage", "all", "for-you", "leading"]);
  });

  it("ignores moves past either end and plain arrow keys", () => {
    const onReorder = vi.fn();
    renderChips(onReorder);
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views["to-triage"] }), {
      key: "ArrowLeft",
      altKey: true,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views["for-you"] }), {
      key: "ArrowRight",
      altKey: true,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views.all }), {
      key: "ArrowRight",
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("is fixed when the person may not reorder", () => {
    renderChips(undefined);
    fireEvent.keyDown(screen.getByRole("button", { name: en.roadmapV2.views["to-triage"] }), {
      key: "ArrowRight",
      altKey: true,
    });
    expect(labels()).toEqual(VIEWS.map(v => en.roadmapV2.views[v]));
  });
});
