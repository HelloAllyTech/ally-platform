import { useCallback, useMemo } from "react";

import { toast } from "sonner";

import {
  useCreateRoadmapSavedViewMutation,
  useDeleteRoadmapSavedViewMutation,
  useGetRoadmapSavedViewsQuery,
  useGetRoadmapViewOrderQuery,
  useUpdateRoadmapSavedViewMutation,
} from "@api";
import { en } from "@constants";
import type { RoadmapSavedView } from "@types";

import { applySavedViewOrder } from "../../ProductRoadmap/utils/views";
import {
  QueueState,
  SAVED_VIEW_DEFAULT_SORT,
  queueSignature,
  savedViewPayload,
  stateFromSavedView,
} from "../utils/queueState";

/** Only views saved from the new Queue carry `state.queue`; the old board's views stay there. */
export const isQueueView = (view: RoadmapSavedView): boolean =>
  !!view.state && typeof view.state.queue === "object" && view.state.queue !== null;

/**
 * Saved views on the Queue: the person's own, on the existing `roadmap_saved_views` endpoints and
 * wire format (the payload is the contract's query params in `state.queue`). Only their own show:
 * a saved view is personal, on every device, and the five default views are not in this list.
 *
 * Not the old board's `useSavedViews`: that one AUTOSAVES as filters change, and the Queue asks for
 * the opposite: changing filters or sort shows **Save as a view**, or **Update "Hindi work"** when
 * you started from a saved view, and nothing is written until you press it.
 */
export const useQueueSavedViews = (state: QueueState, currentUserId: number | undefined) => {
  const { data: rawViews } = useGetRoadmapSavedViewsQuery();
  const { data: order } = useGetRoadmapViewOrderQuery();
  const [createView, { isLoading: isCreating }] = useCreateRoadmapSavedViewMutation();
  const [updateView, { isLoading: isUpdating }] = useUpdateRoadmapSavedViewMutation();
  const [deleteView, { isLoading: isDeleting }] = useDeleteRoadmapSavedViewMutation();
  const copy = en.roadmapV2.savedViews;

  const views = useMemo(
    () =>
      applySavedViewOrder(Array.isArray(rawViews) ? rawViews : [], order?.viewIds).filter(
        view => isQueueView(view) && !!currentUserId && view.createdBy === currentUserId,
      ),
    [rawViews, order?.viewIds, currentUserId],
  );

  const active = useMemo(
    () => (state.savedViewId ? (views.find(v => v.id === state.savedViewId) ?? null) : null),
    [views, state.savedViewId],
  );

  const currentSignature = queueSignature(state.filters, state.sort ?? SAVED_VIEW_DEFAULT_SORT);
  const activeSignature = active
    ? (() => {
        const saved = stateFromSavedView(active.state.queue ?? {}, "list", active.id);
        return queueSignature(saved.filters, saved.sort ?? SAVED_VIEW_DEFAULT_SORT);
      })()
    : null;
  const isDirty = !!active && activeSignature !== currentSignature;

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

  const rename = useCallback(
    async (view: RoadmapSavedView, name: string) => {
      try {
        await updateView({ id: view.id, name }).unwrap();
        toast.success(copy.renamed(name));
        return true;
      } catch {
        toast.error(copy.saveFailed);
        return false;
      }
    },
    [updateView, copy],
  );

  const remove = useCallback(
    async (view: RoadmapSavedView) => {
      try {
        await deleteView(view.id).unwrap();
        toast.success(copy.deleted(view.name));
        return true;
      } catch {
        toast.error(copy.deleteFailed);
        return false;
      }
    },
    [deleteView, copy],
  );

  return {
    views,
    active,
    isDirty,
    isSaving: isCreating || isUpdating || isDeleting,
    save,
    update,
    rename,
    remove,
  };
};
