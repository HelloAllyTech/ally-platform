import React from "react";

import { CarbonDropdown } from "@ally-ui-mono/ui-shared";

export interface RoadmapDropdownOption {
  value: string;
  label: string;
}

interface RoadmapDropdownProps {
  id: string;
  /** The visible field label (or the accessible name when `hideLabel`). */
  labelText: React.ReactNode;
  hideLabel?: boolean;
  options: RoadmapDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
}

/**
 * The Roadmap's one dropdown.
 *
 * Carbon's `Select` renders a real <select>, so it opens the OS menu — grey Chrome list on one
 * machine, a native sheet on another — in the system sans, not the product's serif. Carbon's
 * `Dropdown` is its own listbox, which inherits the app's IBM Plex Serif. This wraps it with a
 * plain string-valued API so call sites keep the shape they had with `Select` instead of
 * handling Carbon's object-driven `selectedItem` and null selections each time.
 */
export const RoadmapDropdown: React.FC<RoadmapDropdownProps> = ({
  id,
  labelText,
  hideLabel,
  options,
  value,
  onChange,
  size,
  disabled,
  className,
}) => {
  const selected = options.find(option => option.value === value) ?? null;
  return (
    <CarbonDropdown
      id={id}
      titleText={labelText}
      hideLabel={hideLabel}
      label={labelText}
      aria-label={typeof labelText === "string" ? labelText : undefined}
      items={options}
      itemToString={(item: RoadmapDropdownOption | null) => item?.label ?? ""}
      selectedItem={selected}
      size={size}
      disabled={disabled}
      className={className}
      onChange={({ selectedItem }: { selectedItem: RoadmapDropdownOption | null }) => {
        if (selectedItem) onChange(selectedItem.value);
      }}
    />
  );
};
