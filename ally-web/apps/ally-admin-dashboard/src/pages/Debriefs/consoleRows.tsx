import React from "react";

import { Keyboard, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { DismissibleTag, OverflowMenu, OverflowMenuItem, Tooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

/**
 * Rows of controls on the Debriefs pages never wrap by accident (Gopi, 2026-11-13). A header,
 * toolbar, filter bar or tab row keeps its priority items on one line and puts the rest behind
 * "More"; a title truncates with its full text in a tooltip; keyboard hints live in a tooltip.
 * Below Carbon's lg breakpoint (1056px) a header may split, on purpose, into a title row and an
 * action row. Card content (meta lines, chips, text) still wraps naturally.
 *
 * The breakpoint is Carbon's 1056px, written `min-[1056px]:` / `max-[1055px]:`: Tailwind's own
 * `lg:` here is 1024px. A Carbon OverflowMenuItem needs `!hidden`, since Carbon's
 * `display: flex` on the option otherwise wins.
 */

type Heading = "h1" | "h2" | "h3" | "span" | "div";

/** A one-line title: an ellipsis when it runs out of room, the full text on hover. */
export const TruncatedTitle: React.FC<{
  as?: Heading;
  text: string;
  className?: string;
  testId?: string;
}> = ({ as: Tag = "span", text, className, testId }) => (
  <Tag title={text} data-testid={testId} className={`min-w-0 truncate ${className ?? ""}`}>
    {text}
  </Tag>
);

export type MoreAction = {
  id: string;
  label: string;
  /** A route to open, or a handler to run. */
  to?: string;
  onClick?: () => void;
  /** Shown in More only below lg, where the row has less room (the item is visible at lg). */
  belowLgOnly?: boolean;
};

/** The "More ⋯" overflow at the end of a row: the actions after the first two or three. */
export const MoreActions: React.FC<{
  items: MoreAction[];
  testId?: string;
  label?: string;
}> = ({ items, testId, label = en.debriefs.rows.moreActions }) => {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <OverflowMenu
      size="md"
      flipped
      align="bottom-end"
      iconDescription={label}
      aria-label={label}
      className="shrink-0"
      data-testid={testId}
    >
      {items.map(item => (
        <OverflowMenuItem
          key={item.id}
          itemText={item.label}
          wrapperClassName={item.belowLgOnly ? "min-[1056px]:!hidden" : undefined}
          onClick={() => (item.to ? navigate(item.to) : item.onClick?.())}
        />
      ))}
    </OverflowMenu>
  );
};

/** "More filters": opens the less-used filters, and says how many of them are set. */
export const MoreFiltersButton: React.FC<{
  open: boolean;
  onToggle: () => void;
  /** How many of the filters behind this button are set. */
  active: number;
  testId?: string;
  controls?: string;
}> = ({ open, onToggle, active, testId, controls }) => {
  const r = en.debriefs.rows;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={active ? r.moreFiltersCount(active) : r.moreFilters}
      onClick={onToggle}
      data-testid={testId}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold text-primary-500 hover:bg-neutral-100"
    >
      <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
      {r.moreFilters}
      {active > 0 && (
        <span
          data-testid={testId ? `${testId}-count` : undefined}
          className="rounded-full bg-primary-500 px-[7px] py-px text-[11px] font-semibold text-white"
        >
          {active}
        </span>
      )}
    </button>
  );
};

export type FilterChip = { id: string; label: string; onRemove: () => void };

/** The set filters as removable chips, with Clear all. Nothing when no filter is set. */
export const FilterChips: React.FC<{
  chips: FilterChip[];
  onClearAll: () => void;
  testId?: string;
}> = ({ chips, onClearAll, testId }) => {
  const r = en.debriefs.rows;
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={r.activeFilters}
      className="flex flex-wrap items-center gap-2"
      data-testid={testId}
    >
      {chips.map(c => (
        <DismissibleTag
          key={c.id}
          type="gray"
          size="md"
          text={c.label}
          title={r.remove(c.label)}
          dismissTooltipLabel={r.remove(c.label)}
          onClose={c.onRemove}
          data-testid={testId ? `${testId}-${c.id}` : undefined}
        />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="h-7 px-2 text-[13px] text-primary-500 hover:underline"
        data-testid={testId ? `${testId}-clear` : undefined}
      >
        {r.clearAll}
      </button>
    </div>
  );
};

/** Keyboard hints as an icon with a tooltip, never as inline text in a row. */
export const KeyboardHint: React.FC<{ keys: string; testId?: string }> = ({ keys, testId }) => (
  <Tooltip label={keys} align="bottom-end">
    <button
      type="button"
      aria-label={en.debriefs.rows.keyboard}
      data-keys={keys}
      data-testid={testId}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-600 hover:bg-neutral-100"
    >
      <Keyboard aria-hidden="true" className="h-[18px] w-[18px]" />
    </button>
  </Tooltip>
);
