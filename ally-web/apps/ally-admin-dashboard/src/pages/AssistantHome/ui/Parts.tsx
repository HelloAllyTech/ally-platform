import React from "react";

import { STRUCTURE } from "../copy/structure";

/** The two parts of Build or Knowledge: a tab each, arrow keys move between them. */
export function Parts<T extends string>({
  parts,
  value,
  onChange,
  testId,
}: {
  parts: readonly T[];
  value: T;
  onChange: (part: T) => void;
  testId?: string;
}) {
  return (
    <div
      className="ally-home__parts"
      role="tablist"
      aria-label={STRUCTURE.partsLabel}
      data-testid={testId}
    >
      {parts.map((part, index) => (
        <button
          key={part}
          type="button"
          role="tab"
          id={`part-tab-${part}`}
          data-testid={`part-${part}`}
          aria-selected={part === value}
          aria-controls={`part-panel-${part}`}
          tabIndex={part === value ? 0 : -1}
          className="ally-home__part"
          onClick={() => onChange(part)}
          onKeyDown={event => {
            const next =
              event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : null;
            if (next === null) return;
            onChange(parts[(next + parts.length) % parts.length]);
          }}
        >
          {STRUCTURE.parts[part as keyof typeof STRUCTURE.parts] ?? part}
        </button>
      ))}
    </div>
  );
}
