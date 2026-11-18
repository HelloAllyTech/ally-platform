import { useCallback, useMemo } from "react";

import { toast } from "sonner";

import {
  useCreateRoadmapSavedViewMutation,
  useGetRoadmapSavedViewsQuery,
  useGetRoadmapViewOrderQuery,
  usePinRoadmapSavedViewMutation,
  useUpdateRoadmapSavedViewMutation,
} from "@api";
import { en } from "@constants";
import type { RoadmapSavedView } from "@types";

import { applySavedViewOrder } from "../../ProductRoadmap/utils/views";
import {
  QueueState,
  queueSignature,
  savedViewPayload,
  stateFromSavedView,
} from "../utils/queueState";

/** At most this many saved views show as chips; the rest go under More (§4.3). */
export const MAX_VIEW_CHIPS = 5;

/** Only views saved from the new Queue carry `state.queue`; the old board's views stay there. */
export const isQueueView = (view: RoadmapSavedView): boolean =>
  !!view.state && typeof view.state.queue === "object" && view.state.queue !== null;

/**
 * Saved views on the Queue, on the existing `roadmap_saved_views` endpoints and wire format (own
 * views plus Owner-pinned ones, the user's tab order). The payload is the contract's query params
 * in `state.queue`.
 *
 * Not the old board's `useSavedViews`: that one AUTOSAVES an owned view as filters change, and §4.3
 * asks for the opposite — changing filters shows **Save view**, or **Update "Hindi work"** when you
 * started from a saved view, and nothing is written until you press it.
 */
export const useQueueSavedViews = (state: QueueState, currentUserId: number | undefined) => {
  const { data: rawViews } = useGetRoadmapSavedViewsQuery();
  const { data: order } = useGetRoadmapViewOrderQuery();
  const [createView, { isLoading: isCreating }] = useCreateRoadmapSavedViewMutation();
  const [updateView, { isLoading: isUpdating }] = useUpdateRoadmapSavedViewMutation();
  const [pinView] = usePinRoadmapSavedViewMutation();
  const copy = en.roadmapV2.savedViews;

  const views = useMemo(
    () =>
      applySavedViewOrder(Array.isArray(rawViews) ? rawViews : [], order?.viewIds).filter(
        isQueueView,
      ),
    [rawViews, order?.viewIds],
  );

  const active = useMemo(
    () => (state.savedViewId ? (views.find(v => v.id === state.savedViewId) ?? null) : null),
    [views, state.savedViewId],
  );

  const currentSignature = queueSignature(state.filters, state.sort);
  const activeSignature = active
    ? (() => {
        const saved = stateFromSavedView(active.state.queue ?? {}, "owner", active.id);
        return queueSignature(saved.filters, saved.sort);
      })()
    : null;
  const isDirty = !!active && activeSignature !== currentSignature;
  const canUpdate = !!active && !!currentUserId && active.createdBy === currentUserId;

  const save = useCallback(
    async (name: string): Promise<RoadmapSavedView | null> => {
      try {
        const created = await createView({
          name,
          state: { queue: savedViewPayload(state) },
        }).unwrap();
        toast.success(copy.saved(created.name));
        return created;
      } catch {
        toast.error(copy.saveFailed);
        return null;
      }
    },
    [createView, state, copy],
  );

  const update = useCallback(async () => {
    if (!active) return;
    try {
      await updateView({
        id: active.id,
        state: { ...active.state, queue: savedViewPayload(state) },
      }).unwrap();
      toast.success(copy.updated(active.name));
    } catch {
      toast.error(copy.saveFailed);
    }
  }, [active, updateView, state, copy]);

  const togglePin = useCallback(
    async (view: RoadmapSavedView) => {
      try {
        await pinView({ id: view.id, pinned: !view.pinned }).unwrap();
      } catch {
        toast.error(copy.pinFailed);
      }
    },
    [pinView, copy],
  );

  return {
    views,
    chips: views.slice(0, MAX_VIEW_CHIPS),
    overflow: views.slice(MAX_VIEW_CHIPS),
    active,
    isDirty,
    canUpdate,
    isSaving: isCreating || isUpdating,
    save,
    update,
    togglePin,
  };
};
