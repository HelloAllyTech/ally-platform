import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import type { PmCard, PmRecommendationPayload } from "@types";

import { copy } from "./copy";

export interface ActionBarProps {
  card: PmCard & { payload: PmRecommendationPayload };
  disabled?: boolean;
  /** Sticky to the bottom of the viewport on small screens. */
  sticky?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onFeedback: () => void;
}

/**
 * Accept and add to roadmap (primary, with the consequence chip), Reject, Give feedback.
 * Accepting files the card's roadmap entry as a Product Manager Agent opportunity once the
 * 10-second undo window closes; nothing is built. A card written before roadmap filing has no
 * entry to file, so Accept is off and the chip says why.
 */
export const ActionBar: React.FC<ActionBarProps> = ({
  card,
  disabled,
  sticky,
  onAccept,
  onReject,
  onFeedback,
}) => {
  const fileable = Boolean(card.payload.opportunity);

  return (
    <div
      className={`flex flex-col gap-2 border-t border-neutral-500 bg-white pt-3 ${
        sticky ? "sticky bottom-0 z-10 pb-3 lg:static" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" disabled={disabled || !fileable} onClick={onAccept}>
          {copy.accept} <kbd className="ml-2 text-xs opacity-80">A</kbd>
        </Button>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-typography-700">
          {fileable ? copy.filesToRoadmap : copy.notFileable}
        </span>
        <Button kind="tertiary" size="md" disabled={disabled} onClick={onReject}>
          {copy.reject} <kbd className="ml-2 text-xs opacity-80">R</kbd>
        </Button>
        <Button kind="ghost" size="md" disabled={disabled} onClick={onFeedback}>
          {copy.feedback} <kbd className="ml-2 text-xs opacity-80">F</kbd>
        </Button>
      </div>
    </div>
  );
};
