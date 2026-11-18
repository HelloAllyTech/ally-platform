import "@constants";
import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueueTab, QueueTabs } from "../components/QueueTabs";

const TABS: QueueTab[] = [
  { id: "all", label: "All" },
  { id: "todo", label: "To do", badge: 184 },
  { id: "building", label: "Building" },
  { id: "mine", label: "My ideas" },
];

const renderTabs = (onReorder?: (ids: string[]) => void, onSelect = vi.fn()) =>
  render(
    <QueueTabs
      tabs={TABS}
      active="todo"
      onSelect={onSelect}
      onReorder={onReorder}
      scroll={false}
    />,
  );

describe("QueueTabs", () => {
  it("lists default and saved views together, marks the active one and shows a count", () => {
    renderTabs();
    expect(
      screen.getAllByRole("button").map(b => b.textContent?.replace(/\d+$/, "").trim()),
    ).toEqual(["All", "To do", "Building", "My ideas"]);
    expect(screen.getByRole("button", { name: /To do/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("184")).toBeInTheDocument();
  });

  it("selects a tab by its id", () => {
    const onSelect = vi.fn();
    renderTabs(undefined, onSelect);
    fireEvent.click(screen.getByRole("button", { name: "My ideas" }));
    expect(onSelect).toHaveBeenCalledWith("mine");
  });

  it("moves any tab, a saved one included, with Alt+arrows and reports the whole order", () => {
    const onReorder = vi.fn();
    renderTabs(onReorder);
    fireEvent.keyDown(screen.getByRole("button", { name: "My ideas" }), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(onReorder).toHaveBeenLastCalledWith(["all", "todo", "mine", "building"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "All" }), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(onReorder).toHaveBeenCalledTimes(1); // already first
  });

  it("is fixed when the person may not reorder", () => {
    renderTabs(undefined);
    fireEvent.keyDown(screen.getByRole("button", { name: "All" }), {
      key: "ArrowRight",
      altKey: true,
    });
    expect(screen.getAllByRole("button")[0]).toHaveTextContent("All");
  });
});
