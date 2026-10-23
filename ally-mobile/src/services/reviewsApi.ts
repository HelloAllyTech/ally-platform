import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  CreateReviewRequest,
  CreateReviewResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  GetReviewByIdResponse,
  GetReviewResponse,
  GetThreadCommentsRequest,
  GetThreadCommentsResponse,
  ReviewsResponse,
  UpdateReviewStatusRequest,
  UpdateReviewStatusResponse,
} from '@/types';

import {api} from './api';

export const reviewsApi = api.injectEndpoints({
  endpoints: builder => ({
    createReview: builder.mutation<CreateReviewResponse, CreateReviewRequest>({
      query: body => ({
        url: API_ROUTES.SIMULATION_REVIEWS.CREATE_REVIEW,
        method: API_METHODS.POST,
        body,
      }),
    }),
    getReview: builder.query<GetReviewResponse, {reviewId: string}>({
      query: ({reviewId}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GET_REVIEW(reviewId),
        method: API_METHODS.GET,
      }),
    }),
    updateReviewStatus: builder.mutation<
      UpdateReviewStatusResponse,
      {reviewId: string; body: UpdateReviewStatusRequest}
    >({
      query: ({reviewId, body}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.UPDATE_REVIEW_STATUS(reviewId),
        method: API_METHODS.PATCH,
        body,
      }),
      invalidatesTags: ['ReviewDetails'],
    }),
    addReviewComment: builder.mutation<
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
        url: API_ROUTES.SIMULATION_REVIEWS.ADD_REVIEW_COMMENT(reviewId),
        method: API_METHODS.POST,
        body: {
          threadId,
          parentCommentId,
          messageId,
          selection,
          content,
        },
      }),
      invalidatesTags: [
        'ReviewDetails',
        'ReviewMessages',
        'Badges',
        'GeneralComments',
      ],
    }),
    getMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit, sortOrder, sortBy}) => {
        return {
          url: API_ROUTES.SIMULATION_REVIEWS.GET_MESSAGES(reviewId),
          method: API_METHODS.GET,
          params: {
            offset,
            limit,
            ...(sortOrder && {sortOrder}),
            ...(sortBy && {sortBy}),
          },
        };
      },
      providesTags: ['ReviewMessages'],
    }),
    getThreadComments: builder.query<
      GetThreadCommentsResponse,
      GetThreadCommentsRequest
    >({
      query: ({threadId, offset, limit}) => {
        return {
          url: API_ROUTES.SIMULATION_REVIEWS.GET_THREAD_COMMENTS(threadId),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {params: {offset, limit}}
            : {}),
        };
      },
    }),
    getReviews: builder.query<
      ReviewsResponse | null,
      {sortBy: string; readFilter?: string; limit: number; offset: number}
    >({
      query: ({sortBy, readFilter, limit, offset}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.REVIEWS,
        method: API_METHODS.GET,
        params: {sortBy, readFilter, limit, offset, order: SortOrder.DESC},
      }),
    }),
    markSimulationReviewAsRead: builder.mutation<
      {success: boolean},
      {reviewId: string}
    >({
      query: ({reviewId}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.MARK_READ(reviewId),
        method: API_METHODS.PATCH,
      }),
    }),
    getUnreadSimulationReviewCount: builder.query<{count: number}, void>({
      query: () => ({
        url: API_ROUTES.SIMULATION_REVIEWS.UNREAD_COUNT,
        method: API_METHODS.GET,
      }),
      providesTags: ['UnreadReviewCount'],
    }),
    getReviewById: builder.query<GetReviewByIdResponse, {reviewId: string}>({
      query: ({reviewId}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.REVIEW_BY_ID(reviewId),
        method: API_METHODS.GET,
      }),
      providesTags: ['ReviewDetails'],
      keepUnusedDataFor: 0,
    }),
    updateCommentVisibility: builder.mutation<
      {success: boolean},
      {commentId: string; hidden: boolean}
    >({
      query: ({commentId, hidden}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.UPDATE_COMMENT_VISIBILITY(commentId),
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      query: ({commentId, content}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.UPDATE_COMMENT(commentId),
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['ReviewThreads', 'GeneralComments'],
    }),
    deleteComment: builder.mutation<{success: boolean}, {commentId: string}>({
      query: ({commentId}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.DELETE_COMMENT(commentId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: [
        'ReviewThreads',
        'ReviewDetails',
        'Badges',
        'GeneralComments',
      ],
    }),
    getGeneralReviewComments: builder.query<
      GetThreadCommentsResponse,
      {reviewId: string; offset?: number; limit?: number}
    >({
      query: ({reviewId, offset, limit}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GET_GENERAL_REVIEW_COMMENTS(
          reviewId,
        ),
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
  useCreateReviewMutation,
  useGetReviewQuery,
  useUpdateReviewStatusMutation,
  useGetMessagesQuery,
  useLazyGetMessagesQuery,
  useAddReviewCommentMutation,
  useLazyGetThreadCommentsQuery,
  useGetReviewsQuery,
  useLazyGetReviewsQuery,
  useGetReviewByIdQuery,
  useUpdateCommentVisibilityMutation,
  useUpdateCommentMutation,
  useDeleteCommentMutation,
  useLazyGetGeneralReviewCommentsQuery,
  useGetGeneralReviewCommentsQuery,
  useMarkSimulationReviewAsReadMutation,
  useGetUnreadSimulationReviewCountQuery,
} = reviewsApi;
