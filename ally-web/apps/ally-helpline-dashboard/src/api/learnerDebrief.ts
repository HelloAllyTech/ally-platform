import { ApiEndpoints, HttpMethod } from "@constants";
import { LearnerDebriefView } from "@types";

import { baseAPI } from "./baseAPI";

/** How often to re-ask while the Debrief agent is still writing. */
export const LEARNER_DEBRIEF_POLL_MS = 5000;

const learnerDebriefAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /**
     * The new Debrief agent's debrief for one of the caller's own sessions.
     * Poll it with `pollingInterval` only while `state === "working"` — see
     * `components/debrief-tab/useLearnerDebrief.ts`.
     */
    getLearnerDebrief: builder.query<LearnerDebriefView, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.GET_LEARNER_DEBRIEF(sessionId),
        method: HttpMethod.GET,
      }),
    }),
  }),
});

export const { useGetLearnerDebriefQuery } = learnerDebriefAPI;
