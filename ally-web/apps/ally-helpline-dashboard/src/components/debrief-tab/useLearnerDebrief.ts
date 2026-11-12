import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  LEARNER_DEBRIEF_FAST_FOR_MS,
  LEARNER_DEBRIEF_POLL_MS,
  LEARNER_DEBRIEF_SLOW_POLL_MS,
  useGetLearnerDebriefQuery,
} from "@api";
import { LearnerDebriefView } from "@types";

/**
 * Whether a failed request means "the debrief didn't load" (the learner gets
 * Try again) rather than "this debrief isn't yours to see" (today's view):
 * a server error or no connection at all, never a 401/403/404.
 */
const isLoadFailure = (error: unknown): boolean => {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = (error as { status: unknown }).status;
  if (typeof status === "number") return status >= 500;
  return status === "FETCH_ERROR" || status === "TIMEOUT_ERROR" || status === "PARSING_ERROR";
};

export interface LearnerDebriefResult {
  /** The view to render, or `null` to keep the existing debrief. */
  view: LearnerDebriefView | null;
  /** Ask again after a failed load. */
  retry: () => void;
  /** True while that retry is in flight. */
  retrying: boolean;
}

/**
 * The new Debrief agent's view for a session, or `null` when the existing
 * debrief should be shown instead.
 *
 * `null` covers the cases where the new debrief must stay invisible: the
 * learner's organisation isn't switched on (`not_available`), the server
 * refused (401/403/404), or the first answer hasn't arrived yet. A request
 * that failed outright — a 5xx or no connection — is `failed` instead
 * (PRD §6.12): the learner sees "Your debrief didn't load" with Try again,
 * never the old note silently in its place.
 *
 * Polls every 3 s while the state is `working`, for up to 4 minutes, then
 * every 30 s; every 30 s while a person finishes one (`on_its_way`); and not
 * at all otherwise (v9 FR-33).
 */
export const useLearnerDebrief = (
  sessionId: string | undefined,
  { skip = false }: { skip?: boolean } = {},
): LearnerDebriefResult => {
  const [isWorking, setIsWorking] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const { data, error, refetch, isFetching } = useGetLearnerDebriefQuery(sessionId ?? "", {
    skip: skip || !sessionId,
    pollingInterval:
      isWorking && !slow
        ? LEARNER_DEBRIEF_POLL_MS
        : isWorking || isWaiting
          ? LEARNER_DEBRIEF_SLOW_POLL_MS
          : 0,
  });

  // After four minutes of "working", ask less often.
  useEffect(() => {
    if (!isWorking) return undefined;
    const timer = setTimeout(() => setSlow(true), LEARNER_DEBRIEF_FAST_FOR_MS);
    return () => clearTimeout(timer);
  }, [isWorking]);

  // RTK Query keeps the last good `data` when a later poll fails, so a blip
  // mid-poll keeps the progress panel (and the polling) going rather than
  // swapping the learner back to the old view. Only a request that never
  // succeeded falls back.
  // v9 FR-28 on the web: a learner who left the tab while it was writing
  // sees "Debrief ready · Ally" in the tab title, until they come back.
  const { t } = useTranslation();
  const wasWorking = useRef(false);
  useEffect(() => {
    const working = data?.state === "working";
    if (wasWorking.current && data?.state === "ready" && document.hidden) {
      const before = document.title;
      document.title = t("postSim.debriefCards.ready.tabTitle");
      const restore = () => {
        if (!document.hidden) {
          document.title = before;
          document.removeEventListener("visibilitychange", restore);
        }
      };
      document.addEventListener("visibilitychange", restore);
    }
    wasWorking.current = working;
  }, [data?.state, t]);

  useEffect(() => {
    setIsWorking(data?.state === "working");
    setIsWaiting(data?.state === "on_its_way" || data?.state === "taking_longer");
  }, [data?.state]);

  // Stays failed through a retry, so Try again never flashes the old note.
  const loadFailed = !data && isLoadFailure(error);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (data) setFailed(false);
    else if (loadFailed) setFailed(true);
  }, [data, loadFailed]);

  const retry = () => {
    if (!skip && sessionId) void refetch();
  };
  const result = (view: LearnerDebriefView | null): LearnerDebriefResult => ({
    view,
    retry,
    retrying: isFetching,
  });
  if (skip || !sessionId) return result(null);
  // RTK Query keeps the last good answer when a later poll fails, so only a
  // request that never succeeded reaches here without `data`.
  if (!data) return result(failed || loadFailed ? { state: "failed" } : null);
  // FR-46: after an emergency stop the tab says "not available", never
  // today's debrief; otherwise the organisation simply isn't switched on.
  if (data.state === "not_available") return result(data.stopped ? data : null);
  // A `ready` answer without cards has nothing to render — keep today's view.
  if (data.state === "ready" && !data.cards) return result(null);
  return result(data);
};
