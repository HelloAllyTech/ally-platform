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

// The drawer only offers charts the build can draw.
vi.mock("../renderers", () => ({
  CHART_RENDERERS: { "TSQ-003": {}, "TSQ-041": {}, "TSQ-063": {} },
}));

const chart = (id: string, scopes: StatisticsChartEntry["scopes"]): StatisticsChartEntry => ({
  id,
  title: `title ${id}`,
  question: `question ${id}`,
  group: "activity",
  shape: "ranking",
  chart: "bar",
  size: "m",
  state: "available",
  reason: null,
  scopes,
  filters: scopes
    .filter(k => k !== "organisation")
    .map(key => ({ key, required: !scopes.includes("organisation") })),
});

describe("the chart library", () => {
  const charts = [
    chart("TSQ-003", ["organisation", "course"]),
    chart("TSQ-041", ["course"]),
    chart("TSQ-063", ["organisation", "learner"]),
  ];

  it("offers each chart with one Add button, whatever filters it has", () => {
    const onAdd = vi.fn();
    render(<LibraryDrawer charts={charts} addedIds={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByTestId("statistics-library-add-TSQ-003"));
    expect(onAdd).toHaveBeenCalledWith("TSQ-003");
    expect(screen.getByTestId("statistics-library-add-TSQ-041")).toBeTruthy();
    expect(screen.getByTestId("statistics-library-add-TSQ-063")).toBeTruthy();
    expect(screen.queryByTestId("statistics-library-add-TSQ-003-course")).toBeNull();
  });

  it("scrolls its list on its own", () => {
    render(<LibraryDrawer charts={charts} addedIds={[]} onAdd={vi.fn()} />);
    expect(screen.getByTestId("statistics-library-list").className).toContain("overflow-y-auto");
  });
});
