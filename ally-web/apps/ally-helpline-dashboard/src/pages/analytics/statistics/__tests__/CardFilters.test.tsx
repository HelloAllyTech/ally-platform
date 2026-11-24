import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardFilters } from "../CardFilters";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", exists: () => false },
  }),
}));

// The chooser's own list is tested separately; here it picks a fixed option.
vi.mock("../ScopeChooser", () => ({
  ScopeChooser: ({
    kind,
    onPick,
  }: {
    kind: string;
    onPick: (o: { id: string; label: string }) => void;
  }) => (
    <button type="button" onClick={() => onPick({ id: "c1", label: `Chosen ${kind}` })}>
      pick-{kind}
    </button>
  ),
}));

describe("a card's filter row", () => {
  it("draws nothing for a card with no filters", () => {
    const { container } = render(
      <CardFilters filters={[]} values={{}} labels={{}} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows one chip per declared filter, set to All until chosen", () => {
    render(
      <CardFilters
        filters={[
          { key: "course", required: false },
          { key: "simulation", required: false },
        ]}
        values={{}}
        labels={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("statistics-filter-course").textContent).toContain(
      "statisticsLibrary.filters.all.course",
    );
    expect(screen.getByTestId("statistics-filter-simulation")).toBeTruthy();
    expect(screen.queryByTestId("statistics-filter-learner")).toBeNull();
  });

  it("asks for a choice where the filter is required", () => {
    render(
      <CardFilters
        filters={[{ key: "course", required: true }]}
        values={{}}
        labels={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("statistics-filter-course").textContent).toContain(
      "statisticsLibrary.filters.choose.course",
    );
  });

  it("changes the filter, keeping the others, and names the choice at once", () => {
    const onChange = vi.fn();
    const filters = [
      { key: "course", required: false },
      { key: "simulation", required: false },
    ] as const;
    const { rerender } = render(
      <CardFilters
        filters={filters}
        values={{ simulation: "7" }}
        labels={{ simulation: "Sim A" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("statistics-filter-course"));
    fireEvent.click(screen.getByText("pick-course"));
    expect(onChange).toHaveBeenCalledWith({ simulation: "7", course: "c1" }, expect.anything());
    // The page saves the choice and passes it back.
    rerender(
      <CardFilters
        filters={filters}
        values={{ simulation: "7", course: "c1" }}
        labels={{ simulation: "Sim A" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("statistics-filter-course").textContent).toContain("Chosen course");
    expect(screen.getByTestId("statistics-filter-simulation").textContent).toContain("Sim A");
  });

  it("clears an optional filter back to All, but never a required one", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CardFilters
        filters={[{ key: "course", required: false }]}
        values={{ course: "c1" }}
        labels={{ course: "Course A" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("statistics-filter-course"));
    fireEvent.click(screen.getByTestId("statistics-filter-clear"));
    expect(onChange).toHaveBeenCalledWith({});

    rerender(
      <CardFilters
        filters={[{ key: "course", required: true }]}
        values={{ course: "c1" }}
        labels={{ course: "Course A" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("statistics-filter-course"));
    expect(screen.queryByTestId("statistics-filter-clear")).toBeNull();
  });

  it("does not offer a filter the page supplies for the whole tab", () => {
    render(
      <CardFilters
        filters={[
          { key: "course", required: false },
          { key: "simulation", required: false },
        ]}
        values={{ course: "c1" }}
        hidden={["course"]}
        labels={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("statistics-filter-course")).toBeNull();
    expect(screen.getByTestId("statistics-filter-simulation")).toBeTruthy();
  });

  it("draws nothing when every filter is supplied by the page", () => {
    const { container } = render(
      <CardFilters
        filters={[{ key: "course", required: true }]}
        values={{ course: "c1" }}
        hidden={["course"]}
        labels={{}}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
