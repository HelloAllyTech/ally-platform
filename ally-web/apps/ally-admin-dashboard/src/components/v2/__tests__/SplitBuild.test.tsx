import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SPLIT_STORAGE_KEY, SplitBuild, type SplitBuildLabels } from "../SplitBuild";

const labels: SplitBuildLabels = {
  group: "Build and test",
  build: "Build",
  test: "Test",
  divider: "Resize the build and test areas",
};

/** A matchMedia whose answer a test can change, firing the "change" listeners. */
const media = { matches: true, listeners: new Set<() => void>() };
const setWide = (matches: boolean) => {
  media.matches = matches;
  act(() => media.listeners.forEach(fn => fn()));
};

const renderSplit = () =>
  render(
    <SplitBuild
      labels={labels}
      build={<button type="button">build content</button>}
      test={<button type="button">test content</button>}
    />,
  );

const divider = () => screen.getByRole("separator");

beforeEach(() => {
  media.matches = true;
  media.listeners.clear();
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SplitBuild at 1280 px and wider", () => {
  it("shows both halves and an accessible divider at 50%", () => {
    renderSplit();
    expect(screen.getByText("build content")).toBeTruthy();
    expect(screen.getByText("test content")).toBeTruthy();
    const d = divider();
    expect(d.getAttribute("aria-orientation")).toBe("vertical");
    expect(d.getAttribute("aria-valuemin")).toBe("30");
    expect(d.getAttribute("aria-valuemax")).toBe("70");
    expect(d.getAttribute("aria-valuenow")).toBe("50");
    expect(d.tabIndex).toBe(0);
  });

  it("keeps the build half first in the tab order", () => {
    renderSplit();
    const order = [screen.getByText("build content"), divider(), screen.getByText("test content")];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(
        order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("moves 2% with the arrows, 10% with Shift, and jumps with Home and End", () => {
    renderSplit();
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(divider().getAttribute("aria-valuenow")).toBe("52");
    fireEvent.keyDown(divider(), { key: "ArrowLeft" });
    fireEvent.keyDown(divider(), { key: "ArrowLeft" });
    expect(divider().getAttribute("aria-valuenow")).toBe("48");
    fireEvent.keyDown(divider(), { key: "ArrowRight", shiftKey: true });
    expect(divider().getAttribute("aria-valuenow")).toBe("58");
    fireEvent.keyDown(divider(), { key: "Home" });
    expect(divider().getAttribute("aria-valuenow")).toBe("30");
    fireEvent.keyDown(divider(), { key: "End" });
    expect(divider().getAttribute("aria-valuenow")).toBe("70");
  });

  it("clamps between 30% and 70%", () => {
    renderSplit();
    fireEvent.keyDown(divider(), { key: "End" });
    fireEvent.keyDown(divider(), { key: "ArrowRight", shiftKey: true });
    expect(divider().getAttribute("aria-valuenow")).toBe("70");
    fireEvent.keyDown(divider(), { key: "Home" });
    fireEvent.keyDown(divider(), { key: "ArrowLeft", shiftKey: true });
    expect(divider().getAttribute("aria-valuenow")).toBe("30");
  });

  it("has no layout buttons: the divider is the only control", () => {
    renderSplit();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Half and half")).toBeNull();
    expect(screen.queryByText("More room for the assistant")).toBeNull();
    expect(screen.queryByText("Assistant only")).toBeNull();
    expect(divider().getAttribute("aria-valuenow")).toBe("50");
  });

  it("ignores an older 'assistant only' choice and keeps both halves", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ pct: 50, only: true }));
    renderSplit();
    expect(divider()).toBeTruthy();
    expect(screen.getByRole("button", { name: "build content" })).toBeTruthy();
  });

  it("remembers the choice, and survives storage that throws", () => {
    const { unmount } = renderSplit();
    fireEvent.keyDown(divider(), { key: "ArrowRight", shiftKey: true });
    expect(JSON.parse(window.localStorage.getItem(SPLIT_STORAGE_KEY) as string)).toEqual({
      pct: 60,
    });
    unmount();
    renderSplit();
    expect(divider().getAttribute("aria-valuenow")).toBe("60");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.keyDown(divider(), { key: "ArrowLeft" });
    expect(divider().getAttribute("aria-valuenow")).toBe("58");
    vi.restoreAllMocks();
  });

  it("clamps a stored value that is out of range", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ pct: 95 }));
    renderSplit();
    expect(divider().getAttribute("aria-valuenow")).toBe("70");
  });
});

describe("SplitBuild below 1280 px", () => {
  beforeEach(() => {
    media.matches = false;
  });

  it("shows Build and Test as tabs, one at a time", () => {
    renderSplit();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["Build", "Test"]);
    expect(screen.getByRole("tab", { name: "Build" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Build" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Test" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Test" }));
    expect(screen.getByRole("tabpanel", { name: "Test" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Build" })).toBeNull();
  });

  it("moves between tabs with the arrow keys", () => {
    renderSplit();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Build" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Test" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Test" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Build" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches layout when the window crosses 1280 px", () => {
    renderSplit();
    expect(screen.queryByRole("separator")).toBeNull();
    setWide(true);
    expect(screen.getByRole("separator")).toBeTruthy();
    setWide(false);
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
