import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button, SkeletonText, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import {
  RoadmapCloseBlocker,
  useCloseRoadmapPlanMutation,
  useGetRoadmapCloseReadinessQuery,
  useRunRoadmapPlanChecksMutation,
} from "../../../api/roadmapPlanning";
import { haptic } from "../../../motion";
import { RoadmapDialog } from "../components/RoadmapDialog";
import { errorMessage, errorStatus } from "../drafts/draftUtils";

/** The server's minimum (ally-be CLOSE_REASON_MIN); it refuses anything shorter. */
export const CLOSE_REASON_MIN = 10;
const CLOSE_REASON_MAX = 500;

/** True when a blocker says a specialist review has not run on this PRD. */
const needsReviewRun = (blockers: RoadmapCloseBlocker[]): boolean =>
  blockers.some(b => /^Run the .* check/.test(b.text));

/**
 * Close plan (audit 2026-11-19, rec 2): lists what the plan still needs, from the server's one
 * definition of ready. With nothing open it is a plain confirm. With anything open, closing needs
 * a typed reason, which the server stores and prints at the top of the build brief; the server
 * refuses a close with open blockers and no reason whatever this dialog does.
 */
export const ClosePlanDialog: React.FC<{
  item: Pick<RoadmapItemDetail, "code" | "sessionId">;
  open: boolean;
  onClose: () => void;
  sheet: boolean;
}> = ({ item, open, onClose, sheet }) => {
  const copy = en.roadmapV2.planGate;
  const { data, isFetching, isError, refetch } = useGetRoadmapCloseReadinessQuery(item.code, {
    skip: !open,
    refetchOnMountOrArgChange: true,
  });
  const [close, { isLoading: closing }] = useCloseRoadmapPlanMutation();
  const [runChecks, { isLoading: running }] = useRunRoadmapPlanChecksMutation();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const blockers = data?.blockers ?? [];
  // A failed check still lets the Owner close, with a reason: the server decides.
  const needsReason = isError || (!!data && !data.ready);
  const trimmed = reason.replace(/\s+/g, " ").trim();
  const reasonOk = !needsReason || trimmed.length >= CLOSE_REASON_MIN;
  const loading = isFetching && !data;

  const submit = async () => {
    try {
      await close({ code: item.code, reason: needsReason ? trimmed : undefined }).unwrap();
      haptic(10);
      toast.success(en.roadmapV2.session.planClosedToast);
      onClose();
    } catch (error) {
      // Something opened up since the list was read: show the current list.
      if (errorStatus(error) === 409) void refetch();
      toast.error(errorMessage(error) ?? en.roadmapV2.session.planFailed);
    }
  };

  return (
    <RoadmapDialog
      open={open}
      onClose={onClose}
      title={copy.dialogTitle}
      primaryText={needsReason ? copy.closeAnyway : copy.confirm}
      onPrimary={() => void submit()}
      primaryDisabled={loading || closing || !reasonOk}
      danger={needsReason}
      secondaryText={copy.cancel}
      sheet={sheet}
      closeLabel={copy.close}
    >
      <div className="flex flex-col gap-3 text-sm text-typography-primary">
        {loading && (
          <div aria-busy="true">
            <p className="m-0 text-typography-secondary">{copy.checking}</p>
            <SkeletonText paragraph lineCount={3} />
          </div>
        )}
        {isError && !data && <p className="m-0 text-typography-secondary">{copy.checkFailed}</p>}
        {data?.ready && <p className="m-0">{copy.ready}</p>}
        {data && !data.ready && (
          <>
            {data.prdEmpty && <p className="m-0 font-semibold">{copy.prdEmpty}</p>}
            <p className="m-0">{copy.notReadyIntro(blockers.length)}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="close-plan-blockers">
              {blockers.map(b => (
                <li key={`${b.kind}:${b.text}`} className="flex gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase text-typography-secondary">
                    {copy.kinds[b.kind] ?? b.kind}
                  </span>
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
            {needsReviewRun(blockers) && item.sessionId && (
              <span className="inline-flex items-center gap-1">
                <Button
                  kind="tertiary"
                  size="sm"
                  disabled={running}
                  onClick={async () => {
                    try {
                      await runChecks({ code: item.code, sessionId: item.sessionId! }).unwrap();
                      toast.success(copy.runChecksStarted);
                      void refetch();
                    } catch (error) {
                      toast.error(errorMessage(error) ?? copy.runChecksFailed);
                    }
                  }}
                >
                  {copy.runChecks}
                </Button>
                <Tooltip label={copy.runChecksHelp} align="top">
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center"
                    aria-label={copy.runChecksHelp}
                  >
                    <TooltipIcon />
                  </button>
                </Tooltip>
              </span>
            )}
          </>
        )}
        {needsReason && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <label htmlFor={`close-plan-reason-${item.code}`} className="text-xs font-semibold">
                {copy.reasonLabel}
              </label>
              <Tooltip label={copy.reasonHelp} align="top">
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center"
                  aria-label={copy.reasonHelp}
                >
                  <TooltipIcon />
                </button>
              </Tooltip>
            </div>
            <TextArea
              id={`close-plan-reason-${item.code}`}
              labelText={copy.reasonLabel}
              hideLabel
              rows={3}
              value={reason}
              placeholder={copy.reasonPlaceholder}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setReason(event.target.value.slice(0, CLOSE_REASON_MAX))
              }
            />
            {trimmed.length > 0 && !reasonOk && (
              <p className="m-0 text-xs text-typography-secondary">
                {copy.reasonTooShort(CLOSE_REASON_MIN)}
              </p>
            )}
          </div>
        )}
      </div>
    </RoadmapDialog>
  );
};
