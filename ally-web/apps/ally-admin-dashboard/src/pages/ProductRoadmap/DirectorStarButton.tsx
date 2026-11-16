import React from "react";

import { StarOutline, StarSolid } from "@icons";
import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { useSetRoadmapDirectorStarMutation } from "@api";
import { RoadmapOpportunity } from "@types";

/**
 * The Prod Director's priority star.
 *
 * Renders NOTHING unless the server sent a boolean `directorStarred` — which it does only to the
 * configured Prod Director. Everyone else gets null, so the icon does not exist for them; this
 * component never has to know who the director is.
 *
 * A star adds the "star" factor to the composite rank (weight set under Roadmap settings), which
 * lifts the opportunity up the queue. The mutation invalidates the list, so the new order loads.
 */
export const DirectorStarButton: React.FC<{ opportunity: RoadmapOpportunity }> = ({
  opportunity,
}) => {
  const [setStar, { isLoading }] = useSetRoadmapDirectorStarMutation();

  if (typeof opportunity.directorStarred !== "boolean") return null;
  const starred = opportunity.directorStarred;

  const toggle = async () => {
    try {
      await setStar({ id: opportunity.id, starred: !starred }).unwrap();
    } catch {
      toast.error("Could not update the star. Try again.");
    }
  };

  const label = starred ? "Remove critical-priority star" : "Mark as critical priority";
  const Icon = starred ? StarSolid : StarOutline;

  return (
    <Tooltip label={label} align="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={starred}
        disabled={isLoading}
        data-testid="director-star"
        onClick={event => {
          event.stopPropagation();
          void toggle();
        }}
        onPointerDown={event => event.stopPropagation()}
        className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
          starred ? "text-yellow-500" : "text-typography-secondary hover:text-yellow-500"
        }`}
      >
        <Icon className="size-5" />
      </button>
    </Tooltip>
  );
};
