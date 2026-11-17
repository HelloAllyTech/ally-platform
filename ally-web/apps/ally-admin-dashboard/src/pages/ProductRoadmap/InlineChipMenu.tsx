import React, { useEffect, useRef, useState } from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";

export interface ChipOption {
  value: string;
  label: string;
}

interface InlineChipMenuProps {
  /** What the chip says right now. */
  label: string;
  /** Tooltip, and the accessible name of the trigger. */
  tip: string;
  className: string;
  options: ChipOption[];
  /** The option that is current, shown ticked. */
  selectedValue?: string;
  onSelect: (value: string) => void;
}

/**
 * A chip that edits what it shows: click, pick, done — no drawer.
 *
 * Every click and pointer-down is stopped at the chip, because it lives inside a row whose own
 * click opens the opportunity; a chip that also opened the panel would be two actions for one
 * click. Light-dismiss on an outside click or Escape, like the sort control beside it.
 */
export const InlineChipMenu: React.FC<InlineChipMenuProps> = ({
  label,
  tip,
  className,
  options,
  selectedValue,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen]);

  return (
    <span
      ref={rootRef}
      className="relative inline-block"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <Tooltip label={tip} align="bottom">
        <button
          type="button"
          aria-label={`${tip} Now: ${label}.`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(open => !open)}
          className={`cursor-pointer ${className}`}
        >
          {label}
        </button>
      </Tooltip>
      {isOpen && (
        <div
          role="menu"
          className="border-border-light absolute left-0 top-full z-30 mt-1 flex max-h-60 min-w-[10rem] flex-col overflow-y-auto border bg-white py-1 shadow-md"
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === selectedValue}
              onClick={() => {
                setIsOpen(false);
                if (option.value !== selectedValue) onSelect(option.value);
              }}
              className={`cursor-pointer px-3 py-1.5 text-left text-sm ${
                option.value === selectedValue
                  ? "bg-primary-50 text-primary-500 font-medium"
                  : "text-typography-700 hover:bg-background-secondary"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
};
