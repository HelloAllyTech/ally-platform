import React, { useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ROUTES, en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { DeclineDialog } from "./DeclineDialog";
import { LeadPicker } from "./LeadPicker";
import { useReviewActions } from "./useReviewActions";
import { useStartRoadmapPlanningMutation } from "../../../api/roadmapV2Flow";
import { haptic } from "../../../motion";
import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { primaryActionFor } from "../utils/primaryAction";

/**
 * The idea page's primary action for the steps P3 and P3b own (§4.5): Accept (with Accept + lead
 * and Decline beside it) and Pick a lead for an Owner; Start planning for the lead or an Owner.
 * Also two that only show on a declined idea: Reopen for an Owner (§4.6), and New idea pre-filled
 * with the author's own text, for the author alone (§4.7).
 *
 * Returns null for any other step, so the page's own PrimaryAction handles it.
 */
export const IdeaFlowAction: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const action = primaryActionFor(item);
  if (action === "accept" || action === "pickLead") {
    return <ReviewButtons item={item} mode={action} fullWidth={fullWidth} />;
  }
  if (action === "startPlanning") return <StartPlanningButton item={item} fullWidth={fullWidth} />;
  if (item.shownStage === "declined") {
    if (item.can?.review) return <ReopenButton item={item} fullWidth={fullWidth} />;
    if (isDeclinedAuthor(item)) return <NewIdeaFromDeclined item={item} fullWidth={fullWidth} />;
  }
  return null;
};

/**
 * The author of a declined idea, without asking who's signed in: only the author and Owners ever
 * receive `declineReason` (P2 contract), and an Owner has `can.review`.
 */
const isDeclinedAuthor = (item: RoadmapItemDetail): boolean =>
  item.shownStage === "declined" && !item.can?.review && !!item.declineReason;

/** True when {@link IdeaFlowAction} renders something for this item. */
export const hasIdeaFlowAction = (item: RoadmapItemDetail): boolean => {
  const action = primaryActionFor(item);
  if (action === "accept" || action === "pickLead" || action === "startPlanning") return true;
  return item.shownStage === "declined" && (!!item.can?.review || isDeclinedAuthor(item));
};

const ReviewButtons: React.FC<{
  item: RoadmapItemDetail;
  mode: "accept" | "pickLead";
  fullWidth?: boolean;
}> = ({ item, mode, fullWidth }) => {
  const copy = en.roadmapV2.review;
  const breakpoint = useRoadmapBreakpoint();
  const sheet = breakpoint === "phone" || breakpoint === "tablet";
  const actions = useReviewActions();
  const [leadOpen, setLeadOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const size = fullWidth ? "lg" : "md";
  const wide = fullWidth ? "flex-1 max-w-none" : "";

  return (
    <div className={`flex items-center gap-2 ${fullWidth ? "w-full" : ""}`}>
      {mode === "accept" ? (
        <>
          <Button
            kind="secondary"
            size={size}
            className={wide}
            onClick={() => setDeclineOpen(true)}
          >
            {copy.decline}
          </Button>
          <Button kind="tertiary" size={size} className={wide} onClick={() => setLeadOpen(true)}>
            {copy.acceptWithLead}
          </Button>
          <Button
            kind="primary"
            size={size}
            className={wide}
            onClick={() => void actions.accept(item.code)}
          >
            {copy.accept}
          </Button>
        </>
      ) : (
        <Button kind="primary" size={size} className={wide} onClick={() => setLeadOpen(true)}>
          {copy.pickLead}
        </Button>
      )}
      <LeadPicker
        open={leadOpen}
        code={item.code}
        accepting={mode === "accept"}
        onClose={() => setLeadOpen(false)}
        onPick={lead =>
          mode === "accept" ? actions.accept(item.code, lead) : actions.pickLead(item.code, lead)
        }
        sheet={sheet}
      />
      <DeclineDialog
        open={declineOpen}
        targets={[{ code: item.code, title: item.title, goalName: item.goal?.name }]}
        onClose={() => setDeclineOpen(false)}
        onDecline={reasons => actions.decline(item.code, reasons[item.code])}
        sheet={sheet}
      />
    </div>
  );
};

/** Start planning (P3b): the plan interview begins in the same session. */
export const StartPlanningButton: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const copy = en.roadmapV2.session;
  const [start, { isLoading }] = useStartRoadmapPlanningMutation();
  return (
    <span className={`inline-flex items-center gap-1 ${fullWidth ? "w-full" : ""}`}>
      <Button
        kind="primary"
        size={fullWidth ? "lg" : "md"}
        className={fullWidth ? "w-full max-w-none" : ""}
        disabled={isLoading}
        onClick={async () => {
          try {
            await start(item.code).unwrap();
            haptic(10);
            toast.success(copy.planningStarted);
          } catch {
            toast.error(copy.startPlanningFailed);
          }
        }}
      >
        {copy.startPlanning}
      </Button>
      {!fullWidth && (
        <Tooltip label={copy.startPlanningHelp} align="bottom">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.startPlanningHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      )}
    </span>
  );
};

const ReopenButton: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const actions = useReviewActions();
  return (
    <Button
      kind="tertiary"
      size={fullWidth ? "lg" : "md"}
      className={fullWidth ? "w-full max-w-none" : ""}
      onClick={() => void actions.reopen(item.code)}
    >
      {en.roadmapV2.review.reopen}
    </Button>
  );
};

/** §4.7: the author of a declined idea gets New idea pre-filled with their text (never in the URL). */
const NewIdeaFromDeclined: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const navigate = useNavigate();
  const text = [item.title, item.summary?.problem].filter(Boolean).join("\n");
  return (
    <Button
      kind="primary"
      size={fullWidth ? "lg" : "md"}
      className={fullWidth ? "w-full max-w-none" : ""}
      onClick={() => navigate(ROUTES.ROADMAP_NEW_IDEA, { state: { text } })}
    >
      {en.roadmapV2.newIdea.button}
    </Button>
  );
};
