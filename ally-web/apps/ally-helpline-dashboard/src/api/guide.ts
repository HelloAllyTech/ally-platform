/**
 * The Ally guide's REST surface (plan §9.1). The thread's live stream is not
 * here: SSE needs `fetch` with an Authorization header, so it lives in
 * `pages/guided-course/hooks/useGuideEventStream.ts`.
 *
 * Nothing here is cached across courses or accounts: the journey asks once on
 * entry and then follows the stream, which is the source of truth.
 */
import { ApiEndpoints, HttpMethod } from "@constants";
import type {
  GuideCardEventRequest,
  GuideTurnAccepted,
  GuideTurnRequest,
} from "@types/generated/guide-contract";

import { baseAPI } from "./baseAPI";

import type {
  GuideBootstrapWire,
  GuidanceLevel,
  JourneyAvailability,
  JourneyThread,
} from "../pages/guided-course/contract/bootstrap";

export interface GuideMessageRow {
  id: string;
  seq: number;
  role: "learner" | "ally" | "system_note";
  kind: string;
  channel: string;
  text: string;
  turnId: string | null;
  createdAt: string;
}

export interface GuideAppointmentRequest {
  /** ISO instant. */
  at: string;
  /** IANA zone, so the reminder fires at local wall-clock time (plan §11 E-8). */
  timezone: string;
}

const guideAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getGuideAvailability: builder.query<Partial<JourneyAvailability>, { trackId: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.AVAILABILITY(trackId),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 0,
    }),

    getGuideBootstrap: builder.query<
      GuideBootstrapWire,
      { trackId: string; languageCode?: string }
    >({
      query: ({ trackId, languageCode }) => ({
        url: ApiEndpoints.GUIDE.BOOTSTRAP(trackId),
        method: HttpMethod.GET,
        params: languageCode ? { languageCode } : undefined,
      }),
      keepUnusedDataFor: 0,
    }),

    openGuideThread: builder.mutation<JourneyThread, { trackId: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.THREADS(trackId),
        method: HttpMethod.POST,
      }),
    }),

    enrollGuideThread: builder.mutation<unknown, { threadId: string; languageCode?: string }>({
      query: ({ threadId, languageCode }) => ({
        url: ApiEndpoints.GUIDE.ENROLL(threadId),
        method: HttpMethod.POST,
        body: languageCode ? { languageCode } : undefined,
      }),
    }),

    sendGuideTurn: builder.mutation<
      GuideTurnAccepted,
      { threadId: string; body: GuideTurnRequest }
    >({
      query: ({ threadId, body }) => ({
        url: ApiEndpoints.GUIDE.TURNS(threadId),
        method: HttpMethod.POST,
        body,
      }),
    }),

    getGuideMessages: builder.query<GuideMessageRow[], { threadId: string; beforeSeq?: number }>({
      query: ({ threadId, beforeSeq }) => ({
        url: ApiEndpoints.GUIDE.MESSAGES(threadId),
        method: HttpMethod.GET,
        params: beforeSeq ? { beforeSeq } : undefined,
      }),
      keepUnusedDataFor: 0,
    }),

    postGuideCardEvent: builder.mutation<
      unknown,
      { threadId: string; cardId: string; body: GuideCardEventRequest }
    >({
      query: ({ threadId, cardId, body }) => ({
        url: ApiEndpoints.GUIDE.CARD_EVENTS(threadId, cardId),
        method: HttpMethod.POST,
        body,
      }),
    }),

    putGuideAppointment: builder.mutation<
      unknown,
      { threadId: string; body: GuideAppointmentRequest }
    >({
      query: ({ threadId, body }) => ({
        url: ApiEndpoints.GUIDE.APPOINTMENT(threadId),
        method: HttpMethod.PUT,
        body,
      }),
    }),

    putGuidePrefs: builder.mutation<unknown, { guidance: GuidanceLevel }>({
      query: body => ({
        url: ApiEndpoints.GUIDE.PREFS,
        method: HttpMethod.PUT,
        body,
      }),
    }),
  }),
});

export const {
  useLazyGetGuideAvailabilityQuery,
  useLazyGetGuideBootstrapQuery,
  useOpenGuideThreadMutation,
  useEnrollGuideThreadMutation,
  useSendGuideTurnMutation,
  usePostGuideCardEventMutation,
  usePutGuideAppointmentMutation,
  usePutGuidePrefsMutation,
  useGetGuideAvailabilityQuery,
} = guideAPI;
