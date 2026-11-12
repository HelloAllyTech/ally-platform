"use client";
import React from "react";

import { Calendar as ReactCalendar } from "react-calendar";
import "react-calendar/dist/Calendar.css";
import "./DateFilterUI.css";

// Quick date presets for the date filter
const quickPresets = [
  {
    label: "Today",
    getRange: (): [Date, Date] => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return [yesterday, today];
    },
  },
  {
    label: "This week",
    getRange: (): [Date, Date] => {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return [start, end];
    },
  },
  {
    label: "This month",
    getRange: (): [Date, Date] => {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return [start, end];
    },
  },
];

type CalendarValue = Date | [Date | null, Date | null] | null;

/**
 * Props for the DateFilterUI component.
 */
export interface DateFilterUIProps {
  selectedValues: string[];
  /** Commits the filter with an [isoStart, isoEnd] pair — called by a preset
   * click (immediately) or by Save (after picking/adjusting a custom range). */
  onApply: (value: string[]) => void;
}

/**
 * DateFilterUI displays a date range picker and quick presets for date
 * filtering. The calendar is always visible (not gated behind a separate
 * "Custom" mode) — picking a preset also populates it, so the result can be
 * fine-tuned by clicking a different day, and Save becomes available again
 * once the range no longer matches that preset.
 *
 * @param {DateFilterUIProps} props - The props for the date filter UI.
 */
const DateFilterUI: React.FC<DateFilterUIProps> = ({ selectedValues, onApply }) => {
  const [range, setRange] = React.useState<CalendarValue>(
    selectedValues[0] && selectedValues[1]
      ? [new Date(selectedValues[0]), new Date(selectedValues[1])]
      : null,
  );
  const [selectedPreset, setSelectedPreset] = React.useState<string | null>(null);

  const handlePreset = (preset: (typeof quickPresets)[0]) => {
    const [start, end] = preset.getRange();
    setRange([start, end]);
    setSelectedPreset(preset.label);
    onApply([start.toISOString(), end.toISOString()]);
  };

  const handleCalendarChange = (value: CalendarValue) => {
    // react-calendar v6 defaults `allowPartialRange` to false, which means
    // onChange never fires at all on the first click of a range selection —
    // only once both dates are picked. Since this calendar is controlled
    // (value={range}) and range only ever updates inside onChange, that left
    // the first click with no visible feedback whatsoever. `allowPartialRange`
    // below fixes that; this handler just previews whatever it reports
    // (partial [Date, null] or complete [Date, Date]) — Save is what commits
    // a custom range, same as it always has.
    setSelectedPreset(null);
    if (value === null) {
      setRange(null);
    } else if (Array.isArray(value)) {
      setRange(value);
    }
  };

  const handleSave = () => {
    if (Array.isArray(range) && range[0] && range[1]) {
      onApply([range[0].toISOString(), range[1].toISOString()]);
    }
  };

  const canSave =
    Array.isArray(range) && range.length === 2 && Boolean(range[0]) && Boolean(range[1]);

  return (
    <div className="p-[14px] text-[#000]">
      <div className="text-[14px] font-[500] mb-[10px]">Quick presets</div>
      <div className="flex flex-wrap gap-2 mb-[12px]">
        {quickPresets.map(preset => (
          <button
            key={preset.label}
            className={`border rounded px-3 py-1 hover:bg-gray-100 ${
              selectedPreset === preset.label ? "bg-gray-100 border-primary-600" : ""
            }`}
            onClick={() => handlePreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex gap-4 mb-[10px] text-[14px] text-[#6e6656]">
        <div>
          <span className="font-[500]">From:</span>{" "}
          {Array.isArray(range) && range[0] instanceof Date ? range[0].toLocaleDateString() : "—"}
        </div>
        <div>
          <span className="font-[500]">To:</span>{" "}
          {Array.isArray(range) && range[1] instanceof Date ? range[1].toLocaleDateString() : "—"}
        </div>
      </div>
      <div className="react-calendar-wrapper">
        <ReactCalendar
          selectRange
          allowPartialRange
          value={range}
          maxDate={new Date()}
          onChange={handleCalendarChange}
          className="w-full border-0"
        />
      </div>
      <div className="flex justify-end mt-2">
        <button
          className="bg-primary-600 disabled:bg-primary-300 text-white px-4 py-1 rounded hover:bg-primary-700"
          onClick={handleSave}
          disabled={!canSave}
        >
          Save
        </button>
      </div>
    </div>
  );
};

export default DateFilterUI;
