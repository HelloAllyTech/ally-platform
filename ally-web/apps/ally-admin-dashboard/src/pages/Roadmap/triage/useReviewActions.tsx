import React, { useCallback } from "react";

import { motion } from "framer-motion";
import { toast } from "sonner";

import { en } from "@constants";

import {
  useReviewRoadmapBatchMutation,
  useReviewRoadmapItemMutation,
  useSetRoadmapLeadMutation,
  useUndoRoadmapReviewMutation,
} from "../../../api/roadmapV2Flow";
import { haptic, motionTransition, useReducedMotionPreference } from "../../../motion";
import { errorCode, errorMessage, errorStatus } from "../drafts/draftUtils";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";

import type { RoadmapBatchReviewItem } from "../../../types/roadmapV2Flow";

/** The client offers undo for 8 s (the server honours it for 30 s). */
export const UNDO_WINDOW_MS = 8_000;

/** An undo toast: slides in; a thin bar shrinks across it over the 8 s window (§4.18). */
export const UndoToast: React.FC<{
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}> = ({ message, onUndo, onDismiss }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.review;
  return (
    <div
      className="relative flex w-[356px] max-w-[calc(100vw-2rem)] items-center gap-3 overflow-hidden bg-neutral-800 px-4 py-3 text-sm text-white shadow-lg"
      role="status"
      data-testid="roadmap-undo-toast"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        className="font-semibold text-primary-200 hover:underline"
        onClick={() => {
          onDismiss();
          onUndo();
        }}
      >
        {copy.undo}
      </button>
      {!reduced && (
        <motion.span
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary-300"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: UNDO_WINDOW_MS / 1000, ease: "linear" }}
          aria-hidden
        />
      )}
    </div>
  );
};

let lastUndo: (() => void) | null = null;
/** U undoes the last review (§4.6), for as long as its toast would. */
export const undoLastReview = (): boolean => {
  if (!lastUndo) return false;
  const run = lastUndo;
  lastUndo = null;
  run();
  return true;
};

/**
 * The Owner's review calls, each with the 8-second undo (§4.6) and haptics (10 ms on a lead,
 * 2 × 15 ms on decline; §4.18). One undo token reverses a whole batch. There is no plain Accept:
 * picking a lead is what accepts an unreviewed idea (`assign`), and `pickLead` does the same for
 * one that was accepted before.
 */
export const useReviewActions = () => {
  const [review] = useReviewRoadmapItemMutation();
  const [batch] = useReviewRoadmapBatchMutation();
  const [undo] = useUndoRoadmapReviewMutation();
  const [setLead] = useSetRoadmapLeadMutation();
  const copy = en.roadmapV2.review;
  // P8: picking a lead or Decline (with a reason) ends "triage one" (§4.16) when the row's focus
  // started it. Bulk reviews are not timed per idea.
  const { complete: completeJob } = useRoadmapJobTimer();

  const offerUndo = useCallback(
    (message: string, token: string, onUndone?: () => void) => {
      const run = async () => {
        try {
          await undo(token).unwrap();
          toast.success(copy.undone);
          onUndone?.();
        } catch (error) {
          const c = errorCode(error);
          if (c === "undo_expired" || errorStatus(error) === 410) toast.error(copy.undoExpired);
          else if (c === "undo_conflict") toast.error(copy.undoConflict);
          else toast.error(copy.failed);
        }
      };
      lastUndo = run;
      const timer = window.setTimeout(() => {
        if (lastUndo === run) lastUndo = null;
      }, UNDO_WINDOW_MS);
      toast.custom(
        id => (
          <UndoToast
            message={message}
            onDismiss={() => toast.dismiss(id)}
            onUndo={() => {
              window.clearTimeout(timer);
              if (lastUndo === run) lastUndo = null;
              void run();
            }}
          />
        ),
        { duration: UNDO_WINDOW_MS },
      );
    },
    [undo, copy],
  );

  /** Pick a lead for an idea still awaiting review: accepts it and gives it the lead in one step. */
  const assign = useCallback(
    async (code: string, lead: { id: number; name: string }, onUndone?: () => void) => {
      try {
        const result = await review({
          code,
          decision: "accept",
          leadUserId: lead.id,
        }).unwrap();
        haptic(10);
        completeJob("triage_one", { itemId: code });
        offerUndo(copy.leadAssigned(code, lead.name), result.undoToken, onUndone);
        return true;
      } catch {
        toast.error(copy.failed);
        return false;
      }
    },
    [review, offerUndo, copy, completeJob],
  );

  const decline = useCallback(
    async (code: string, reason: string, onUndone?: () => void) => {
      try {
        const result = await review({ code, decision: "decline", reason }).unwrap();
        haptic([15, 60, 15]);
        completeJob("triage_one", { itemId: code });
        offerUndo(copy.declined(code), result.undoToken, onUndone);
        return true;
      } catch {
        toast.error(copy.failed);
        return false;
      }
    },
    [review, offerUndo, copy, completeJob],
  );

  const reopen = useCallback(
    async (code: string) => {
      try {
        const result = await review({ code, decision: "reopen" }).unwrap();
        offerUndo(copy.reopened(code), result.undoToken);
        return true;
      } catch {
        toast.error(copy.failed);
        return false;
      }
    },
    [review, offerUndo, copy],
  );

  const reviewMany = useCallback(
    async (items: RoadmapBatchReviewItem[], onUndone?: () => void) => {
      if (items.length === 0) return false;
      try {
        const result = await batch(items).unwrap();
        haptic(items[0].decision === "decline" ? [15, 60, 15] : 10);
        offerUndo(
          copy.batchDone(
            items.length,
            copy.batchVerbs[items[0].decision] ?? copy.batchVerbs.accept,
          ),
          result.undoToken,
          onUndone,
        );
        return true;
      } catch (error) {
        const failures = (error as { data?: { failures?: { code: string }[] } })?.data?.failures;
        toast.error(
          Array.isArray(failures) && failures.length
            ? copy.batchFailed(failures.map(f => f.code).join(", "))
            : copy.failed,
        );
        return false;
      }
    },
    [batch, offerUndo, copy],
  );

  const pickLead = useCallback(
    async (code: string, lead: { id: number; name: string }) => {
      try {
        await setLead({ code, action: "assign", leadUserId: lead.id }).unwrap();
        haptic(10);
        toast.success(copy.leadPicked(lead.name));
        return true;
      } catch (error) {
        toast.error(errorMessage(error) ?? copy.failed);
        return false;
      }
    },
    [setLead, copy],
  );

  const handBack = useCallback(
    async (code: string) => {
      try {
        await setLead({ code, action: "handBack" }).unwrap();
        toast.success(copy.handedBack);
        return true;
      } catch (error) {
        toast.error(errorMessage(error) ?? copy.failed);
        return false;
      }
    },
    [setLead, copy],
  );

  return { assign, decline, reopen, reviewMany, pickLead, handBack };
};

/** Motion values for the desktop triage row (§4.18): a lead slides right, decline left. */
export const triageExit = (decision: "assign" | "decline" | null, reduced: boolean) => {
  if (!decision || reduced) return { opacity: 0 };
  return { x: decision === "assign" ? 24 : -24, opacity: 0 };
};

export const triageTransition = (reduced: boolean) =>
  motionTransition("moderate", "productive", reduced);
