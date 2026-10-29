import { useEffect, useState } from "react";

import { LEARNER_DEBRIEF_POLL_MS, useGetLearnerDebriefQuery } from "@api";
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
 * Polls every ~5 s while the state is `working`, and stops once it isn't.
 */
export const useLearnerDebrief = (
  sessionId: string | undefined,
  { skip = false }: { skip?: boolean } = {},
): LearnerDebriefView | null => {
  const [isWorking, setIsWorking] = useState(false);
  const { data } = useGetLearnerDebriefQuery(sessionId ?? "", {
    skip: skip || !sessionId,
    pollingInterval: isWorking ? LEARNER_DEBRIEF_POLL_MS : 0,
  });

  // RTK Query keeps the last good `data` when a later poll fails, so a blip
  // mid-poll keeps the progress panel (and the polling) going rather than
  // swapping the learner back to the old view. Only a request that never
  // succeeded falls back.
  useEffect(() => {
    setIsWorking(data?.state === "working");
  }, [data?.state]);

  if (skip || !sessionId || !data || data.state === "not_available") return null;
  // A `ready` answer without cards has nothing to render — keep today's view.
  if (data.state === "ready" && !data.cards) return null;
  return data;
};
