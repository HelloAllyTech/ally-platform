import React from "react";

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import "@testing-library/jest-dom";

import DateFilterUI from "../DateFilterUI";

// Mock react-calendar so we don't depend on its DOM, modeling the real
// library's actual v6 behaviour: with `selectRange` and `allowPartialRange`,
// a first click fires onChange with a partial [Date, null] range; a second
// click fires it with the completed [Date, Date] range. Without
// `allowPartialRange`, react-calendar doesn't fire onChange at all on a
// first click — this mock throws in that case, since a plain fabricated
// mock previously hid exactly that real-library behaviour from these tests.
vi.mock("react-calendar", () => ({
  Calendar: ({ onChange, allowPartialRange }: any) => {
    if (!allowPartialRange) {
      throw new Error(
        "DateFilterUI must pass allowPartialRange — without it, react-calendar " +
          "never fires onChange on a first click of a range selection.",
      );
    }
    return (
      <>
        <button onClick={() => onChange([new Date("2024-01-02"), null])}>
          calendar-first-click-partial
        </button>
        <button onClick={() => onChange([new Date("2024-01-02"), new Date("2024-01-03")])}>
          calendar-range
        </button>
      </>
    );
  },
}));

describe("DateFilterUI", () => {
  it("applies a quick preset immediately, without needing Save", () => {
    const onApply = vi.fn();
    render(<DateFilterUI selectedValues={[]} onApply={onApply} />);
    fireEvent.click(screen.getByText("Today"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [start, end] = onApply.mock.calls[0][0];
    expect(new Date(start) < new Date(end)).toBe(true);
  });

  it("shows the calendar immediately — there is no separate Custom mode to open it", () => {
    const onApply = vi.fn();
    render(<DateFilterUI selectedValues={[]} onApply={onApply} />);
    expect(screen.getByText("calendar-range")).toBeInTheDocument();
  });

  it("picking a custom range only applies on Save", () => {
    const onApply = vi.fn();
    render(<DateFilterUI selectedValues={[]} onApply={onApply} />);

    fireEvent.click(screen.getByText("calendar-range"));
    // Picking the range updates the preview (Save becomes clickable below)
    // but must not apply the filter on its own — only Save does that.
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save"));
    expect(onApply).toHaveBeenCalledWith([
      new Date("2024-01-02").toISOString(),
      new Date("2024-01-03").toISOString(),
    ]);
  });

  it("shows a visible preview after picking just a start date, but keeps Save disabled until an end date is picked", () => {
    // Without `allowPartialRange`, react-calendar v6 never fires onChange at
    // all on the first click of a range selection — since this calendar is
    // controlled (value={range}), that left the first click with no visible
    // feedback whatsoever (clicking a date looked like nothing happened).
    // With it, this partial [Date, null] onChange call now updates the
    // preview, without prematurely applying or enabling Save.
    const onApply = vi.fn();
    render(<DateFilterUI selectedValues={[]} onApply={onApply} />);

    fireEvent.click(screen.getByText("calendar-first-click-partial"));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("Save")).toBeDisabled();
    expect(screen.getByText("From:").parentElement).toHaveTextContent(
      new Date("2024-01-02").toLocaleDateString(),
    );
    expect(screen.getByText("To:").parentElement).toHaveTextContent("—");
  });

  it("seeds the preview and enables Save from an already-applied range", () => {
    const onApply = vi.fn();
    render(
      <DateFilterUI
        selectedValues={["2024-01-02T00:00:00.000Z", "2024-01-03T00:00:00.000Z"]}
        onApply={onApply}
      />,
    );
    expect(screen.getByText("Save")).toBeEnabled();
    expect(screen.getByText("From:").parentElement).toHaveTextContent(
      new Date("2024-01-02").toLocaleDateString(),
    );
    expect(screen.getByText("To:").parentElement).toHaveTextContent(
      new Date("2024-01-03").toLocaleDateString(),
    );
  });
});
