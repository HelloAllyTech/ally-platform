import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import type { PmCard } from "@types";

import { copy } from "./copy";

export interface NeedsYouPanelProps {
  card: PmCard;
  disabled?: boolean;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** Plain-language reason plus Retry, Open PR and Dismiss for a failed or stuck build. */
export const NeedsYouPanel: React.FC<NeedsYouPanelProps> = ({
  card,
  disabled,
  onRetry,
  onDismiss,
}) => {
  const actions = card.needsYou?.actions ?? [];
  const prUrl = card.delivery?.prs?.find(pr => pr.url)?.url;
  const canRetry =
    actions.length === 0 ? card.status !== "merged_not_released" : actions.includes("retry");
  const canDismiss = actions.length === 0 || actions.includes("dismiss");
  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label={`${copy.needsYouTitle}: ${card.title}`}
    >
      <p className="text-sm text-typography-900">
        <span className="font-semibold">{copy.needsYouTag}: </span>
        {card.needsYou?.reason ?? card.status.replace(/_/g, " ")}
      </p>
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button size="md" disabled={disabled} onClick={() => onRetry(card.id)}>
            {copy.retry}
          </Button>
        )}
        {prUrl && (
          <Button
            kind="tertiary"
            size="md"
            as="a"
            href={prUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {copy.openPr}
          </Button>
        )}
        {canDismiss && (
          <Button kind="ghost" size="md" disabled={disabled} onClick={() => onDismiss(card.id)}>
            {copy.dismiss}
          </Button>
        )}
      </div>
    </div>
  );
};
