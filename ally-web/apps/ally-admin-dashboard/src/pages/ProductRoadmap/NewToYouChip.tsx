import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";

interface NewToYouChipProps {
  active: boolean;
  onToggle: () => void;
}

/**
 * Quick filter: only opportunities from colleagues you haven't backed in the breadth window.
 * It is the one-click path to the behaviour breadth rewards. Deliberately a page-level toggle,
 * not part of the saved-view filter set — it is a "show me where to go next" shortcut, and
 * persisting it into a saved view would open that view half-empty a fortnight later.
 */
export const NewToYouChip: React.FC<NewToYouChipProps> = ({ active, onToggle }) => (
  <Tooltip
    label="Opportunities from colleagues you haven't backed in the last 14 days."
    align="bottom"
  >
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`inline-flex h-7 cursor-pointer items-center rounded-full border px-3 text-xs ${
        active
          ? "border-primary-500 bg-primary-500 text-white"
          : "border-border-light text-typography-secondary hover:text-primary-500"
      }`}
    >
      New to you
    </button>
  </Tooltip>
);

/**
 * The quiet per-row marker: a vote here would back a colleague you haven't backed lately.
 * Outline and text only — no fill, no animation, one per row — because a card queue is scanned
 * hundreds of times and a loud marker would be noise by the second screen.
 */
export const NewColleagueTag: React.FC = () => (
  <span className="border-border-light text-typography-secondary inline-flex items-center rounded border px-1.5 text-[11px] leading-4">
    New colleague
  </span>
);
