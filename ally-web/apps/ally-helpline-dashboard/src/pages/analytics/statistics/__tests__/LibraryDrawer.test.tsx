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
});

describe("the chart library", () => {
  const charts = [
    chart("TSQ-003", ["organisation", "course", "learner"]),
    chart("TSQ-041", ["course"]),
    chart("TSQ-063", ["learner"]),
  ];

  it("offers each organisation-wide chart with one Add button and nothing about a course or learner", () => {
    const onAdd = vi.fn();
    render(<LibraryDrawer charts={charts} addedIds={[]} onAdd={onAdd} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("statistics-library-add-TSQ-003"));
    expect(onAdd).toHaveBeenCalledWith("TSQ-003");
    expect(screen.queryByTestId("statistics-library-add-TSQ-003-course")).toBeNull();
    expect(screen.queryByTestId("statistics-library-add-TSQ-003-learner")).toBeNull();
  });

  it("leaves out charts that only make sense for one course or one learner", () => {
    render(<LibraryDrawer charts={charts} addedIds={[]} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("statistics-library-item-TSQ-003")).toBeTruthy();
    expect(screen.queryByTestId("statistics-library-item-TSQ-041")).toBeNull();
    expect(screen.queryByTestId("statistics-library-item-TSQ-063")).toBeNull();
  });

  it("scrolls its list on its own", () => {
    render(<LibraryDrawer charts={charts} addedIds={[]} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("statistics-library-list").className).toContain("overflow-y-auto");
  });
});
