import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import type { PmCard } from "@types";

import { copy } from "./copy";
import { ROUTES } from "../../constants/common";

export interface NeedsYouPanelProps {
  card: PmCard;
  disabled?: boolean;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Offered only when the roadmap's duplicate check stopped the card. */
  onFileAnyway?: (id: string) => void;
}

/**
 * Plain-language reason plus what the backend offers: Retry, or — when the roadmap's duplicate
 * check stopped the card — the matches it found and File anyway; Dismiss either way.
 */
export const NeedsYouPanel: React.FC<NeedsYouPanelProps> = ({
  card,
  disabled,
  onRetry,
  onDismiss,
  onFileAnyway,
}) => {
  const actions = card.needsYou?.actions ?? [];
  const duplicates = card.needsYou?.duplicates ?? [];
  const canFileAnyway = actions.includes("file_anyway") && Boolean(onFileAnyway);
  const canRetry = actions.length === 0 || actions.includes("retry");
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
      {duplicates.length > 0 && (
        <ul aria-label={copy.duplicatesLabel} className="flex flex-col gap-1 text-sm">
          {duplicates.map(d => (
            <li key={d.id}>
              <a
                href={`${ROUTES.PRODUCT_ROADMAP}?opportunity=${d.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary-700 underline"
              >
                {d.code ?? copy.tracking.opportunityFallback}
              </a>
              {d.reason ? <span className="text-typography-700"> · {d.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {canFileAnyway && (
          <Button size="md" disabled={disabled} onClick={() => onFileAnyway?.(card.id)}>
            {copy.fileAnyway}
          </Button>
        )}
        {canRetry && !canFileAnyway && (
          <Button size="md" disabled={disabled} onClick={() => onRetry(card.id)}>
            {copy.retry}
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
