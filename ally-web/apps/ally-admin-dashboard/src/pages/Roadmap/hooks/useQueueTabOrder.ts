import { useCallback, useMemo } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import { authAPI, useGetUserPreferencesQuery, useUpdateUserPreferencesMutation } from "@api";
import { LOCAL_STORAGE_KEYS, Permissions } from "@constants";
import { RootState, store } from "@store";
import type { RoadmapQueueView } from "@types";
import { hasPermissions } from "@utils";

import { orderViews } from "../utils/queueState";

/**
 * The Queue's built-in tabs in this person's order. The order is saved in their user preferences
 * (`roadmap_queue_tab_order`), so it follows them to every device; until they drag a tab it is the
 * default order. Like the sidebar, a drag updates the cache first so the tabs move at once, and is
 * undone with a toast if the save fails.
 */
export const useQueueTabOrder = (allowed: RoadmapQueueView[]) => {
  const permissions = useSelector((state: RootState) => state.user.permissions);
  const isAuthed = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";
  const { data: preferences } = useGetUserPreferencesQuery(undefined, { skip: !isAuthed });
  const [updateUserPreferences] = useUpdateUserPreferencesMutation();

  const saved = preferences?.roadmap_queue_tab_order;
  // A fresh array each render would re-run every memo below; key on the contents.
  const allowedKey = allowed.join(",");
  const ordered = useMemo(
    () => orderViews(allowedKey ? (allowedKey.split(",") as RoadmapQueueView[]) : [], saved),
    [allowedKey, saved],
  );

  // The same permission that lets the sidebar order be saved.
  const canReorder = hasPermissions(permissions, [Permissions.EDIT_USER_PREFERENCES]);

  const reorder = useCallback(
    async (next: RoadmapQueueView[]) => {
      const patch = store.dispatch(
        authAPI.util.updateQueryData("getUserPreferences", undefined, draft => {
          draft.roadmap_queue_tab_order = next;
        }),
      );
      try {
        await updateUserPreferences({ roadmap_queue_tab_order: next }).unwrap();
      } catch {
        patch.undo();
        toast.error("Couldn't save the tab order");
      }
    },
    [updateUserPreferences],
  );

  return { views: ordered, canReorder, reorder };
};
