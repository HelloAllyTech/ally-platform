import { useCallback } from "react";

import { toast } from "sonner";

import {
  patchEveryCachedRow,
  productRoadmapAPI,
  roadmapV2API,
  useSetRoadmapAllocationMutation,
} from "@api";
import { en } from "@constants";
import { store } from "@store";

type Dispatch = (action: unknown) => unknown;

/**
 * VoteButton's `onSetVotes` for Roadmap v2: the existing vote endpoint, unchanged (D17), with the
 * optimistic update reaching every place the vote shows (§4.12).
 *
 * Mirrors ProductRoadmap's useSetVotes rather than wrapping it, because that hook swallows the
 * failure: wrapped, the v2 copies could not be undone when a vote is refused. So this one patches
 * all of them first — the idea in every cached Queue list and its detail (votes, votedByMe), the
 * old opportunity record VoteButton reads its own count from (myVotes), and the vote budget — then
 * reconciles from the server's answer, or undoes every patch and shows the server's reason.
 */
export const useRoadmapVote = (code: string) => {
  const [setAllocation] = useSetRoadmapAllocationMutation();

  return useCallback(
    async (opportunityId: string, next: number, previous: number) => {
      const delta = next - previous;
      const dispatch = store.dispatch as unknown as Dispatch;

      const undoRows = patchEveryCachedRow(dispatch, store.getState, code, row => {
        row.votes = Math.max(0, row.votes + delta);
        row.votedByMe = next > 0;
      });
      const patches = [
        store.dispatch(
          roadmapV2API.util.updateQueryData("getRoadmapItem", code, draft => {
            draft.votes = Math.max(0, draft.votes + delta);
            draft.votedByMe = next > 0;
          }),
        ),
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapOpportunity", opportunityId, draft => {
            draft.myVotes = next;
          }),
        ),
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapVoteBudget", undefined, draft => {
            draft.available = Math.max(0, draft.available - delta);
          }),
        ),
      ];

      try {
        const result = await setAllocation({ opportunityId, votes: next }).unwrap();
        // Reconcile quietly from what the server recorded.
        patchEveryCachedRow(dispatch, store.getState, code, row => {
          row.votedByMe = result.votes > 0;
        });
        store.dispatch(
          roadmapV2API.util.updateQueryData("getRoadmapItem", code, draft => {
            draft.votedByMe = result.votes > 0;
          }),
        );
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapVoteBudget", undefined, draft =>
            Object.assign(draft, result.budget),
          ),
        );
      } catch (error) {
        undoRows();
        patches.forEach(patch => patch.undo());
        const message =
          (error as { data?: { message?: string } })?.data?.message ?? en.roadmapV2.row.voteFailed;
        toast.error(message);
      }
    },
    [code, setAllocation],
  );
};
