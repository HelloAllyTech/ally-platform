import React from "react";

import { toast } from "sonner";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import {
  useAskRoadmapOwnerToPlanMutation,
  useReleaseRoadmapPlanningMutation,
  useTakeRoadmapPlanningMutation,
} from "../../../api/roadmapV2Flow";
import { haptic } from "../../../motion";
import { errorMessage } from "../drafts/draftUtils";

/**
 * Who runs the plan interview. It has one holder at a time, so what shows here depends on who
 * holds it: the author's nudge after submitting (expand it, or ask an Owner), Continue for a
 * started interview nobody holds, Hand over for whoever holds it, and a line naming the holder
 * for everyone else. Everything is gated by `can`; a control you can't use is absent.
 */
export const PlanInterviewBar: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const copy = en.roadmapV2.session.planInterview;
  const can = item.can ?? {};
  const [take, takeState] = useTakeRoadmapPlanningMutation();
  const [release, releaseState] = useReleaseRoadmapPlanningMutation();
  const [ask, askState] = useAskRoadmapOwnerToPlanMutation();
  const size = fullWidth ? "lg" : "md";
  const width = fullWidth ? "w-full max-w-none" : "";

  const run = async (fn: () => Promise<unknown>, ok: string, failed: string) => {
    try {
      await fn();
      haptic(10);
      toast.success(ok);
    } catch (error) {
      toast.error(errorMessage(error) ?? failed);
    }
  };

  const help = (label: string) => (
    <Tooltip label={label} align="bottom">
      <button type="button" className="inline-flex cursor-pointer items-center" aria-label={label}>
        <TooltipIcon />
      </button>
    </Tooltip>
  );

  // Held by someone else, and nothing here is yours to do with it.
  const heldByOther =
    !!item.planHolder && !can.workPlan && !can.releasePlanning && !can.takePlanning;
  const authorHolds = item.planHolder?.as === "author";

  if (can.askOwnerToPlan) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border-default p-3">
        <p className="text-sm font-medium text-typography-primary">{copy.offerTitle}</p>
        <p className="text-sm text-typography-secondary">{copy.offerBody}</p>
        <span className="inline-flex items-center gap-1">
          <Button
            kind="secondary"
            size={size}
            className={width}
            disabled={askState.isLoading}
            onClick={() =>
              run(() => ask(item.code).unwrap(), copy.askOwnerDone, copy.askOwnerFailed)
            }
          >
            {copy.askOwner}
          </Button>
          {!fullWidth && help(copy.askOwnerHelp)}
        </span>
      </div>
    );
  }

  if (can.takePlanning) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          kind="primary"
          size={size}
          className={width}
          disabled={takeState.isLoading}
          onClick={() => run(() => take(item.code).unwrap(), copy.taken, copy.takeFailed)}
        >
          {copy.take}
        </Button>
        {!fullWidth && help(copy.takeHelp)}
      </span>
    );
  }

  if (can.releasePlanning) {
    // An author hands it to the Owners; an Owner just frees it.
    const byAuthor = !can.closePlan && !can.review && !can.decline;
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          kind="secondary"
          size={size}
          className={width}
          disabled={releaseState.isLoading}
          onClick={() => run(() => release(item.code).unwrap(), copy.released, copy.releaseFailed)}
        >
          {byAuthor ? copy.releaseAuthor : copy.release}
        </Button>
        {!fullWidth && help(byAuthor ? copy.releaseAuthorHelp : copy.releaseHelp)}
      </span>
    );
  }

  if (heldByOther && item.planHolder && (authorHolds || item.planHolder.as === "owner")) {
    return <p className="text-sm text-typography-secondary">{copy.heldBy(item.planHolder.name)}</p>;
  }
  return null;
};
