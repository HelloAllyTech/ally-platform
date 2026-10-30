import {useEffect, useState} from 'react';

import {
  LEARNER_DEBRIEF_POLL_MS,
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
 * Polls every 5 s only while the state is `working`. A later poll that fails
 * keeps the last good answer (RTK Query keeps `data`), so a blip never swaps
 * the learner back to the old view mid-wait.
 */
export const useLearnerDebrief = (
  sessionId: string,
  {skip = false}: {skip?: boolean} = {},
): LearnerDebriefView | null => {
  const [isWorking, setIsWorking] = useState(false);
  const {data} = useGetLearnerDebriefQuery(sessionId, {
    skip: skip || !sessionId,
    pollingInterval: isWorking ? LEARNER_DEBRIEF_POLL_MS : 0,
  });

  useEffect(() => {
    setIsWorking(data?.state === 'working');
  }, [data?.state]);

  if (skip || !sessionId || !data || data.state === 'not_available') {
    return null;
  }
  if (data.state === 'ready' && !data.cards) {
    return null;
  }
  return data;
};
