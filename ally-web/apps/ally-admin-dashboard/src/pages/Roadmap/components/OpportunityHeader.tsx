import React, { useEffect, useState } from "react";

import { ArrowDown, ArrowUp } from "@icons";

import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { IdeaTitle } from "./IdeaControls";
import { Tracker } from "./Tracker";

/**
 * The banner's colour says where the idea is at a glance: amber for the Backlog, blue while it is
 * being built, green once shipped, grey when declined. Written out in full so Tailwind keeps them.
 */
export const BANNER_TONE: Record<string, string> = {
  backlog: "border-t-4 border-t-warning-500 border-b-warning-200 bg-warning-50",
  being_built: "border-t-4 border-t-primary-600 border-b-primary-200 bg-primary-50",
  shipped: "border-t-4 border-t-success-600 border-b-success-200 bg-success-50",
  declined: "border-t-4 border-t-neutral-500 border-b-neutral-300 bg-neutral-100",
  draft: "border-t-4 border-t-neutral-300 border-b-neutral-200 bg-neutral-50",
};

/**
 * The card's grounding strip: always on screen, whatever stage the idea is at and whichever tab,
 * panel or scroll position you are in. It carries the three things that say *what this card is*:
 * its code, its title and its stage.
 *
 * The title never disappears. It sits on one line, cut with an ellipsis, and expands in place to
 * the full text (which is also where it is edited). A long title therefore costs one line of
 * height, not five.
 *
 * Pinned with `position: sticky`, so it also holds when a parent scrolls it (the phone page);
 * where the header already sits above the scrolling region (reading pane, desktop page) it is
 * simply where it was.
 */
export const OpportunityHeader: React.FC<{
  item: RoadmapItemDetail;
  as: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Right-hand controls: votes, star, watch, copy link, open full page, close. */
  actions?: React.ReactNode;
  /** The editable facts: goal, lead, planned month. */
  controls?: React.ReactNode;
  /** Rows under the grounding strip: tracker and status, people, the primary action. */
  children?: React.ReactNode;
}> = ({ item, as, headingRef, actions, controls, children }) => (
  <header
    className={`sticky top-0 z-[3] flex flex-col gap-2 border-b px-4 py-3 ${
      BANNER_TONE[item.stage ?? "draft"] ?? BANNER_TONE.draft
    }`}
  >
    <div className="flex items-start gap-2">
      <span className="shrink-0 pt-1 text-xs tabular-nums text-typography-secondary">
        {item.code}
      </span>
      <StageChip stage={item.stage ?? item.shownStage} />
      <CollapsibleTitle
        item={item}
        as={as}
        headingRef={headingRef}
        className="min-w-0 flex-1 text-lg font-semibold text-typography-primary"
      />
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
    {controls}
    {children}
  </header>
);

/** The stage as a word, next to the code, so it is readable even when everything else scrolls. */
export const StageChip: React.FC<{
  stage: RoadmapItemDetail["stage"] | RoadmapItemDetail["shownStage"];
}> = ({ stage }) => (
  <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-black/10 bg-white/80 px-2 py-0.5 text-xs font-semibold text-typography-primary">
    {en.roadmapV2.stages[stage]}
  </span>
);

/**
 * One truncated line that opens to the full title. Collapsed is the default for every card, so the
 * header's height is the same from idea to build; opening a different card collapses it again.
 */
export const CollapsibleTitle: React.FC<{
  item: RoadmapItemDetail;
  as: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
}> = ({ item, as: Heading, headingRef, className = "" }) => {
  const copy = en.roadmapV2.idea;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [item.code]);

  if (expanded) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-1">
        <IdeaTitle item={item} as={Heading} headingRef={headingRef} className={className} />
        <ToggleButton expanded onClick={() => setExpanded(false)} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      <Heading
        ref={headingRef}
        tabIndex={-1}
        className={`m-0 min-w-0 flex-1 outline-none ${className}`}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={item.title}
          aria-label={`${item.title}. ${copy.titleShow}`}
          className="block w-full cursor-pointer truncate bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-inherit"
        >
          {item.title}
        </button>
      </Heading>
      <ToggleButton expanded={false} onClick={() => setExpanded(true)} />
    </div>
  );
};

const ToggleButton: React.FC<{ expanded: boolean; onClick: () => void }> = ({
  expanded,
  onClick,
}) => {
  const copy = en.roadmapV2.idea;
  const Icon = expanded ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={expanded ? copy.titleHide : copy.titleShow}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-neutral-100"
    >
      <Icon size={16} aria-hidden />
    </button>
  );
};

/** The compact tracker row that sits under the strip on every layout. */
export const HeaderTracker: React.FC<{
  item: RoadmapItemDetail;
  status: string;
}> = ({ item, status }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
    <Tracker stage={item.stage ?? item.shownStage} />
    <p className="m-0 text-sm text-typography-secondary" aria-live="polite">
      {status}
    </p>
  </div>
);
