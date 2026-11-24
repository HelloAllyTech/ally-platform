import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StatisticsChartEntry } from "@types";

import { LibraryDrawer } from "../LibraryDrawer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", exists: () => false },
  }),
}));

const chart = (
  id: string,
  state: StatisticsChartEntry["state"] = "available",
): StatisticsChartEntry => ({
  id,
  title: `title ${id}`,
  question: `question ${id}`,
  group: "activity",
  shape: "ranking",
  chart: "bar",
  size: "m",
  state,
  reason: state === "unavailable" ? "needs more sessions" : null,
  scopes: ["organisation"],
  filters: [],
});

const entries = [
  { chart: chart("TSQ-003"), group: "practice" },
  { chart: chart("TSQ-038"), group: "courses" },
  { chart: chart("TSQ-014", "unavailable"), group: "courses" },
];
const groups = [
  { key: "practice", label: "Practice" },
  { key: "courses", label: "Courses" },
  { key: "reviews", label: "Reviews" },
];

describe("the chart library", () => {
  it("offers each chart with one Add button", () => {
    const onAdd = vi.fn();
    render(
      <LibraryDrawer mode="add" entries={entries} groups={groups} addedIds={[]} onAdd={onAdd} />,
    );
    fireEvent.click(screen.getByTestId("statistics-library-add-TSQ-003"));
    expect(onAdd).toHaveBeenCalledWith("TSQ-003");
  });

  it("greys out a chart that has no data yet, with the reason, and will not add it", () => {
    const onAdd = vi.fn();
    render(
      <LibraryDrawer mode="add" entries={entries} groups={groups} addedIds={[]} onAdd={onAdd} />,
    );
    const button = screen.getByTestId("statistics-library-add-TSQ-014") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("needs more sessions")).toBeTruthy();
  });

  it("marks a chart already on the tab and will not add it twice", () => {
    render(
      <LibraryDrawer
        mode="add"
        entries={entries}
        groups={groups}
        addedIds={["TSQ-003"]}
        onAdd={vi.fn()}
      />,
    );
    const button = screen.getByTestId("statistics-library-add-TSQ-003") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("statisticsLibrary.library.added");
  });

  it("filters by the tab's sections, offering only sections that have a chart", () => {
    render(
      <LibraryDrawer mode="add" entries={entries} groups={groups} addedIds={[]} onAdd={vi.fn()} />,
    );
    expect(screen.queryByTestId("statistics-library-group-reviews")).toBeNull();
    fireEvent.click(screen.getByTestId("statistics-library-group-courses"));
    expect(screen.queryByTestId("statistics-library-item-TSQ-003")).toBeNull();
    expect(screen.getByTestId("statistics-library-item-TSQ-038")).toBeTruthy();
  });

  it("searches by title and question", () => {
    render(
      <LibraryDrawer mode="add" entries={entries} groups={groups} addedIds={[]} onAdd={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("statistics-library-search"), {
      target: { value: "TSQ-038" },
    });
    expect(screen.queryByTestId("statistics-library-item-TSQ-003")).toBeNull();
    expect(screen.getByTestId("statistics-library-item-TSQ-038")).toBeTruthy();
  });

  it("in pin mode says Pin and Pinned", () => {
    render(
      <LibraryDrawer
        mode="pin"
        entries={entries}
        groups={groups}
        addedIds={["TSQ-003"]}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByTestId("statistics-library-add-TSQ-038").textContent).toBe(
      "statisticsLibrary.pins.add",
    );
    expect(screen.getByTestId("statistics-library-add-TSQ-003").textContent).toBe(
      "statisticsLibrary.pins.added",
    );
  });

  it("scrolls its list on its own", () => {
    render(
      <LibraryDrawer mode="add" entries={entries} groups={groups} addedIds={[]} onAdd={vi.fn()} />,
    );
    expect(screen.getByTestId("statistics-library-list").className).toContain("overflow-y-auto");
  });
});
