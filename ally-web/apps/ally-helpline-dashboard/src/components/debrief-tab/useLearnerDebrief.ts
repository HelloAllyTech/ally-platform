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
 * The new Debrief agent's view for a session, or `null` when the existing
 * debrief should be shown instead.
 *
 * `null` covers every case where the new debrief must stay invisible: the
 * learner's organisation isn't switched on (`not_available`), the request
 * never succeeded (network, 403, 500), or the first answer hasn't
 * arrived yet. Falling back is silent on purpose — an org that isn't on the
 * new debrief must see exactly today's screen.
 *
 * Polls every 3 s while the state is `working`, for up to 4 minutes, then
 * every 30 s; every 30 s while a person finishes one (`on_its_way`); and not
 * at all otherwise (v9 FR-33).
 */
export const useLearnerDebrief = (
  sessionId: string | undefined,
  { skip = false }: { skip?: boolean } = {},
): LearnerDebriefView | null => {
  const [isWorking, setIsWorking] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const { data } = useGetLearnerDebriefQuery(sessionId ?? "", {
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
    setIsWaiting(data?.state === "on_its_way");
  }, [data?.state]);

  if (skip || !sessionId || !data || data.state === "not_available") return null;
  // A `ready` answer without cards has nothing to render — keep today's view.
  if (data.state === "ready" && !data.cards) return null;
  return data;
};
