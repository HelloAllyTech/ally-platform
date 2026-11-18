import { useCallback } from "react";

import { toast } from "sonner";

import { productRoadmapAPI, useSetRoadmapAllocationMutation } from "@api";
import { TAG_TYPES } from "@constants";
import { store } from "@store";
import { RoadmapBoardQuery, RoadmapOpportunitiesQuery, RoadmapOpportunity } from "@types";

/**
 * Which cached read to patch: the table's flat list, the month board's lanes, or the single row
 * the opportunity drawer reads.
 *
 * Generalised rather than copied when month boards arrived. The vote path has three non-obvious
 * invariants (below) and a second hook would be a second place for each of them to rot — the ONLY
 * thing that differs between the layouts is how you reach an opportunity inside the cached
 * response, so that is the only thing injected.
 *
 * "detail" carries no args because it needs none: `getRoadmapOpportunity` is keyed by the id
 * itself, so the entry the drawer subscribed to is the one patched, and the args trap below
 * cannot bite it.
 */
export type AllocationTarget =
  | { kind: "list"; args: RoadmapOpportunitiesQuery }
  | { kind: "board"; args: RoadmapBoardQuery }
  | { kind: "detail" };

/**
 * Commit a vote total optimistically.
 *
 * THREE THINGS TO KNOW BEFORE CHANGING THIS:
 *
 * 1. THE ARGS TRAP — the highest silent-failure risk on this page.
 *    `updateQueryData(endpoint, args, …)` matches on a SERIALISED arg object. Called with anything
 *    other than the exact args the component subscribed with, it patches a cache entry that does
 *    not exist and no-ops silently: the votes simply appear not to move, with no error anywhere.
 *    So `target.args` must be the SAME memoised object passed to the corresponding query hook.
 *    There is exactly one subscriber per layout today; if a second ever appears, iterate the
 *    cached entries instead of guessing.
 *
 * 2. `setRoadmapAllocation` carries NO tags on purpose (see api/productRoadmap.ts). The
 *    reconciliation below is the whole update path — invalidating the list would refetch on
 *    every tap and stomp this patch mid-interaction.
 *
 * 3. Reconciliation is not optional. Between the patch and the response another voter may have
 *    moved `priorityScore`, so the server's numbers overwrite the optimistic guess rather than
 *    being assumed correct.
 */
export const useSetVotes = (target: AllocationTarget) => {
  const [setAllocation] = useSetRoadmapAllocationMutation();

  /**
   * Apply `mutate` to one opportunity wherever it lives in the cached read.
   *
   * The board's copy is nested inside a lane, so the table's `draft.items.find` would miss it
   * entirely — and per invariant 1 a miss is SILENT, so this is the difference between votes
   * working and votes mysteriously not moving on one of the two layouts.
   */
  const patchOpportunity = useCallback(
    (opportunityId: string, mutate: (row: RoadmapOpportunity) => void) => {
      if (target.kind === "detail") {
        return store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapOpportunity", opportunityId, mutate),
        );
      }
      if (target.kind === "list") {
        return store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapOpportunities", target.args, draft => {
            const row = draft.items.find(o => o.id === opportunityId);
            if (row) mutate(row);
          }),
        );
      }
      return store.dispatch(
        productRoadmapAPI.util.updateQueryData("getRoadmapBoard", target.args, draft => {
          for (const lane of draft.lanes) {
            const row = lane.items.find(o => o.id === opportunityId);
            if (row) {
              mutate(row);
              return;
            }
          }
        }),
      );
    },
    [target],
  );

  /**
   * Once you've backed a colleague, every OTHER row by the same author stops being "new to you".
   * The vote path deliberately doesn't refetch the list, so the "New colleague" markers on those
   * sibling rows would otherwise stay lit until the next load. Only ever clears the flag — taking
   * a vote back can't tell us whether another standing vote still covers that author, so it
   * leaves the markers alone and lets the next refetch settle it.
   */
  const clearNewColleagueMarkers = useCallback(
    (authorId: number | undefined) => {
      if (authorId === undefined || target.kind === "detail") return;
      const clear = (row: RoadmapOpportunity) => {
        if (row.creator?.id === authorId) row.breadthNew = false;
      };
      if (target.kind === "list") {
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapOpportunities", target.args, draft => {
            draft.items.forEach(clear);
          }),
        );
        return;
      }
      store.dispatch(
        productRoadmapAPI.util.updateQueryData("getRoadmapBoard", target.args, draft => {
          draft.lanes.forEach(lane => lane.items.forEach(clear));
        }),
      );
    },
    [target],
  );

  return useCallback(
    async (opportunityId: string, next: number, previous: number) => {
      const delta = next - previous;
      // The multiplier a vote added now will most likely be worth, read from the cache so the
      // optimistic score is close; the server's number overwrites it on reconcile. Removals are
      // taken off 1:1 — close enough for the instant it is on screen.
      const cachedBreadth = productRoadmapAPI.endpoints.getRoadmapBreadth.select()(
        store.getState(),
      ).data;
      const weight = delta > 0 && cachedBreadth?.enabled ? cachedBreadth.multiplier : 1;

      const patches = [
        patchOpportunity(opportunityId, row => {
          row.priorityScore = Math.max(
            0,
            Math.round((row.priorityScore + delta * weight) * 10) / 10,
          );
          row.myVotes = next;
        }),
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapVoteBudget", undefined, draft => {
            draft.available = Math.max(0, draft.available - delta);
          }),
        ),
      ];

      try {
        const result = await setAllocation({ opportunityId, votes: next }).unwrap();

        let authorId: number | undefined;
        patchOpportunity(opportunityId, row => {
          row.priorityScore = result.priorityScore;
          row.myVotes = result.votes;
          authorId = row.creator?.id;
          if (result.votes > 0) row.breadthNew = false;
        });
        if (result.votes > 0 && delta > 0) clearNewColleagueMarkers(authorId);
        // Qualifying count, target hint and "next drop" all moved: refetch the breadth readout
        // once per settled interaction (the vote button already debounces).
        store.dispatch(productRoadmapAPI.util.invalidateTags([TAG_TYPES.PRODUCT_ROADMAP_BREADTH]));
        store.dispatch(
          productRoadmapAPI.util.updateQueryData("getRoadmapVoteBudget", undefined, draft =>
            Object.assign(draft, result.budget),
          ),
        );
      } catch (error) {
        patches.forEach(patch => patch.undo());
        // The backend answers 422 with the real remaining balance for a cap breach and 409 when
        // the opportunity has left the `new` stage; surface its message rather than a generic one.
        const message =
          (error as { data?: { message?: string } })?.data?.message ??
          "Could not save your vote. Refresh to see your current balance.";
        toast.error(message);
      }
    },
    [patchOpportunity, clearNewColleagueMarkers, setAllocation],
  );
};
