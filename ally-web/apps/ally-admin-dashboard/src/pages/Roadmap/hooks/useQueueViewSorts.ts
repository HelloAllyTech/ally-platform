import { useCallback } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import { authAPI, useGetUserPreferencesQuery, useUpdateUserPreferencesMutation } from "@api";
import { LOCAL_STORAGE_KEYS, Permissions, en } from "@constants";
import { RootState, store } from "@store";
import type { RoadmapQueueSort } from "@types";
import { hasPermissions } from "@utils";

import { QUEUE_SORTS } from "../utils/queueState";

/**
 * The sort each default view opens on for this person, kept in their user preferences
 * (`roadmap_queue_sorts`, by view id) so it follows them across devices. A saved view keeps its own
 * sort inside the view instead. The cache is updated first so the list re-sorts at once, and put
 * back with a toast if the save fails.
 */
export const useQueueViewSorts = () => {
  const permissions = useSelector((state: RootState) => state.user.permissions);
  const isAuthed = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";
  const { data: preferences } = useGetUserPreferencesQuery(undefined, { skip: !isAuthed });
  const [updateUserPreferences] = useUpdateUserPreferencesMutation();
  const sorts = preferences?.roadmap_queue_sorts;

  /** The sort chosen for a default view, if it is one the Queue still offers. */
  const sortFor = useCallback(
    (viewId: string): RoadmapQueueSort | undefined => {
      const value = sorts?.[viewId];
      return QUEUE_SORTS.includes(value as RoadmapQueueSort)
        ? (value as RoadmapQueueSort)
        : undefined;
    },
    [sorts],
  );

  const canSave = hasPermissions(permissions, [Permissions.EDIT_USER_PREFERENCES]);

  const setSortFor = useCallback(
    async (viewId: string, sort: RoadmapQueueSort) => {
      const next = { ...(sorts ?? {}), [viewId]: sort };
      const patch = store.dispatch(
        authAPI.util.updateQueryData("getUserPreferences", undefined, draft => {
          draft.roadmap_queue_sorts = next;
        }),
      );
      try {
        await updateUserPreferences({ roadmap_queue_sorts: next }).unwrap();
      } catch {
        patch.undo();
        toast.error(en.roadmapV2.savedViews.sortSaveFailed);
      }
    },
    [sorts, updateUserPreferences],
  );

  return { sortFor, setSortFor, canSave };
};
