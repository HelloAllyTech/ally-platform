import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  GetThreadCommentsRequest,
  GetThreadCommentsResponse,
  ReviewsResponse,
} from '@/types/reviews';

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
        comment,
      }) => ({
        url: API_ROUTES.REVIEWS.ADD_REVIEW_COMMENT(reviewId),
        method: API_METHODS.POST,
        body: {
          threadId,
          parentCommentId,
          messageId,
          selection,
          comment,
        },
      }),
    }),
    getMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit}) => {
        return {
          url: API_ROUTES.REVIEWS.GET_MESSAGES(reviewId),
          method: API_METHODS.GET,
          body: {offset, limit},
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
            ? {body: {offset, limit}}
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
  }),
});

export const {
  useGetMessagesQuery,
  useAddReviewCommentMutation,
  useGetThreadCommentsQuery,
  useLazyGetReviewsQuery,
} = reviewsApi;
