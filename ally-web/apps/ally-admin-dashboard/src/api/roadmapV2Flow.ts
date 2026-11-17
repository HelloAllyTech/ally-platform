import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type { RoadmapItemDetail, RoadmapItemRow } from "../types/roadmapV2";
import type {
  RoadmapAddToResult,
  RoadmapAnswerRequest,
  RoadmapBatchReviewItem,
  RoadmapBatchReviewResult,
  RoadmapCommentRequest,
  RoadmapConversationPost,
  RoadmapDictationResult,
  RoadmapDraftCreate,
  RoadmapDraftDetail,
  RoadmapDraftPatch,
  RoadmapDraftPatchResult,
  RoadmapDraftRow,
  RoadmapLeadRequest,
  RoadmapLeadSuggestions,
  RoadmapQuestionAnswers,
  RoadmapReviewRequest,
  RoadmapReviewResult,
  RoadmapSelfCheck,
  RoadmapSessionAnswers,
  RoadmapSimilarIdea,
  RoadmapSubmitResult,
} from "../types/roadmapV2Flow";

/**
 * Roadmap v2's idea flow (P3 contract): New idea, drafts, dictation, the Owner's review and lead,
 * and the answers and comments on a shared plan session.
 *
 * Tags reuse Roadmap v2's one tag type with their own ids, so nothing here needs a new entry in
 * the shared tag list: `DRAFTS` (My drafts), `DRAFT:<code>`, `ANSWERS:<sessionId>`. Review and lead
 * calls invalidate the idea and the lists, exactly as an item-changed socket event would.
 *
 * Drafts never refetch on their own autosave: the page holds the text locally, and a refetch in
 * the middle of typing would move the caret. PATCH writes its version and savedAt into the cached
 * draft instead.
 */
const T = TAG_TYPES.ROADMAP_V2_ITEMS;
const draftsTag = { type: T, id: "DRAFTS" } as const;
const draftTag = (code: string) => ({ type: T, id: `DRAFT:${code.toUpperCase()}` });
const answersTag = (sessionId: string) => ({ type: T, id: `ANSWERS:${sessionId}` });
const itemTag = (code: string) => ({ type: T, id: code.toUpperCase() });
const listTag = { type: T, id: "LIST" } as const;

export const roadmapV2FlowAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ── drafts ──────────────────────────────────────────────────────────────────────────────────
    getRoadmapDrafts: builder.query<{ drafts: RoadmapDraftRow[] }, { archived?: boolean } | void>({
      query: arg => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFTS,
        method: HttpMethod.GET,
        params: arg && arg.archived ? { archived: "1" } : undefined,
      }),
      providesTags: [draftsTag],
    }),

    getRoadmapDraft: builder.query<RoadmapDraftDetail, string>({
      query: code => ({ url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT(code), method: HttpMethod.GET }),
      providesTags: (_result, _error, code) => [draftTag(code)],
    }),

    createRoadmapDraft: builder.mutation<RoadmapDraftDetail, RoadmapDraftCreate>({
      query: body => ({ url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFTS, method: HttpMethod.POST, body }),
      invalidatesTags: [draftsTag],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // The page navigates to the new code next; hand it the draft so it doesn't load twice.
          await dispatch(roadmapV2FlowAPI.util.upsertQueryData("getRoadmapDraft", data.code, data));
        } catch {
          // The caller shows the failure.
        }
      },
    }),

    patchRoadmapDraft: builder.mutation<
      RoadmapDraftPatchResult,
      { code: string; patch: RoadmapDraftPatch }
    >({
      query: ({ code, patch }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT(code),
        method: HttpMethod.PATCH,
        body: patch,
      }),
      invalidatesTags: [draftsTag],
      async onQueryStarted({ code, patch }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            roadmapV2FlowAPI.util.updateQueryData("getRoadmapDraft", code, draft => {
              if (patch.text !== undefined) draft.text = patch.text;
              draft.title = data.title;
              draft.version = data.version;
              draft.savedAt = data.savedAt;
              // Editing away a quoted sentence reopens its check on the server; the next turn
              // or reload brings the detail. The counter moves now.
              draft.checksMet = data.checksMet;
              draft.checksTotal = data.checksTotal;
            }),
          );
        } catch {
          // Autosave retries on its own; the page keeps the text.
        }
      },
    }),

    discardRoadmapDraft: builder.mutation<void, string>({
      query: code => ({ url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT(code), method: HttpMethod.DELETE }),
      invalidatesTags: [draftsTag],
    }),

    restoreRoadmapDraft: builder.mutation<RoadmapDraftDetail, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_RESTORE(code),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, code) => [draftsTag, draftTag(code)],
    }),

    /** No answer = Check my idea. A repeated idempotencyKey returns the draft without a second turn. */
    roadmapDraftTurn: builder.mutation<
      RoadmapDraftDetail,
      { code: string; answer?: string; idempotencyKey?: string }
    >({
      query: ({ code, answer, idempotencyKey }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_TURN(code),
        method: HttpMethod.POST,
        body: {
          ...(answer !== undefined ? { answer } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      }),
      invalidatesTags: [draftsTag],
      onQueryStarted: (arg, api) => writeDraft(arg.code, api),
    }),

    reopenRoadmapDraftCheck: builder.mutation<
      RoadmapDraftDetail,
      { code: string; checkId: string }
    >({
      query: ({ code, checkId }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_REOPEN_CHECK(code, checkId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [draftsTag],
      onQueryStarted: (arg, api) => writeDraft(arg.code, api),
    }),

    selfCheckRoadmapDraft: builder.mutation<
      RoadmapDraftDetail,
      { code: string; fields: RoadmapSelfCheck }
    >({
      query: ({ code, fields }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_SELF_CHECK(code),
        method: HttpMethod.PUT,
        body: fields,
      }),
      invalidatesTags: [draftsTag],
      onQueryStarted: (arg, api) => writeDraft(arg.code, api),
    }),

    getRoadmapDraftSimilar: builder.query<
      { matches: RoadmapSimilarIdea[] },
      { code: string; text: string }
    >({
      // `text` is only part of the cache key: a new key per settled text refetches.
      query: ({ code }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_SIMILAR(code),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 30,
    }),

    addRoadmapDraftTo: builder.mutation<RoadmapAddToResult, { code: string; target: string }>({
      query: ({ code, target }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_ADD_TO(code, target),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { code, target }) => [
        draftsTag,
        draftTag(code),
        itemTag(target),
        listTag,
      ],
    }),

    submitRoadmapDraft: builder.mutation<RoadmapSubmitResult, { code: string; goalId?: string }>({
      query: ({ code, goalId }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DRAFT_SUBMIT(code),
        method: HttpMethod.POST,
        body: goalId ? { goalId } : {},
      }),
      // The draft page hands the answer to the idea page itself, after the Submit motion plays
      // (the dashed outline turns solid first), so the swap never cuts it short.
      invalidatesTags: [draftsTag, listTag],
    }),

    roadmapDictate: builder.mutation<RoadmapDictationResult, FormData>({
      query: body => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.DICTATION,
        method: HttpMethod.POST,
        body,
      }),
    }),

    // ── review and lead (Owner) ─────────────────────────────────────────────────────────────────
    reviewRoadmapItem: builder.mutation<
      RoadmapReviewResult,
      { code: string } & RoadmapReviewRequest
    >({
      query: ({ code, ...body }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.REVIEW(code),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_r, _e, { code }) => [itemTag(code), listTag],
    }),

    reviewRoadmapBatch: builder.mutation<RoadmapBatchReviewResult, RoadmapBatchReviewItem[]>({
      query: items => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.REVIEW_BATCH,
        method: HttpMethod.POST,
        body: { items },
      }),
      invalidatesTags: (_r, _e, items) => [listTag, ...items.map(i => itemTag(i.code))],
    }),

    undoRoadmapReview: builder.mutation<{ items: RoadmapItemRow[] }, string>({
      query: undoToken => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.REVIEW_UNDO,
        method: HttpMethod.POST,
        body: { undoToken },
      }),
      invalidatesTags: result => [listTag, ...(result?.items ?? []).map(i => itemTag(i.code))],
    }),

    setRoadmapLead: builder.mutation<RoadmapItemDetail, { code: string } & RoadmapLeadRequest>({
      query: ({ code, ...body }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.LEAD(code),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_r, _e, { code }) => [itemTag(code), listTag],
    }),

    getRoadmapLeadSuggestions: builder.query<RoadmapLeadSuggestions, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.LEAD_SUGGESTIONS(code),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 60,
    }),

    getRoadmapItemSimilar: builder.query<{ matches: RoadmapSimilarIdea[] }, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.ITEM_SIMILAR(code),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 120,
    }),

    startRoadmapPlanning: builder.mutation<RoadmapItemDetail, string>({
      query: code => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.START_PLANNING(code),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, code) => [itemTag(code), listTag],
    }),

    // ── P3b: answers, comments, settling ────────────────────────────────────────────────────────
    getRoadmapSessionAnswers: builder.query<RoadmapSessionAnswers, string>({
      query: sessionId => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.SESSION_ANSWERS(sessionId),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, sessionId) => [answersTag(sessionId)],
    }),

    postRoadmapAnswer: builder.mutation<
      { post: RoadmapConversationPost; question: RoadmapQuestionAnswers },
      RoadmapAnswerRequest
    >({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.SESSION_ANSWERS(sessionId),
        method: HttpMethod.POST,
        body,
      }),
      async onQueryStarted({ sessionId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            roadmapV2FlowAPI.util.updateQueryData("getRoadmapSessionAnswers", sessionId, draft => {
              replaceQuestion(draft, data.question);
            }),
          );
        } catch {
          // The card keeps the answer with Retry.
        }
      },
    }),

    postRoadmapComment: builder.mutation<{ post: RoadmapConversationPost }, RoadmapCommentRequest>({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.SESSION_COMMENTS(sessionId),
        method: HttpMethod.POST,
        body,
      }),
      async onQueryStarted({ sessionId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            roadmapV2FlowAPI.util.updateQueryData("getRoadmapSessionAnswers", sessionId, draft => {
              if (!Array.isArray(draft.comments)) draft.comments = [];
              if (!draft.comments.some(c => c.id === data.post.id)) draft.comments.push(data.post);
            }),
          );
        } catch {
          // The comment stays in place with Retry.
        }
      },
    }),

    chooseRoadmapAnswer: builder.mutation<
      { question: RoadmapQuestionAnswers },
      { sessionId: string; postId: string; idempotencyKey?: string }
    >({
      query: ({ sessionId, postId, idempotencyKey }) => ({
        url: ApiEndpoints.ROADMAP_V2_FLOW.SESSION_USE_ANSWER(sessionId, postId),
        method: HttpMethod.POST,
        body: idempotencyKey ? { idempotencyKey } : {},
      }),
      async onQueryStarted({ sessionId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            roadmapV2FlowAPI.util.updateQueryData("getRoadmapSessionAnswers", sessionId, draft => {
              replaceQuestion(draft, data.question);
            }),
          );
        } catch {
          // The card shows the failure.
        }
      },
    }),
  }),
});

/** Put a server QuestionAnswers into the cached list (in place, or appended). */
const replaceQuestion = (draft: RoadmapSessionAnswers, question: RoadmapQuestionAnswers) => {
  if (!Array.isArray(draft.questions)) draft.questions = [];
  const index = draft.questions.findIndex(q => q.questionId === question.questionId);
  if (index === -1) draft.questions.push(question);
  else draft.questions[index] = question;
};

/** A draft write answers with the whole draft: it becomes the cached draft. */
const writeDraft = async (
  code: string,
  {
    dispatch,
    queryFulfilled,
  }: {
    dispatch: (action: unknown) => unknown;
    queryFulfilled: Promise<{ data: RoadmapDraftDetail }>;
  },
) => {
  try {
    const { data } = await queryFulfilled;
    await dispatch(roadmapV2FlowAPI.util.upsertQueryData("getRoadmapDraft", code, data));
  } catch {
    // The caller shows the failure.
  }
};

export const {
  useGetRoadmapDraftsQuery,
  useGetRoadmapDraftQuery,
  useCreateRoadmapDraftMutation,
  usePatchRoadmapDraftMutation,
  useDiscardRoadmapDraftMutation,
  useRestoreRoadmapDraftMutation,
  useRoadmapDraftTurnMutation,
  useReopenRoadmapDraftCheckMutation,
  useSelfCheckRoadmapDraftMutation,
  useGetRoadmapDraftSimilarQuery,
  useAddRoadmapDraftToMutation,
  useSubmitRoadmapDraftMutation,
  useRoadmapDictateMutation,
  useReviewRoadmapItemMutation,
  useReviewRoadmapBatchMutation,
  useUndoRoadmapReviewMutation,
  useSetRoadmapLeadMutation,
  useGetRoadmapLeadSuggestionsQuery,
  useGetRoadmapItemSimilarQuery,
  useStartRoadmapPlanningMutation,
  useGetRoadmapSessionAnswersQuery,
  usePostRoadmapAnswerMutation,
  usePostRoadmapCommentMutation,
  useChooseRoadmapAnswerMutation,
} = roadmapV2FlowAPI;
