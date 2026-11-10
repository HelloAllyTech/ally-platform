import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/** A week's numbers (ally-be `checkup-stats.ts` `WeekStats`). */
export interface WeekStats {
  conversations: number;
  answers: number;
  answeredWithSource: number;
  declined: number;
  wrongDeclineSuspected: number;
  handedOver: number;
  crisis: number;
  thumbsUp: number;
  thumbsDown: number;
  answeredPct: number;
  thumbsUpPct: number | null;
}

export interface Scorecard {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  trend: { day: string; answeredPct: number | null }[];
  unanswered: { id: string; question: string; at: string }[];
  thumbsDown: {
    id: string;
    reason: "wrong_info" | "not_answered" | "other" | null;
    note: string | null;
    at: string;
    reply: string;
    question: string | null;
  }[];
  checkup: { passed: number; total: number; at: string | null } | null;
}

/** The live scorecard on the Overview (chunk Q2a). */
export const scorecardApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getScorecard: builder.query<Scorecard, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.SCORECARD(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.SCORECARD],
    }),
    answerUnanswered: builder.mutation<
      { ok: true },
      { id: string; questionId: string; text: string }
    >({
      query: ({ id, questionId, text }) => ({
        url: ApiEndpoints.CHATBOTS.SCORECARD_ANSWER(id, questionId),
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.SCORECARD],
    }),
    correctFeedback: builder.mutation<
      { ok: true },
      { id: string; feedbackId: string; text: string }
    >({
      query: ({ id, feedbackId, text }) => ({
        url: ApiEndpoints.CHATBOTS.SCORECARD_CORRECT(id, feedbackId),
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.SCORECARD],
    }),
    markFeedbackFine: builder.mutation<{ ok: true }, { id: string; feedbackId: string }>({
      query: ({ id, feedbackId }) => ({
        url: ApiEndpoints.CHATBOTS.SCORECARD_FINE(id, feedbackId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.SCORECARD],
    }),
  }),
});

export const {
  useGetScorecardQuery,
  useAnswerUnansweredMutation,
  useCorrectFeedbackMutation,
  useMarkFeedbackFineMutation,
} = scorecardApi;
