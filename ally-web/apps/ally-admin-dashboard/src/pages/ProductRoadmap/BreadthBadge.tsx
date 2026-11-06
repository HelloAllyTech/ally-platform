import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { RoadmapBreadth } from "@types";

import { formatMultiplier } from "./utils/points";

/**
 * Plain-language date for the "drops on" line: "14 Nov". No year or time — the drop is at most
 * the window length (14 days) away, so the day is the whole story.
 */
const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * The one-sentence "why your breadth will fall" line, or null when nothing is due. Names the
 * colleague whose vote is ageing out so the drop reads as a consequence, not an arbitrary
 * penalty. Plain text, no countdown and no warning colour.
 */
export const dropWarning = (breadth: RoadmapBreadth): string | null => {
  if (!breadth.nextDropAt || breadth.nextDropMultiplier === null) return null;
  const who = breadth.nextDropAuthorName
    ? ` when your vote on ${breadth.nextDropAuthorName}'s opportunity ages out`
    : " as an older vote ages out";
  return `Drops to ${formatMultiplier(breadth.nextDropMultiplier)} on ${formatDay(breadth.nextDropAt)}${who}.`;
};

export const breadthExplainer = (breadth: RoadmapBreadth): string =>
  `Back opportunities from more colleagues in the last ${breadth.windowDays} days to raise your breadth, up to ${formatMultiplier(breadth.maxMultiplier)}.`;

interface BreadthBadgeProps {
  /** Undefined while loading: renders a skeleton, never a premature "×1.0". */
  breadth: RoadmapBreadth | undefined;
  availableVotes: number | undefined;
  onClick: () => void;
}

/**
 * The `×1.2` badge beside the vote-budget icon.
 *
 * Always visible while the feature is on, including at ×1.0 in the same neutral grey — the
 * mechanic has to stay findable, and a badge that vanishes at 1.0 hides the only thing that
 * would tell a new voter it exists. Never red, never blinking: the budget icon owns the one
 * nudge in this header.
 *
 * Clicking it toggles the same in-place readout the icon does, so there is one disclosure, not
 * two.
 */
export const BreadthBadge: React.FC<BreadthBadgeProps> = ({ breadth, availableVotes, onClick }) => {
  if (!breadth) {
    return (
      <span
        aria-hidden
        className="bg-background-secondary text-typography-secondary inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-xs tabular-nums"
      >
        ×–
      </span>
    );
  }

  const value = formatMultiplier(breadth.multiplier);
  return (
    <Tooltip
      label={`${availableVotes ?? 0} votes available · Breadth ${value}. Click for detail.`}
      align="bottom"
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Breadth multiplier ${(Math.round(breadth.multiplier * 100) / 100).toString()}, ${breadth.qualifying} of ${breadth.target} colleagues`}
        className="border-border-light text-typography-secondary hover:text-primary-500 inline-flex h-6 min-w-[2.5rem] cursor-pointer items-center justify-center rounded border px-1.5 text-xs tabular-nums"
      >
        {value}
      </button>
    </Tooltip>
  );
};

interface BreadthReadoutProps {
  breadth: RoadmapBreadth | undefined;
  isError: boolean;
  onRetry: () => void;
  onSeeEveryone: () => void;
}

/**
 * The expanded half: "Breadth ×1.2 · 5 of 8 colleagues", a thin progress bar, the explainer,
 * the drop warning and the way into the everyone panel. Lives inside the budget's existing
 * expand-in-place region, so it pushes the neighbouring buttons along rather than covering them.
 */
export const BreadthReadout: React.FC<BreadthReadoutProps> = ({
  breadth,
  isError,
  onRetry,
  onSeeEveryone,
}) => {
  if (isError) {
    return (
      <span className="text-typography-secondary text-sm">
        Couldn&apos;t load breadth.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="text-primary-500 cursor-pointer underline"
        >
          Retry
        </button>
      </span>
    );
  }
  if (!breadth) return null;

  const warning = dropWarning(breadth);
  return (
    <span className="text-typography-secondary flex flex-col gap-0.5 text-sm">
      <span>
        <span className="text-typography-primary tabular-nums">
          Breadth {formatMultiplier(breadth.multiplier)}
        </span>
        <span className="whitespace-nowrap tabular-nums">
          {" "}
          · {breadth.qualifying} of {breadth.target} colleagues
        </span>
        <span
          role="progressbar"
          aria-label="Colleagues backed in the last 14 days"
          aria-valuemin={0}
          aria-valuemax={breadth.target}
          aria-valuenow={Math.min(breadth.qualifying, breadth.target)}
          className="bg-background-secondary ml-2 inline-block h-1 w-16 overflow-hidden align-middle"
        >
          <span
            className="bg-primary-500 block h-full"
            style={{
              width: `${Math.min(100, Math.round((breadth.qualifying / Math.max(1, breadth.target)) * 100))}%`,
            }}
          />
        </span>
      </span>
      <span className="text-xs">
        {breadthExplainer(breadth)}
        {warning ? ` ${warning}` : ""}{" "}
        <button
          type="button"
          onClick={onSeeEveryone}
          className="text-primary-500 cursor-pointer underline"
        >
          See everyone&apos;s breadth
        </button>
      </span>
    </span>
  );
};
