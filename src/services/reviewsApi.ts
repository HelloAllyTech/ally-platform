import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  CreateReviewRequest,
  CreateReviewResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  GetReviewByIdResponse,
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
    }),
    getMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit}) => {
        return {
          url: API_ROUTES.REVIEWS.GET_MESSAGES(reviewId),
          method: API_METHODS.GET,
          params: {offset, limit},
        };
      },
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
    }),
  }),
});

export const {
  useCreateReviewMutation,
  useUpdateReviewStatusMutation,
  useGetMessagesQuery,
  useAddReviewCommentMutation,
  useLazyGetThreadCommentsQuery,
  useGetReviewsQuery,
  useLazyGetReviewsQuery,
  useGetReviewByIdQuery,
} = reviewsApi;
