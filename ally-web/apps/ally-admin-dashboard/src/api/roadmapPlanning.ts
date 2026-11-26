import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type { BuilderBriefResponse } from "../types/builder";
import type { RoadmapItemDetail } from "../types/roadmapV2";

/** One thing standing between a plan and Close plan (ally-be plan-close-readiness.util). */
export interface RoadmapCloseBlocker {
  kind: "prd" | "design" | "answers" | string;
  text: string;
}

/** The one definition of "ready to close", as the dialog reads it. */
export interface RoadmapCloseReadiness {
  ready: boolean;
  prdEmpty: boolean;
  blockers: RoadmapCloseBlocker[];
}

const T = TAG_TYPES.ROADMAP_V2_ITEMS;
const itemTag = (code: string) => ({ type: T, id: code.toUpperCase() });
const listTag = { type: T, id: "LIST" } as const;
const readinessTag = (code: string) => ({ type: T, id: `CLOSE_READINESS:${code.toUpperCase()}` });

/**
 * Planning from the idea page (audit 2026-11-19, recs 1 and 2): the planner's message to the plan
 * agent, what the plan still needs before it closes, Close plan with a reason, and the specialist
 * reviews. Its own slice so the idea flow's api file stays as it was.
 */
export const roadmapPlanningAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getRoadmapCloseReadiness: builder.query<RoadmapCloseReadiness, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.CLOSE_READINESS(code),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, code) => [readinessTag(code)],
      keepUnusedDataFor: 0,
    }),

    /** Close plan; `reason` is required by the server only while something is still open. */
    closeRoadmapPlan: builder.mutation<RoadmapItemDetail, { code: string; reason?: string }>({
      query: ({ code, reason }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.CLOSE_PLAN(code),
        method: HttpMethod.POST,
        body: reason ? { reason } : {},
      }),
      invalidatesTags: (_r, _e, { code }) => [itemTag(code), listTag, readinessTag(code)],
    }),

    /**
     * The planner's message; empty asks the agent for its opening situation brief. With
     * `briefResponse` it answers that brief line by line, and `text` is the summary shown.
     */
    sendRoadmapPlanMessage: builder.mutation<
      { started: true },
      { code: string; sessionId: string; text?: string; briefResponse?: BuilderBriefResponse }
    >({
      query: ({ code, text, briefResponse }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.PLAN_MESSAGE(code),
        method: HttpMethod.POST,
        body: {
          ...(text ? { text } : {}),
          ...(briefResponse ? { briefResponse } : {}),
        },
      }),
      invalidatesTags: (_r, _e, { sessionId }) => [
        { type: TAG_TYPES.BUILDER_SESSION, id: sessionId },
      ],
    }),

    /** The specialist reviews the PRD's paths call for (the plan's existing checks route). */
    runRoadmapPlanChecks: builder.mutation<unknown, { code: string; sessionId: string }>({
      query: ({ sessionId }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.PLAN_CHECKS_RUN(sessionId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { code }) => [readinessTag(code), itemTag(code)],
    }),
  }),
});

export const {
  useGetRoadmapCloseReadinessQuery,
  useCloseRoadmapPlanMutation,
  useSendRoadmapPlanMessageMutation,
  useRunRoadmapPlanChecksMutation,
} = roadmapPlanningAPI;
