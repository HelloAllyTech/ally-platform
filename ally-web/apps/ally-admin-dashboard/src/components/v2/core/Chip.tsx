import React from "react";

/** A pill toggle for multi-select (DESIGN.md §4): selected is an ink fill. */
export const Chip: React.FC<{
  selected?: boolean;
  onToggle?: () => void;
  outline?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ selected, onToggle, outline, children, disabled }) => (
  <button
    type="button"
    aria-pressed={selected === undefined ? undefined : selected}
    disabled={disabled}
    onClick={onToggle}
    className={`ally-chip ally-press ${outline ? "ally-chip--outline" : ""}`}
  >
    {children}
  </button>
);
