import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StatisticsChartEntry, StatisticsViewConfig } from "@types";

import { StatisticsView } from "../StatisticsView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en", exists: () => false },
  }),
}));

vi.mock("@components", () => ({ ToggleButtonGroup: () => null }));
vi.mock("@api", () => ({
  useGetStatisticsScopeOptionsQuery: () => ({ data: [{ id: "c1", label: "Basic Counselling" }] }),
}));
vi.mock("../ScopeChooser", () => ({ ScopeChooser: () => null }));
vi.mock("../renderers", () => ({
  CHART_RENDERERS: Object.fromEntries(
    ["TSQ-038", "TSQ-042", "TSQ-043"].map(id => [id, { kind: "data", pin: () => null }]),
  ),
  DashboardContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
// The card itself is tested on its own; here it shows what the view handed it.
vi.mock("../ChartHost", () => ({
  ChartHost: (props: {
    entry: StatisticsChartEntry;
    filters?: Record<string, string>;
    lockedFilters?: string[];
    onTogglePin?: () => void;
    onFiltersChange?: (f: Record<string, string>) => void;
    pinned?: boolean;
  }) => (
    <div data-testid={`statistics-card-${props.entry.id}`}>
      <div data-testid={`card-${props.entry.id}`}>
        <span data-testid={`filters-${props.entry.id}`}>{JSON.stringify(props.filters)}</span>
        <span data-testid={`locked-${props.entry.id}`}>
          {JSON.stringify(props.lockedFilters ?? [])}
        </span>
        <span data-testid={`pinned-${props.entry.id}`}>{String(props.pinned)}</span>
        <span data-testid={`canpin-${props.entry.id}`}>{String(!!props.onTogglePin)}</span>
        <button type="button" onClick={() => props.onTogglePin?.()}>
          pin-{props.entry.id}
        </button>
        <button
          type="button"
          onClick={() => props.onFiltersChange?.({ course: "c1", simulation: "9" })}
        >
          filter-{props.entry.id}
        </button>
      </div>
    </div>
  ),
}));

const chart = (id: string): StatisticsChartEntry => ({
  id,
  title: `title ${id}`,
  question: `question ${id}`,
  group: "courses",
  shape: "ranking",
  chart: "bar",
  size: "m",
  state: "available",
  reason: null,
  scopes: ["organisation", "course"],
  filters: [],
});

const charts = ["TSQ-038", "TSQ-042", "TSQ-043"].map(chart);

const courseView: StatisticsViewConfig = {
  id: "course",
  subject: "course",
  sections: [
    { key: "allCourses", subject: false, charts: ["TSQ-038"] },
    { key: "useOverTime", subject: true, charts: ["TSQ-042", "TSQ-043"] },
  ],
  defaultLayout: [],
};

const renderView = (over: Partial<React.ComponentProps<typeof StatisticsView>> = {}) => {
  const props = {
    view: courseView,
    charts,
    range: "90d" as const,
    onRangeChange: vi.fn(),
    layoutKeys: ["TSQ-038", "TSQ-042", "TSQ-043"],
    onLayoutChange: vi.fn(),
    subjectId: "c1",
    onSubjectChange: vi.fn(),
    pinnedIds: new Set<string>(),
    onTogglePin: vi.fn(),
    ...over,
  };
  render(<StatisticsView {...props} />);
  return props;
};

describe("a chart tab", () => {
  it("draws a heading for each section, and the subject heading once", () => {
    renderView();
    expect(screen.getByTestId("statistics-section-allCourses")).toBeTruthy();
    expect(screen.getByTestId("statistics-section-useOverTime")).toBeTruthy();
    expect(screen.getAllByTestId("statistics-subject-heading")).toHaveLength(1);
  });

  it("keeps each heading in the same grid as its cards, so a card cannot be packed up past another section's heading", () => {
    renderView();
    const heading = screen.getByTestId("statistics-section-allCourses");
    const run = screen.getByTestId("statistics-run-allCourses");
    expect(heading.parentElement).toBe(run);
    expect(within(run).getAllByTestId(/^statistics-card-/).length).toBeGreaterThan(0);
    expect(within(run).queryByTestId("statistics-section-useOverTime")).toBeNull();
  });

  it("draws no subject heading on a tab that has no overview above it", () => {
    renderView({
      view: {
        ...courseView,
        sections: [{ key: "useOverTime", subject: true, charts: ["TSQ-042", "TSQ-043"] }],
      },
      layoutKeys: ["TSQ-042", "TSQ-043"],
    });
    expect(screen.queryByTestId("statistics-subject-heading")).toBeNull();
  });

  it("hands the chosen course to the cards of a subject section, and not the others", () => {
    renderView();
    expect(screen.getByTestId("filters-TSQ-042").textContent).toBe('{"course":"c1"}');
    expect(screen.getByTestId("locked-TSQ-042").textContent).toBe('["course"]');
    expect(screen.getByTestId("filters-TSQ-038").textContent).toBe("{}");
    expect(screen.getByTestId("locked-TSQ-038").textContent).toBe("[]");
  });

  it("asks for a subject, and draws no subject card, until one is chosen", () => {
    renderView({ subjectId: undefined });
    expect(screen.getByTestId("statistics-choose-subject")).toBeTruthy();
    expect(screen.queryByTestId("card-TSQ-042")).toBeNull();
    expect(screen.getByTestId("card-TSQ-038")).toBeTruthy();
  });

  it("saves a card's filters without the subject, which belongs to the tab", () => {
    const props = renderView();
    fireEvent.click(screen.getByText("filter-TSQ-042"));
    expect(props.onLayoutChange).toHaveBeenCalledWith([
      "TSQ-038",
      "TSQ-042?simulation=9",
      "TSQ-043",
    ]);
  });

  it("pins a card with the subject it was drawn for", () => {
    const props = renderView();
    fireEvent.click(screen.getByText("pin-TSQ-042"));
    expect(props.onTogglePin).toHaveBeenCalledWith("TSQ-042", "TSQ-042?course=c1");
    expect(screen.getByTestId("pinned-TSQ-042").textContent).toBe("false");
  });

  it("says a card is pinned", () => {
    renderView({ pinnedIds: new Set(["TSQ-038"]) });
    expect(screen.getByTestId("pinned-TSQ-038").textContent).toBe("true");
  });

  it("draws no heading over a subject section while there is no subject to draw it for", () => {
    renderView({ subjectId: undefined });
    expect(screen.getByTestId("statistics-section-allCourses")).toBeTruthy();
    expect(screen.queryByTestId("statistics-section-useOverTime")).toBeNull();
  });

  it("ignores charts the view does not list", () => {
    renderView({ layoutKeys: ["TSQ-038", "TSQ-999"] });
    expect(screen.queryByTestId("card-TSQ-999")).toBeNull();
  });

  it("shows the empty message when nothing is on the tab", () => {
    renderView({ layoutKeys: [] });
    expect(screen.getByTestId("statistics-empty")).toBeTruthy();
  });
});

describe("a link that names a chart", () => {
  it("brings that chart's card into view", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderView({ focusChart: "TSQ-043" });
    expect(scroll).toHaveBeenCalled();
  });

  it("shows that chart even when the person has not put it on the tab", () => {
    renderView({ layoutKeys: ["TSQ-038"], focusChart: "TSQ-043" });
    expect(screen.getByTestId("card-TSQ-043")).toBeTruthy();
  });

  it("does nothing without one", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderView();
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("customising a tab", () => {
  it("opens the library on Customise, listing that tab's charts, and closes it on Done", () => {
    renderView();
    expect(screen.queryByTestId("statistics-library-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("statistics-customise"));
    expect(screen.getByTestId("statistics-library-drawer")).toBeTruthy();
    expect(screen.getByTestId("statistics-library-item-TSQ-043")).toBeTruthy();
    fireEvent.click(screen.getByTestId("statistics-done"));
    expect(screen.queryByTestId("statistics-library-drawer")).toBeNull();
  });

  it("adds a chart from the library to the end of the layout", () => {
    const props = renderView({ layoutKeys: ["TSQ-038"] });
    fireEvent.click(screen.getByTestId("statistics-customise"));
    fireEvent.click(screen.getByTestId("statistics-library-add-TSQ-043"));
    expect(props.onLayoutChange).toHaveBeenCalledWith(["TSQ-038", "TSQ-043"]);
  });

  it("removes a card", () => {
    const props = renderView();
    fireEvent.click(screen.getByTestId("statistics-customise"));
    fireEvent.click(screen.getByTestId("statistics-remove-TSQ-042"));
    expect(props.onLayoutChange).toHaveBeenCalledWith(["TSQ-038", "TSQ-043"]);
  });

  it("does not offer a pin while customising", () => {
    renderView();
    fireEvent.click(screen.getByTestId("statistics-customise"));
    expect(screen.getByTestId("canpin-TSQ-038").textContent).toBe("false");
  });

  it("shows subject cards as placeholders while customising with no subject chosen", () => {
    renderView({ subjectId: undefined });
    fireEvent.click(screen.getByTestId("statistics-customise"));
    expect(screen.queryByTestId("card-TSQ-042")).toBeNull();
    expect(
      within(screen.getByTestId("statistics-grid")).getByText("question TSQ-042"),
    ).toBeTruthy();
  });
});
