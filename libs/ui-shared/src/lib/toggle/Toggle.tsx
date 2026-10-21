"use client";

import { FC, useRef, useState } from "react";

interface ToggleProps {
  label?: string;
  /** Keep `label` as the group's accessible name only, e.g. inside a table cell. */
  hideLabel?: boolean;
  items: {
    label: string;
    value: string;
  }[];
  onChange: (value: string) => void;
  initialValue?: string;
}

const Toggle: FC<ToggleProps> = ({ label, hideLabel, items, initialValue, onChange }) => {
  const [selectedValue, setSelectedValueIndex] = useState(
    initialValue ? items.findIndex(item => item.value === initialValue) : 0,
  );
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleChange = (index: number) => {
    setSelectedValueIndex(index);
    onChange(items[index].value);
  };

  /**
   * Roving keyboard navigation for the radio group: arrow keys move the
   * selection (and focus) between options, Home/End jump to the ends.
   */
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % items.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    handleChange(nextIndex);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex flex-col gap-2 w-fit">
      {label && !hideLabel && <div>{label}</div>}
      <div
        role="radiogroup"
        aria-label={label}
        // Carbon content switcher: square segments in one bordered strip, the selected one
        // inverse. (This replaces a sliding pill whose half-width indicator only lined up
        // when there were exactly two options.)
        className="inline-flex items-stretch border border-typography-900 bg-white"
      >
        {items.map((item, index) => {
          const isSelected = selectedValue === index;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              ref={el => (buttonRefs.current[index] = el)}
              onClick={() => handleChange(index)}
              onKeyDown={event => handleKeyDown(event, index)}
              className={`h-8 px-4 cursor-pointer transition-colors duration-200 font-primary font-normal text-sm border-0 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                isSelected
                  ? "bg-typography-900 text-white"
                  : "bg-transparent text-typography-700 hover:bg-gray-100 hover:text-typography-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Toggle;
