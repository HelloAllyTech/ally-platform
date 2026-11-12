import React from "react";

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import "@testing-library/jest-dom";

import DateFilterUI from "../DateFilterUI";

// Mock react-calendar so we don't depend on its DOM. Two buttons: one fires
// the library's real first-click behaviour for a range selection (an
// "anchor" — both ends the same date, before a second date is ever picked),
// the other a genuinely completed two-different-dates range.
vi.mock("react-calendar", () => ({
  Calendar: ({ onChange }: any) => (
    <>
      <button onClick={() => onChange([new Date("2024-01-02"), new Date("2024-01-02")])}>
        calendar-first-click-anchor
      </button>
      <button onClick={() => onChange([new Date("2024-01-02"), new Date("2024-01-03")])}>
        calendar-range
      </button>
    </>
  ),
}));

describe("DateFilterUI", () => {
  it("applies quick preset and calls onChange", () => {
    const onChange = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Today"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("commits the filter via onDateSelect when a quick preset is clicked, without needing Save", () => {
    // onChange alone only reaches the (unrelated) multiselect staging array
    // via FilterPopover's wiring — onDateSelect is the real commit path, and
    // a preset click used to never call it, so clicking "Today" looked like
    // it applied the filter but silently did nothing.
    const onChange = vi.fn();
    const onDateSelect = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} onDateSelect={onDateSelect} />);
    fireEvent.click(screen.getByText("Today"));
    expect(onDateSelect).toHaveBeenCalledTimes(1);
    expect(onDateSelect).toHaveBeenCalledWith(onChange.mock.calls[0][0]);
  });

  it("shows calendar for Custom preset, and picking a range only applies on Save", () => {
    const onChange = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Custom"));
    fireEvent.click(screen.getByText("calendar-range"));
    // Picking the range updates the preview (Save becomes clickable below)
    // but must not apply the filter on its own — only Save does that.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save"));
    expect(onChange).toHaveBeenCalledWith([
      new Date("2024-01-02").toISOString(),
      new Date("2024-01-03").toISOString(),
    ]);
  });

  it("does not apply the filter on the calendar's first-click anchor (From=To, before a second date is picked)", () => {
    // react-calendar's own range-select behaviour: the first click already
    // fires onChange with the same date for both ends, with no separate
    // signal distinguishing "still choosing" from a real same-day range.
    // Treating that as a committed selection applied a From=To filter the
    // instant a counsellor clicked a start date, before they could ever pick
    // a different end date.
    const onChange = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Custom"));
    fireEvent.click(screen.getByText("calendar-first-click-anchor"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens the calendar when clicking directly into the From or To field, not only the Custom button", () => {
    // The From/To boxes had no click handler at all — a counsellor clicking
    // into what visually looks like a date field got nothing, since only the
    // separate "Custom" preset button opened the calendar.
    const onChange = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} />);

    expect(screen.queryByText("calendar-range")).not.toBeInTheDocument();
    fireEvent.click(screen.getByPlaceholderText("Starting"));
    expect(screen.getByText("calendar-range")).toBeInTheDocument();
  });

  it("enables Save only when a range is selected and calls onDateSelect", () => {
    const onChange = vi.fn();
    const onDateSelect = vi.fn();
    render(<DateFilterUI selectedValues={[]} onChange={onChange} onDateSelect={onDateSelect} />);

    // initially disabled
    expect(screen.getByText("Save")).toBeDisabled();

    // pick a preset with a full range
    fireEvent.click(screen.getByText("This week"));
    expect(screen.getByText("Save")).toBeEnabled();
    fireEvent.click(screen.getByText("Save"));
    expect(onDateSelect).toHaveBeenCalled();
  });
});
