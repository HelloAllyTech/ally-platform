import React, { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ROUTES, en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { DeclineDialog } from "./DeclineDialog";
import { LeadPicker } from "./LeadPicker";
import { useReviewActions } from "./useReviewActions";
import {
  useMarkRoadmapReleasedMutation,
  useSetRoadmapPlanClosedMutation,
  useStartRoadmapPlanningMutation,
} from "../../../api/roadmapV2Flow";
import { haptic } from "../../../motion";
import { errorMessage } from "../drafts/draftUtils";
import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { primaryActionFor } from "../utils/primaryAction";

/**
 * The idea page's primary action for the Owner's steps and the builder's last one (lifecycle
 * 2026-11-18): Start planning (accepts an idea still waiting), Close plan, Pick a builder once the
 * plan is closed (with Reopen plan beside it), and Mark released for the builder or an Owner.
 * Decline sits beside the Owner's steps: an Owner can decline at any point before Released.
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
  if (action === "startPlanning" || action === "closePlan" || action === "pickLead") {
    return (
      <OwnerStep item={item} fullWidth={fullWidth}>
        {action === "startPlanning" && <StartPlanningButton item={item} fullWidth={fullWidth} />}
        {action === "closePlan" && <PlanClosedButton item={item} closed fullWidth={fullWidth} />}
        {action === "pickLead" && <PickBuilderButton item={item} fullWidth={fullWidth} />}
      </OwnerStep>
    );
  }
  if (action === "markReleased") return <MarkReleasedButton item={item} fullWidth={fullWidth} />;
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
  if (
    action === "pickLead" ||
    action === "startPlanning" ||
    action === "closePlan" ||
    action === "markReleased"
  ) {
    return true;
  }
  return item.shownStage === "declined" && (!!item.can?.review || isDeclinedAuthor(item));
};

/**
 * Decline, for an Owner, at any point before Released (lifecycle 2026-11-18): beside the Owner's
 * own steps, and beside the builder's once the idea is Building.
 */
export const DeclineButton: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const breakpoint = useRoadmapBreakpoint();
  const sheet = breakpoint === "phone" || breakpoint === "tablet";
  const actions = useReviewActions();
  const [open, setOpen] = useState(false);
  if (!item.can?.decline) return null;
  return (
    <>
      <Button
        kind="secondary"
        size={fullWidth ? "lg" : "md"}
        className={fullWidth ? "flex-1 max-w-none" : ""}
        onClick={() => setOpen(true)}
      >
        {en.roadmapV2.review.decline}
      </Button>
      <DeclineDialog
        open={open}
        targets={[{ code: item.code, title: item.title, goalName: item.goal?.name }]}
        onClose={() => setOpen(false)}
        onDecline={reasons => actions.decline(item.code, reasons[item.code])}
        sheet={sheet}
      />
    </>
  );
};

/** An Owner's step, with Decline beside it while the idea can still be declined. */
const OwnerStep: React.FC<{
  item: RoadmapItemDetail;
  fullWidth?: boolean;
  children: React.ReactNode;
}> = ({ item, fullWidth, children }) => (
  <div className={`flex items-center gap-2 ${fullWidth ? "w-full" : ""}`}>
    <DeclineButton item={item} fullWidth={fullWidth} />
    {children}
  </div>
);

/** Pick a builder: only once the plan is closed. Reopen plan sits beside it until one is picked. */
const PickBuilderButton: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const breakpoint = useRoadmapBreakpoint();
  const sheet = breakpoint === "phone" || breakpoint === "tablet";
  const actions = useReviewActions();
  const [open, setOpen] = useState(false);
  const size = fullWidth ? "lg" : "md";
  return (
    <>
      {item.can?.reopenPlan && <PlanClosedButton item={item} closed={false} />}
      <Button
        kind="primary"
        size={size}
        className={fullWidth ? "flex-1 max-w-none" : ""}
        onClick={() => setOpen(true)}
      >
        {en.roadmapV2.review.pickLead}
      </Button>
      <LeadPicker
        open={open}
        code={item.code}
        onClose={() => setOpen(false)}
        onPick={lead => actions.pickLead(item.code, lead)}
        sheet={sheet}
      />
    </>
  );
};

/** Close plan (or, with `closed` false, Reopen plan): an Owner's call while nobody builds it. */
export const PlanClosedButton: React.FC<{
  item: RoadmapItemDetail;
  closed: boolean;
  fullWidth?: boolean;
}> = ({ item, closed, fullWidth }) => {
  const copy = en.roadmapV2.session;
  const [setClosed, { isLoading }] = useSetRoadmapPlanClosedMutation();
  return (
    <span className={`inline-flex items-center gap-1 ${fullWidth ? "flex-1" : ""}`}>
      <Button
        kind={closed ? "primary" : "tertiary"}
        size={fullWidth ? "lg" : "md"}
        className={fullWidth ? "w-full max-w-none" : ""}
        disabled={isLoading}
        onClick={async () => {
          try {
            await setClosed({ code: item.code, closed }).unwrap();
            haptic(10);
            toast.success(closed ? copy.planClosedToast : copy.planReopened);
          } catch (error) {
            toast.error(errorMessage(error) ?? copy.planFailed);
          }
        }}
      >
        {closed ? copy.closePlan : copy.reopenPlan}
      </Button>
      {closed && !fullWidth && (
        <Tooltip label={copy.closePlanHelp} align="bottom">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.closePlanHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      )}
    </span>
  );
};

/**
 * Mark released: the builder's (or an Owner's) click, and the only way an idea reaches Released.
 * One-way, so the first click asks and the second confirms.
 */
export const MarkReleasedButton: React.FC<{ item: RoadmapItemDetail; fullWidth?: boolean }> = ({
  item,
  fullWidth,
}) => {
  const copy = en.roadmapV2.session;
  const [mark, { isLoading }] = useMarkRoadmapReleasedMutation();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = window.setTimeout(() => setConfirming(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return (
    <span className={`inline-flex items-center gap-1 ${fullWidth ? "w-full" : ""}`}>
      <Button
        kind={confirming ? "danger" : "primary"}
        size={fullWidth ? "lg" : "md"}
        className={fullWidth ? "w-full max-w-none" : ""}
        disabled={isLoading}
        onClick={async () => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setConfirming(false);
          try {
            await mark(item.code).unwrap();
            haptic([10, 40, 10]);
            toast.success(copy.released);
          } catch (error) {
            toast.error(errorMessage(error) ?? copy.markReleasedFailed);
          }
        }}
      >
        {confirming ? copy.markReleasedConfirm(item.code) : copy.markReleased}
      </Button>
      {!fullWidth && (
        <Tooltip label={copy.markReleasedHelp} align="bottom">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.markReleasedHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      )}
    </span>
  );
};

/** Start planning: an Owner expands the idea into a plan, in its one session. */
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
