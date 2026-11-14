import { useCallback, useContext, useState } from "react";

import { useDispatch } from "react-redux";

import { chatbotsApi, useChangeHomeListMutation, useGetHomeListQuery } from "@api";
import type { HomeList, HomeListChange, HomeListItems, HomeListName } from "@types";

import { HOME } from "./copy";
import { HomeSavesContext } from "./useHomeField";

import type { AppDispatch } from "../../store";

export interface HomeListState<K extends HomeListName> {
  items: HomeListItems[K][];
  loading: boolean;
  failed: boolean;
  yourOrganisation: { id: string; name: string } | null;
  /** True while a change is on its way. */
  saving: boolean;
  /** Why the last change didn't go through (refused, or the list changed elsewhere). */
  error: string | null;
  /**
   * Send one change, with the version the list had when it was shown. `undo` turns the saved list
   * into the change that reverses it; when given, the page offers "Changed · Undo".
   */
  change: (
    change: HomeListChange,
    undo?: (saved: HomeListItems[K][]) => HomeListChange | null,
  ) => Promise<boolean>;
  refetch: () => void;
}

const failure = (error: unknown) => {
  const data = (error as { data?: Record<string, unknown> })?.data;
  return {
    stale: data?.errorCode === "stale" ? (data.details as HomeList<HomeListName>) : null,
    message: typeof data?.message === "string" ? data.message : null,
  };
};

/**
 * One of the home's lists (chunk 20d-2): who can open the page, WhatsApp's list, the team, the
 * documents, the quick replies. Each change is one entry, saved on its own with the version of the
 * list it was based on, like the home's fields. A change refused because the list changed
 * elsewhere shows the list as it is now, with the server's words.
 */
export const useHomeList = <K extends HomeListName>(
  botId: string,
  list: K,
  options: { skip?: boolean } = {},
): HomeListState<K> => {
  const query = useGetHomeListQuery({ id: botId, list }, { skip: options.skip });
  const [send] = useChangeHomeListMutation();
  const dispatch = useDispatch<AppDispatch>();
  const saves = useContext(HomeSavesContext);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = query.data as HomeList<K> | undefined;

  const change = useCallback<HomeListState<K>["change"]>(
    async (next, undo) => {
      const version = data?.version;
      if (!version) return false;
      setSaving(true);
      saves.status("saving");
      try {
        const saved = (await send({
          id: botId,
          list,
          version,
          change: next,
        }).unwrap()) as HomeList<K>;
        setError(null);
        saves.status("saved");
        const reverse = undo?.(saved.items);
        if (reverse) {
          saves.changed(() => {
            void send({ id: botId, list, version: saved.version, change: reverse })
              .unwrap()
              .catch((undoFailure: unknown) =>
                setError(failure(undoFailure).message ?? HOME.saving.failed),
              );
          });
        }
        return true;
      } catch (refused) {
        const { stale, message } = failure(refused);
        if (stale) {
          dispatch(
            chatbotsApi.util.updateQueryData("getHomeList", { id: botId, list }, current => {
              current.items = stale.items;
              current.version = stale.version;
            }),
          );
          saves.status("idle");
        } else {
          saves.status("failed");
        }
        setError(message ?? HOME.saving.failed);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [botId, data?.version, dispatch, list, saves, send],
  );

  return {
    items: data?.items ?? [],
    loading: query.isLoading,
    failed: query.isError,
    yourOrganisation: data?.yourOrganisation ?? null,
    saving,
    error,
    change,
    refetch: () => void query.refetch(),
  };
};

/** The entry a saved add created: the one whose id wasn't there before. */
export const addedIn = <T extends { id: string }>(before: T[], after: T[]): T | undefined => {
  const known = new Set(before.map(item => item.id));
  return after.find(item => !known.has(item.id));
};
