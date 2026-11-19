import React from "react";

import type { RoadmapItemDetail } from "@types";

import { IdeaTitle } from "./IdeaControls";
import { Tracker } from "./Tracker";

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

/** The stage's Carbon Tag colour, matching its banner — used by the queue rows. */
export const STAGE_TAG: Record<string, "purple" | "blue" | "green" | "red" | "gray"> = {
  backlog: "purple",
  being_built: "blue",
  shipped: "green",
  declined: "red",
  draft: "gray",
};

/**
 * The card's grounding strip: always on screen, whatever stage the idea is at and whichever tab,
 * panel or scroll position you are in. It carries what says *what this card is*: its code and its
 * title. The stage is the banner's colour and the To do → Building → Released tracker in the rows
 * below (also inside this sticky strip); a stage chip beside the code repeated that tracker one
 * line up, so it was dropped on 2026-11-19.
 *
 * The title is always shown in full, wrapped over as many lines as it needs, on every layout —
 * web and phone alike (and, for someone who may edit it, it is edited in place). It used to sit on
 * one truncated line behind a show/hide chevron; that was dropped on 2026-11-19 because a cut-off
 * title hid what the card was about, which is the one thing this strip is for.
 *
 * Pinned with `position: sticky`, so it also holds when a parent scrolls it (the phone page);
 * where the header already sits above the scrolling region (reading pane, desktop page) it is
 * simply where it was.
 */
export const OpportunityHeader: React.FC<{
  item: RoadmapItemDetail;
  as: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Right-hand controls: votes, star, copy link, open full page, close. */
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
      <div className="min-w-0 flex-1">
        <IdeaTitle
          item={item}
          as={as}
          headingRef={headingRef}
          className="m-0 break-words text-lg font-semibold text-typography-primary"
        />
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
    {controls}
    {children}
  </header>
);

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
