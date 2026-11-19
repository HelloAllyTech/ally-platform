import { useCallback } from "react";

import { toast } from "sonner";

import { en } from "@constants";

import {
  useDismissBuilderReviewFindingMutation,
  usePatchBuilderPrdMutation,
} from "../../../api/builder";

/**
 * The old Builder session page's PRD handlers, for the idea page (audit 2026-11-19, rec 1): save
 * one section, and dismiss a review finding with the reason it is wrong. The panels pass them only
 * when the server says `can.workPlan` (an Owner, or the builder assigned to it, while planning);
 * the session refetches from the mutation's tags, so nothing is held locally.
 */
export const usePlanPrdHandlers = (sessionId: string | null | undefined) => {
  const [patchPrd] = usePatchBuilderPrdMutation();
  const [dismiss] = useDismissBuilderReviewFindingMutation();

  const onSaveSection = useCallback(
    async (path: string, value: string) => {
      if (!sessionId) return;
      try {
        await patchPrd({
          id: sessionId,
          ops: [{ op: "replace", path, value }],
          changeSummary: `Edited ${path.replace("/", "")}`,
        }).unwrap();
      } catch {
        toast.error(en.builder.prd.saveFailed);
        throw new Error("save failed");
      }
    },
    [patchPrd, sessionId],
  );

  // Failures surface in the findings list, which keeps the typed reason.
  const onDismissFinding = useCallback(
    async (findingId: string, reason: string) => {
      if (!sessionId) return;
      await dismiss({ id: sessionId, findingId, reason }).unwrap();
    },
    [dismiss, sessionId],
  );

  return { onSaveSection, onDismissFinding };
};
