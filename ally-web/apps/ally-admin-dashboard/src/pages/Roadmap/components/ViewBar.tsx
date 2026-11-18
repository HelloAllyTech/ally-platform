import React from "react";

import { Search } from "@icons";

import { en } from "@constants";

/**
 * The search button that opens quick open (⌘K on desktop, full screen on a phone). The Queue's view
 * tabs, sort and saved-view controls live in QueueTabs, QueueSortSelect and SavedViewControls.
 */
export const SearchButton: React.FC<{ onClick: () => void; compact?: boolean }> = ({
  onClick,
  compact,
}) => {
  const copy = en.roadmapV2.quickOpen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copy.open}
      className={`inline-flex items-center gap-2 rounded border border-border-light text-sm text-typography-secondary hover:bg-neutral-50 ${
        compact ? "h-11 w-11 justify-center" : "min-h-8 px-3"
      }`}
    >
      <Search size={16} aria-hidden />
      {!compact && (
        <>
          <span>{copy.open}</span>
          <kbd className="rounded border border-border-light px-1 text-xs">⌘K</kbd>
        </>
      )}
    </button>
  );
};
