import {useEffect, useState} from 'react';

import {
  LEARNER_DEBRIEF_FAST_FOR_MS,
  LEARNER_DEBRIEF_POLL_MS,
  LEARNER_DEBRIEF_SLOW_POLL_MS,
  useGetLearnerDebriefQuery,
} from '@/services/learnerDebriefApi';
import {LearnerDebriefView} from '@/types';

/**
 * The Debrief agent's view for a session, or `null` when today's debrief
 * should be shown instead: the learner's organisation isn't switched on
 * (`not_available`), the request never succeeded, or the first answer hasn't
 * arrived. Falling back is silent on purpose — an organisation that isn't on
 * the new debrief must see exactly today's screen.
 *
 * Polls every 3 s while the state is `working`, for up to 4 minutes, then
 * every 30 s; every 30 s while a person finishes one (`on_its_way`); and not
 * at all otherwise — mirrors ally-web. A later poll that fails keeps the last
 * good answer (RTK Query keeps `data`), so a blip never swaps the learner
 * back to the old view mid-wait.
 */
export const useLearnerDebrief = (
  sessionId: string,
  {skip = false}: {skip?: boolean} = {},
): LearnerDebriefView | null => {
  const [isWorking, setIsWorking] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const {data} = useGetLearnerDebriefQuery(sessionId, {
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
    if (!isWorking) {
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), LEARNER_DEBRIEF_FAST_FOR_MS);
    return () => clearTimeout(timer);
  }, [isWorking]);

  useEffect(() => {
    setIsWorking(data?.state === 'working');
    setIsWaiting(data?.state === 'on_its_way');
  }, [data?.state]);

  if (skip || !sessionId || !data || data.state === 'not_available') {
    return null;
  }
  if (data.state === 'ready' && !data.cards) {
    return null;
  }
  return data;
};
