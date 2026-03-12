import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  GetReviewByIdResponse,
  GetThreadCommentsRequest,
  GetThreadCommentsResponse,
  ReviewsResponse,
} from '@/types';

import {api} from './api';

export const scribeReviewsApi = api.injectEndpoints({
  endpoints: builder => ({
    getScribeReviews: builder.query<
      ReviewsResponse | null,
      {sortBy: string; limit: number; offset: number}
    >({
      query: ({sortBy, limit, offset}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.REVIEWS,
        method: API_METHODS.GET,
        params: {sortBy, limit, offset, order: SortOrder.DESC},
      }),
    }),
    getScribeReviewById: builder.query<
      GetReviewByIdResponse,
      {reviewId: string}
    >({
      query: ({reviewId}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.REVIEW_BY_ID(reviewId),
        method: API_METHODS.GET,
      }),
      providesTags: ['ReviewDetails'],
      keepUnusedDataFor: 0,
    }),
    getScribeMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit, sortOrder, sortBy}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GET_MESSAGES(reviewId),
        method: API_METHODS.GET,
        params: {
          offset,
          limit,
          ...(sortOrder && {sortOrder}),
          ...(sortBy && {sortBy}),
        },
      }),
      providesTags: ['ReviewMessages'],
    }),
    addScribeReviewComment: builder.mutation<
      AddReviewCommentResponse,
      AddReviewCommentRequest
    >({
      query: ({
        reviewId,
        threadId,
        parentCommentId,
        messageId,
        selection,
        content,
      }) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.ADD_REVIEW_COMMENT(reviewId),
        method: API_METHODS.POST,
        body: {
          threadId,
          parentCommentId,
          messageId,
          selection,
          content,
        },
      }),
      invalidatesTags: ['ReviewDetails', 'ReviewMessages'],
    }),
    getScribeThreadComments: builder.query<
      GetThreadCommentsResponse,
      GetThreadCommentsRequest
    >({
      query: ({threadId, offset, limit}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GET_THREAD_COMMENTS(threadId),
        method: API_METHODS.GET,
        ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
          ? {params: {offset, limit}}
          : {}),
      }),
    }),
    updateScribeCommentVisibility: builder.mutation<
      {success: boolean},
      {commentId: string; hidden: boolean}
    >({
      query: ({commentId, hidden}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.UPDATE_COMMENT_VISIBILITY(commentId),
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateScribeComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      query: ({commentId, content}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.UPDATE_COMMENT(commentId),
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['ReviewThreads', 'GeneralComments'],
    }),
    deleteScribeComment: builder.mutation<
      {success: boolean},
      {commentId: string}
    >({
      query: ({commentId}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.DELETE_COMMENT(commentId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: ['ReviewThreads', 'GeneralComments'],
    }),
    getScribeGeneralReviewComments: builder.query<
      GetThreadCommentsResponse,
      {reviewId: string; offset?: number; limit?: number}
    >({
      query: ({reviewId, offset, limit}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GET_GENERAL_REVIEW_COMMENTS(reviewId),
        method: API_METHODS.GET,
        ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
          ? {params: {offset, limit}}
          : {}),
      }),
      providesTags: ['GeneralComments'],
    }),
  }),
});

export const {
  useGetScribeReviewsQuery,
  useLazyGetScribeReviewsQuery,
  useGetScribeReviewByIdQuery,
  useLazyGetScribeMessagesQuery,
  useAddScribeReviewCommentMutation,
  useLazyGetScribeThreadCommentsQuery,
  useUpdateScribeCommentVisibilityMutation,
  useUpdateScribeCommentMutation,
  useDeleteScribeCommentMutation,
  useLazyGetScribeGeneralReviewCommentsQuery,
  useGetScribeGeneralReviewCommentsQuery,
} = scribeReviewsApi;
