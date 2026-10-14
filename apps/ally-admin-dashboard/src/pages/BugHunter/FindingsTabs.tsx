import { FC, KeyboardEvent, useRef } from "react";

import { en } from "@constants";

import { BucketCounts, LIFECYCLE_BUCKETS, LifecycleBucket } from "./lifecycleBucket";

/**
 * Read inside a function, never at module scope: `@constants` is a barrel, and
 * building a `Record` off it at import time broke nine admin test suites that
 * mock the barrel wholesale (the ally-web CLAUDE.md gotcha).
 */
export const bucketLabels = (): Record<LifecycleBucket, string> => ({
  needs_you: en.bugHunter.tabNeedsYou,
  failed: en.bugHunter.tabFailed,
  in_progress: en.bugHunter.tabInProgress,
  backlog: en.bugHunter.tabBacklog,
  done: en.bugHunter.tabDone,
});

/**
 * The count pill's colour, when the tab has something in it.
 *
 * Only the two tabs whose next move belongs to a human get one, and only while
 * they are non-empty — the same orange and red the status badges use, so a
 * colour means one thing everywhere on the page. "Backlog 52" stays as quiet
 * as "Backlog 0": a big number is not an urgent one.
 */
const OCCUPIED_STYLES: Partial<Record<LifecycleBucket, string>> = {
  needs_you: "bg-orange-100 text-orange-800",
  failed: "bg-destructive-100 text-destructive-700",
};
const NEUTRAL_STYLE = "bg-neutral-100 text-typography-700";

export interface FindingsTabsProps {
  counts: BucketCounts;
  value: LifecycleBucket;
  onChange: (value: LifecycleBucket) => void;
  /** The id of the region the tabs control, for `aria-controls`. */
  panelId: string;
  /** Dims the row and blocks clicks while the first page is in flight. */
  disabled?: boolean;
}

/**
 * Five tabs over the bugs table: Needs you, Failed, In progress, Backlog, Done.
 *
 * ## What this replaces (2026-10-13)
 *
 * A row of eight filter chips — "Everything" and seven lifecycle buckets —
 * defaulting to Everything. On prod that opened on 500 rows of which 44 were
 * open, and eight equally-sized chips gave no hint which to press. Tabs say
 * the list is *divided*, not filtered; there is no "Everything", and the page
 * opens on Needs you whenever anything is in it (see `defaultBucket`).
 *
 * Real tab semantics (`tablist`/`tab`/`aria-selected`, arrow keys move between
 * them) because these now are a tabset over one panel, which the chips
 * deliberately were not.
 *
 * Counts follow the search box and the facets (see `countTabs`), so a search
 * that matches nothing here but something under Done says so on the Done tab.
 */
export const FindingsTabs: FC<FindingsTabsProps> = ({
  counts,
  value,
  onChange,
  panelId,
  disabled = false,
}) => {
  const labels = bucketLabels();
  const tabRefs = useRef<Partial<Record<LifecycleBucket, HTMLButtonElement | null>>>({});

  // Left/Right walk the strip and select as they go, Home/End jump to the
  // ends — the WAI-ARIA tabs pattern with automatic activation, which suits a
  // tab whose panel is already in memory and costs nothing to show.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = LIFECYCLE_BUCKETS.indexOf(value);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % LIFECYCLE_BUCKETS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + LIFECYCLE_BUCKETS.length) % LIFECYCLE_BUCKETS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = LIFECYCLE_BUCKETS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const bucket = LIFECYCLE_BUCKETS[next];
    onChange(bucket);
    tabRefs.current[bucket]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={en.bugHunter.tabsLabel}
      className={`flex overflow-x-auto border-b border-border-light ${
        disabled ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {LIFECYCLE_BUCKETS.map(bucket => {
        const isSelected = bucket === value;
        const count = counts[bucket];
        const pill = count > 0 ? (OCCUPIED_STYLES[bucket] ?? NEUTRAL_STYLE) : NEUTRAL_STYLE;
        return (
          <button
            key={bucket}
            ref={element => {
              tabRefs.current[bucket] = element;
            }}
            type="button"
            role="tab"
            id={`bug-findings-tab-${bucket}`}
            aria-selected={isSelected}
            aria-controls={panelId}
            // Roving tabindex: one stop for the strip, arrows within it.
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(bucket)}
            onKeyDown={onKeyDown}
            className={`relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400 ${
              isSelected
                ? "border-primary-500 font-medium text-typography-900"
                : "border-transparent text-typography-800 hover:text-typography-900"
            }`}
          >
            {labels[bucket]}
            <span
              className={`inline-flex min-w-5 justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${pill}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
};
