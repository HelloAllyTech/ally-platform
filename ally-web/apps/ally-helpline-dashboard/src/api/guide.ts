/**
 * The Ally guide's REST surface (plan §9.1). The thread's live stream is not
 * here: SSE needs `fetch` with an Authorization header, so it lives in
 * `pages/guided-course/hooks/useGuideEventStream.ts`.
 *
 * Nothing here is cached across courses or accounts: the journey asks once on
 * entry and then follows the stream, which is the source of truth.
 */
import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseAPI";
import { GUIDE_VISITOR_HEADER } from "../pages/guided-course/visitor/visitorToken";

import type { JourneyThread } from "../pages/guided-course/contract/bootstrap";
import type {
  GuideAdviceLineRequest,
  GuideAdviceLines,
  GuideAdviceLineView,
  GuideAvailability,
  GuideBootstrap,
  GuideCardEventRequest,
  GuideCardState,
  GuideMicroActivityRequest,
  GuideMemoryView,
  GuideMicroActivityResult,
  GuideNextStep,
  GuidePrefs,
  GuidePrefsUpdate,
  GuideSpine,
  GuideThreadOpened,
  GuideTurnAccepted,
  GuideTurnRequest,
} from "../pages/guided-course/contract/wire";

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

export interface GuideEnrollResult {
  trackEnrollmentId: string;
  alreadyEnrolled: boolean;
  spine?: GuideSpine;
  nextStep?: GuideNextStep;
}

export interface GuideCardEventResult {
  cardId: string;
  state: GuideCardState;
  /** `completed_claim` only: false until classic progress says the item is complete. */
  verified?: boolean;
}

export interface GuideVoiceSessionRequest {
  turnMode?: "hands_free" | "push_to_talk";
  language?: string;
}

export interface GuideVoiceSessionResponse {
  token: string;
  roomName: string;
  serverUrl: string;
}

export interface GuideAppointmentRequest {
  /** ISO instant. */
  at: string;
  /** IANA zone, so the reminder fires at local wall-clock time (plan §11 E-8). */
  timezone: string;
  /** `session` (the closing ritual, the default) or `spaced_recall` (the finale's look back). */
  purpose?: "session" | "spaced_recall";
}

/** Thumbs on one of Ally's messages: one per learner per message, sending again replaces it. */
export interface GuideMessageFeedbackRequest {
  rating: 1 | -1;
  comment?: string;
}

/** One entry in the learner's notebook (`GET /v1/guide/notebook`). */
export interface GuideNotebookEntry {
  id: string;
  trackId: string | null;
  /** first_move, possible_self, journal_line, rehearsed_line, reflection, noticing. */
  kind: string;
  text: string;
  createdAt: string | null;
}

/** One thing Ally remembers (`GET /v1/guide/memory`), with the learner's words it came from. */
export type GuideMemoryItem = GuideMemoryView;

/**
 * The prefs as the server returns them. `challenge` is read only when the
 * server sends it (it is stored, but not yet part of the prefs contract), so
 * the control can't promise something that isn't saved.
 */
export type GuidePrefsView = GuidePrefs & { challenge?: "normal" | "more" };

const GUIDE_TAGS = ["GuideNotebook", "GuideMemory", "GuidePrefs", "GuideAdvice"] as const;

const guideAPI = baseAPI.enhanceEndpoints({ addTagTypes: GUIDE_TAGS }).injectEndpoints({
  endpoints: builder => ({
    getGuideAvailability: builder.query<GuideAvailability, { trackId: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.AVAILABILITY(trackId),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 0,
    }),

    getGuideBootstrap: builder.query<GuideBootstrap, { trackId: string; languageCode?: string }>({
      query: ({ trackId, languageCode }) => ({
        url: ApiEndpoints.GUIDE.BOOTSTRAP(trackId),
        method: HttpMethod.GET,
        params: languageCode ? { languageCode } : undefined,
      }),
      keepUnusedDataFor: 0,
    }),

    /**
     * Signing in from a visit: open the learner's thread with the visitor token
     * alongside the JWT, so the visitor's conversation is claimed (or merged
     * into an existing thread). 403 GUIDE_NO_ACCESS leaves the visit as it was.
     */
    claimGuideThread: builder.mutation<
      GuideThreadOpened,
      { trackId: string; visitorToken: string }
    >({
      query: ({ trackId, visitorToken }) => ({
        url: ApiEndpoints.GUIDE.THREADS(trackId),
        method: HttpMethod.POST,
        headers: { [GUIDE_VISITOR_HEADER]: visitorToken },
      }),
    }),

    openGuideThread: builder.mutation<JourneyThread, { trackId: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.THREADS(trackId),
        method: HttpMethod.POST,
      }),
    }),

    enrollGuideThread: builder.mutation<GuideEnrollResult, { threadId: string }>({
      query: ({ threadId }) => ({
        url: ApiEndpoints.GUIDE.ENROLL(threadId),
        method: HttpMethod.POST,
      }),
    }),

    startGuideVoiceSession: builder.mutation<
      GuideVoiceSessionResponse,
      { threadId: string; body: GuideVoiceSessionRequest }
    >({
      query: ({ threadId, body }) => ({
        url: ApiEndpoints.GUIDE.VOICE_SESSION(threadId),
        method: HttpMethod.POST,
        body,
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
      GuideCardEventResult,
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

    getGuidePrefs: builder.query<GuidePrefsView, void>({
      query: () => ({ url: ApiEndpoints.GUIDE.PREFS, method: HttpMethod.GET }),
      providesTags: ["GuidePrefs"],
    }),

    putGuidePrefs: builder.mutation<
      GuidePrefsView,
      GuidePrefsUpdate & { challenge?: "normal" | "more" }
    >({
      query: body => ({
        url: ApiEndpoints.GUIDE.PREFS,
        method: HttpMethod.PUT,
        body,
      }),
      // The answer is the whole set: the Preferences panel shows it at once.
      async onQueryStarted(_body, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(guideAPI.util.upsertQueryData("getGuidePrefs", undefined, data));
        } catch {
          // The panel keeps showing what the server last said.
        }
      },
    }),

    /** A side quest's answer. Ungraded: never progress, never XP. */
    answerGuideMicroActivity: builder.mutation<
      GuideMicroActivityResult,
      { threadId: string; cardId: string; body: GuideMicroActivityRequest }
    >({
      query: ({ threadId, cardId, body }) => ({
        url: ApiEndpoints.GUIDE.MICRO_ACTIVITY_RESPONSES(threadId, cardId),
        method: HttpMethod.POST,
        body,
      }),
    }),

    getGuideNotebook: builder.query<GuideNotebookEntry[], { trackId?: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.NOTEBOOK,
        method: HttpMethod.GET,
        params: trackId ? { trackId } : undefined,
      }),
      providesTags: ["GuideNotebook"],
    }),

    /** The notebook as Markdown, for a download. */
    exportGuideNotebook: builder.query<string, { trackId?: string }>({
      query: ({ trackId }) => ({
        url: ApiEndpoints.GUIDE.NOTEBOOK_EXPORT,
        method: HttpMethod.GET,
        params: trackId ? { trackId } : undefined,
        responseHandler: response => response.text(),
      }),
      keepUnusedDataFor: 0,
    }),

    deleteGuideNotebookEntry: builder.mutation<{ removed: number }, { entryId: string }>({
      query: ({ entryId }) => ({
        url: ApiEndpoints.GUIDE.NOTEBOOK_ENTRY(entryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: ["GuideNotebook"],
    }),

    getGuideMemory: builder.query<GuideMemoryItem[], void>({
      query: () => ({ url: ApiEndpoints.GUIDE.MEMORY, method: HttpMethod.GET }),
      providesTags: ["GuideMemory"],
    }),

    forgetGuideMemory: builder.mutation<{ forgotten: number }, { memoryId: string }>({
      query: ({ memoryId }) => ({
        url: ApiEndpoints.GUIDE.MEMORY_ITEM(memoryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: ["GuideMemory"],
    }),

    forgetAllGuideMemory: builder.mutation<{ forgotten: number }, void>({
      query: () => ({ url: ApiEndpoints.GUIDE.MEMORY, method: HttpMethod.DELETE }),
      invalidatesTags: ["GuideMemory"],
    }),

    /** Finishers' approved lines (empty until enough have finished) and the learner's own. */
    getGuideAdvice: builder.query<GuideAdviceLines, { trackId: string }>({
      query: ({ trackId }) => ({ url: ApiEndpoints.GUIDE.ADVICE(trackId), method: HttpMethod.GET }),
      providesTags: ["GuideAdvice"],
    }),

    /** The learner's one line for this course; rewritable while it waits for review. */
    submitGuideAdvice: builder.mutation<
      GuideAdviceLineView,
      { trackId: string; body: GuideAdviceLineRequest }
    >({
      query: ({ trackId, body }) => ({
        url: ApiEndpoints.GUIDE.ADVICE(trackId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: ["GuideAdvice"],
    }),

    rateGuideMessage: builder.mutation<
      { messageId: string; rating: 1 | -1 },
      { messageId: string; body: GuideMessageFeedbackRequest }
    >({
      query: ({ messageId, body }) => ({
        url: ApiEndpoints.GUIDE.MESSAGE_FEEDBACK(messageId),
        method: HttpMethod.POST,
        body,
      }),
    }),
  }),
});

export const {
  useLazyGetGuideAvailabilityQuery,
  useLazyGetGuideBootstrapQuery,
  useOpenGuideThreadMutation,
  useClaimGuideThreadMutation,
  useEnrollGuideThreadMutation,
  useStartGuideVoiceSessionMutation,
  useSendGuideTurnMutation,
  usePostGuideCardEventMutation,
  usePutGuideAppointmentMutation,
  usePutGuidePrefsMutation,
  useGetGuideAvailabilityQuery,
  useGetGuidePrefsQuery,
  useAnswerGuideMicroActivityMutation,
  useGetGuideNotebookQuery,
  useLazyExportGuideNotebookQuery,
  useDeleteGuideNotebookEntryMutation,
  useGetGuideMemoryQuery,
  useForgetGuideMemoryMutation,
  useForgetAllGuideMemoryMutation,
  useGetGuideAdviceQuery,
  useSubmitGuideAdviceMutation,
  useRateGuideMessageMutation,
} = guideAPI;
