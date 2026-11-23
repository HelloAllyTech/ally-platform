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
  /** Booking steps that went wrong, last 7 days (Q3d): nothing to Answer. */
  bookingProblems?: { id: string; question: string; at: string }[];
  thumbsDown: {
    id: string;
    reason: "wrong_info" | "not_answered" | "other" | null;
    note: string | null;
    at: string;
    reply: string;
    question: string | null;
  }[];
  checkup: {
    passed: number;
    total: number;
    at: string | null;
    /** Q3-fast Part 3: above the publish gate, and how many need a fix (null: not worked out). */
    ready?: boolean | null;
    needFix?: number | null;
  } | null;
}

/** A count the server lets the owner see: the number, or "fewer than 5" (D8). */
export type SafeCount = number | { lessThan: number };

export type OverviewRange = 7 | 30 | 90;

/** ally-be `GET :id/home/overview`: counts only, with groups under 5 already held back. */
export interface HomeOverview {
  range: OverviewRange;
  timeZone: string;
  from: string;
  to: string;
  conversations: SafeCount;
  people: SafeCount;
  days: { day: string; conversations: SafeCount; people: SafeCount }[];
  answered: { share: number | null; fewerThan5: boolean };
  handedToPerson: { count: SafeCount; medianWaitMinutes: number | null };
  ratings: { up: SafeCount; down: SafeCount };
  byChannel: { key: string; count: SafeCount }[];
  byLanguage: { key: string; count: SafeCount }[];
  topUnanswered: (
    | { kind: "question"; text: string; count: number }
    | { kind: "theme"; theme: string; count: SafeCount }
  )[];
}

/** The live scorecard on the Overview (chunk Q2a). */
export const scorecardApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getScorecard: builder.query<Scorecard, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.SCORECARD(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.SCORECARD],
    }),
    getHomeOverview: builder.query<HomeOverview, { id: string; range: OverviewRange }>({
      query: ({ id, range }) => ({
        url: ApiEndpoints.CHATBOTS.HOME_OVERVIEW(id, range),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.SCORECARD],
    }),
    answerUnanswered: builder.mutation<
      { ok: true },
      { id: string; questionId: string; text: string; addToCheckup?: boolean }
    >({
      query: ({ id, questionId, text, addToCheckup }) => ({
        url: ApiEndpoints.CHATBOTS.SCORECARD_ANSWER(id, questionId),
        method: HttpMethod.POST,
        body: { text, ...(addToCheckup === false ? { addToCheckup } : {}) },
      }),
      invalidatesTags: [TAG_TYPES.SCORECARD],
    }),
    correctFeedback: builder.mutation<
      { ok: true },
      { id: string; feedbackId: string; text: string; addToCheckup?: boolean }
    >({
      query: ({ id, feedbackId, text, addToCheckup }) => ({
        url: ApiEndpoints.CHATBOTS.SCORECARD_CORRECT(id, feedbackId),
        method: HttpMethod.POST,
        body: { text, ...(addToCheckup === false ? { addToCheckup } : {}) },
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
  useGetHomeOverviewQuery,
  useAnswerUnansweredMutation,
  useCorrectFeedbackMutation,
  useMarkFeedbackFineMutation,
} = scorecardApi;
