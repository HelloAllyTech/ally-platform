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

// TODO_M: Remove once dependent changes are merged
export enum ReviewFilter {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

export const reviewsApi = api.injectEndpoints({
  endpoints: builder => ({
    createReview: builder.mutation<CreateReviewResponse, CreateReviewRequest>({
      query: body => ({
        url: API_ROUTES.REVIEWS.CREATE_REVIEW,
        method: API_METHODS.POST,
        body,
      }),
    }),
    getReview: builder.query<GetReviewResponse, {reviewId: string}>({
      query: ({reviewId}) => ({
        url: API_ROUTES.REVIEWS.GET_REVIEW(reviewId),
        method: API_METHODS.GET,
      }),
    }),
    updateReviewStatus: builder.mutation<
      UpdateReviewStatusResponse,
      {reviewId: string; status: UpdateReviewStatusRequest}
    >({
      query: ({reviewId, status}) => ({
        url: API_ROUTES.REVIEWS.UPDATE_REVIEW_STATUS(reviewId),
        method: API_METHODS.PATCH,
        body: status,
      }),
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
        url: API_ROUTES.REVIEWS.ADD_REVIEW_COMMENT(reviewId),
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
    getMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit, sortOrder, sortBy}) => {
        return {
          url: API_ROUTES.REVIEWS.GET_MESSAGES(reviewId),
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
          url: API_ROUTES.REVIEWS.GET_THREAD_COMMENTS(threadId),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {params: {offset, limit}}
            : {}),
        };
      },
    }),
    getReviews: builder.query<
      ReviewsResponse | null,
      {sortBy: string; limit: number; offset: number}
    >({
      query: ({sortBy, limit, offset}) => ({
        url: API_ROUTES.REVIEWS.REVIEWS,
        method: API_METHODS.GET,
        params: {sortBy, limit, offset, order: SortOrder.DESC},
      }),
    }),
    getReviewById: builder.query<GetReviewByIdResponse, {reviewId: string}>({
      query: ({reviewId}) => ({
        url: API_ROUTES.REVIEWS.REVIEW_BY_ID(reviewId),
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
        url: API_ROUTES.REVIEWS.UPDATE_COMMENT_VISIBILITY(commentId),
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
    }),
    updateComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      query: ({commentId, content}) => ({
        url: API_ROUTES.REVIEWS.UPDATE_COMMENT(commentId),
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['ReviewThreads'],
    }),
    deleteComment: builder.mutation<{success: boolean}, {commentId: string}>({
      query: ({commentId}) => ({
        url: API_ROUTES.REVIEWS.DELETE_COMMENT(commentId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: ['ReviewThreads'],
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
} = reviewsApi;
