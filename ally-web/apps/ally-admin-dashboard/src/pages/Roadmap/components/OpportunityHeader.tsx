import React, { useEffect, useState } from "react";

import { ArrowDown, ArrowUp } from "@icons";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { IdeaTitle } from "./IdeaControls";
import { RoadmapIconButton } from "./RoadmapIconButton";
import { Tracker } from "./Tracker";
import { simpleStageOfShown } from "../utils/copy";

/**
 * The banner's colour says where the idea is at a glance, in the same hues as the stage's Carbon
 * Tag (`STAGE_TAG`): purple Backlog, blue Being built, green Shipped, red Declined. A 4px top edge
 * in the strong step, a tint behind. Written out in full so Tailwind keeps them; the tints and edges
 * re-theme in dark mode.
 */
export const BANNER_TONE: Record<string, string> = {
  backlog: "border-t-4 border-t-purple-600 border-b-purple-200 bg-purple-50",
  being_built: "border-t-4 border-t-primary-500 border-b-primary-200 bg-primary-50",
  shipped: "border-t-4 border-t-success-500 border-b-success-200 bg-success-50",
  declined: "border-t-4 border-t-red-600 border-b-red-200 bg-red-50",
  draft: "border-t-4 border-t-neutral-400 border-b-neutral-200 bg-neutral-50",
};

/** The stage's Carbon Tag colour, matching its banner. */
export const STAGE_TAG: Record<string, "purple" | "blue" | "green" | "red" | "gray"> = {
  backlog: "purple",
  being_built: "blue",
  shipped: "green",
  declined: "red",
  draft: "gray",
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

/** The stage as a Carbon Tag, next to the code, so it reads even when everything else scrolls. */
export const StageChip: React.FC<{
  stage: RoadmapItemDetail["stage"] | RoadmapItemDetail["shownStage"];
}> = ({ stage }) => (
  <Tag
    type={STAGE_TAG[simpleStageOfShown(stage)] ?? "gray"}
    size="sm"
    className="!m-0 mt-0.5 shrink-0"
  >
    {en.roadmapV2.stages[stage]}
  </Tag>
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
    <RoadmapIconButton
      label={expanded ? copy.titleHide : copy.titleShow}
      onClick={onClick}
      expanded={expanded}
    >
      <Icon size={16} aria-hidden />
    </RoadmapIconButton>
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
