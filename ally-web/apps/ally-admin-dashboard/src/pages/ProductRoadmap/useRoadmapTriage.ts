import { useCallback, useRef } from "react";

import { toast } from "sonner";

import {
  useCreateRoadmapCommentMutation,
  useDeleteRoadmapCommentMutation,
  useUpdateRoadmapOpportunityMutation,
} from "@api";
import { en } from "@constants/en";
import { RoadmapOpportunity, RoadmapOpportunityStage } from "@types";

import {
  REJECT_REASONS,
  RejectReasonId,
  TriagePatch,
  UNDO_WINDOW_MS,
  acceptTarget,
  inversePatch,
} from "./utils/triage";

const errorMessage = (error: unknown): string =>
  (error as { data?: { message?: string } })?.data?.message ?? en.roadmapTriage.saveFailed;

/**
 * One-key decisions on a roadmap row: accept, reject, assign to me, change a chip. Each sends a
 * PARTIAL patch — only the field being decided — and raises an 8-second Undo toast.
 *
 * Partial is the point, not a nicety. The drawer used to resubmit every field, so deciding on one
 * could revert whatever another admin had changed on another; here a stage change carries only
 * `stage`. See also diffDraft, which gives the drawer the same property.
 *
 * `z` undoes the most recent change even after its toast has gone, so a slip noticed late is
 * still one key away. Only the latest is kept — a stack would make `z` mean different things
 * depending on how long ago you were last paying attention.
 */
export const useRoadmapTriage = (currentUserId?: number) => {
  const [updateOpportunity] = useUpdateRoadmapOpportunityMutation();
  const [createComment] = useCreateRoadmapCommentMutation();
  const [deleteComment] = useDeleteRoadmapCommentMutation();
  const lastUndo = useRef<(() => Promise<void>) | null>(null);

  const apply = useCallback(
    async (
      opportunity: RoadmapOpportunity,
      patch: TriagePatch,
      message: string,
      /** Extra work after the patch lands, returning how to take it back. */
      after?: () => Promise<(() => Promise<void>) | void>,
    ): Promise<boolean> => {
      const inverse = inversePatch(opportunity, patch);
      try {
        await updateOpportunity({ id: opportunity.id, body: patch }).unwrap();
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
      let extraUndo: (() => Promise<void>) | undefined;
      try {
        const result = await after?.();
        extraUndo = typeof result === "function" ? result : undefined;
      } catch {
        // The decision itself landed; only the optional extra (a reason comment) did not.
        extraUndo = undefined;
      }
      const undo = async () => {
        if (lastUndo.current === undo) lastUndo.current = null;
        try {
          await updateOpportunity({ id: opportunity.id, body: inverse }).unwrap();
          await extraUndo?.();
          toast.success(en.roadmapTriage.undone);
        } catch {
          toast.error(en.roadmapTriage.undoFailed);
        }
      };
      lastUndo.current = undo;
      toast(message, {
        duration: UNDO_WINDOW_MS,
        action: { label: en.roadmapTriage.undo, onClick: () => void undo() },
      });
      return true;
    },
    [updateOpportunity],
  );

  /** Idea → Prioritised. No gate: an unsized or unowned idea can be accepted; the row nudges. */
  const accept = useCallback(
    async (opportunity: RoadmapOpportunity) => {
      const target = acceptTarget(opportunity.stage);
      if (!target) return false;
      return apply(opportunity, { stage: target }, en.roadmapTriage.accepted(opportunity.code));
    },
    [apply],
  );

  /** Archive, with an optional reason saved as a comment. Restorable — it is a hidden state. */
  const reject = useCallback(
    async (opportunity: RoadmapOpportunity, reason?: RejectReasonId) =>
      apply(
        opportunity,
        { stage: RoadmapOpportunityStage.ARCHIVED },
        en.roadmapTriage.rejected(opportunity.code),
        reason
          ? async () => {
              const label =
                en.roadmapTriage.rejectReasons[
                  REJECT_REASONS.find(r => r.id === reason)?.key ?? "duplicate"
                ];
              const created = await createComment({
                opportunityId: opportunity.id,
                body: en.roadmapTriage.rejectComment(label),
              }).unwrap();
              return async () => {
                await deleteComment({ id: created.id, opportunityId: opportunity.id }).unwrap();
              };
            }
          : undefined,
      ),
    [apply, createComment, deleteComment],
  );

  /** Archived → Idea again. */
  const restore = useCallback(
    async (opportunity: RoadmapOpportunity) =>
      apply(
        opportunity,
        { stage: RoadmapOpportunityStage.NEW },
        en.roadmapTriage.restored(opportunity.code),
      ),
    [apply],
  );

  const assignToMe = useCallback(
    async (opportunity: RoadmapOpportunity) => {
      if (!currentUserId) return false;
      return apply(
        opportunity,
        { ownerUserId: currentUserId },
        en.roadmapTriage.assigned(opportunity.code),
      );
    },
    [apply, currentUserId],
  );

  /** A chip edit: one field, named in the toast. */
  const setField = useCallback(
    async (opportunity: RoadmapOpportunity, patch: TriagePatch, fieldLabel: string) =>
      apply(opportunity, patch, en.roadmapTriage.fieldChanged(opportunity.code, fieldLabel)),
    [apply],
  );

  const undoLast = useCallback(async () => {
    const undo = lastUndo.current;
    if (!undo) {
      toast(en.roadmapTriage.nothingToUndo);
      return;
    }
    await undo();
  }, []);

  return { accept, reject, restore, assignToMe, setField, undoLast };
};
