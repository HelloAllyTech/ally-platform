import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  ExpertComment,
  ExpertCommentTag,
  ExpertMyComment,
  ExpertQueue,
  ExpertQueueFilters,
  ExpertReviewDetail,
  ExpertVerdict,
  NewExpertComment,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Expert review of Debrief agent debriefs. Every write invalidates the whole tag: a comment changes
 * the review screen, the queue's comment count and "Your comments" at once.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefExpertReviewAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getExpertReviewQueue: builder.query<ExpertQueue, ExpertQueueFilters>({
      query: ({ includeReviewed, ...rest }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.QUEUE,
        method: HttpMethod.GET,
        params: {
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => !!v)),
          ...(includeReviewed ? { includeReviewed: "true" } : {}),
        },
      }),
      providesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    getExpertReview: builder.query<ExpertReviewDetail, string>({
      query: runId => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.RUN(runId),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    getMyExpertComments: builder.query<{ items: ExpertMyComment[] }, void>({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.MY_COMMENTS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    setExpertVerdict: builder.mutation<
      ExpertReviewDetail,
      { runId: string; verdict: ExpertVerdict; hardFails: string[] }
    >({
      query: ({ runId, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.VERDICT(runId),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    addExpertComment: builder.mutation<ExpertComment, { runId: string; comment: NewExpertComment }>(
      {
        query: ({ runId, comment }) => ({
          url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.COMMENTS(runId),
          method: HttpMethod.POST,
          body: comment,
        }),
        invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
      },
    ),
    editExpertComment: builder.mutation<
      ExpertComment,
      { id: string; body?: string; tag?: ExpertCommentTag | null }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.COMMENT(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    deleteExpertComment: builder.mutation<{ deleted: boolean }, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.COMMENT(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    setExpertCommentStatus: builder.mutation<
      ExpertComment,
      { id: string; action: "resolve" | "reopen" }
    >({
      query: ({ id, action }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.COMMENT_ACTION(id, action),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
    markStillHappening: builder.mutation<
      ExpertComment,
      { id: string; runId: string; comment: NewExpertComment }
    >({
      query: ({ id, runId, comment }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.COMMENT_ACTION(id, "still-happening"),
        method: HttpMethod.POST,
        body: { ...comment, runId },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
  }),
});

export const {
  useGetExpertReviewQueueQuery,
  useGetExpertReviewQuery,
  useGetMyExpertCommentsQuery,
  useSetExpertVerdictMutation,
  useAddExpertCommentMutation,
  useEditExpertCommentMutation,
  useDeleteExpertCommentMutation,
  useSetExpertCommentStatusMutation,
  useMarkStillHappeningMutation,
} = debriefExpertReviewAPI;
