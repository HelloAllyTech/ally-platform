import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';
import {
  AddReactionRequest,
  ReactionsCountResponse,
  ReactionsParams,
  ReactionsResponse,
} from './reactionsApi';

export const scribeReactionsApi = api.injectEndpoints({
  endpoints: builder => ({
    getScribeReactions: builder.query<ReactionsResponse, ReactionsParams>({
      query: ({reviewId, reaction, offset, limit}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.REACTIONS(reviewId),
        method: API_METHODS.GET,
        params: {
          ...(reaction && {reaction}),
          offset,
          limit,
        },
      }),
    }),
    getScribeReactionsCount: builder.query<
      ReactionsCountResponse,
      string | number
    >({
      query: reviewId => ({
        url: API_ROUTES.SCRIBE_REVIEWS.REACTIONS_COUNT(reviewId),
        method: API_METHODS.GET,
      }),
    }),
    addScribeReactionToComment: builder.mutation<void, AddReactionRequest>({
      query: ({id, reaction, action}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.ADD_REACTION_TO_COMMENT(id),
        method: API_METHODS.POST,
        body: {reaction, action},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    addScribeReactionToReview: builder.mutation<void, AddReactionRequest>({
      query: ({id, reaction, action}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.ADD_REACTION_TO_REVIEW(id),
        method: API_METHODS.POST,
        body: {reaction, action},
      }),
      invalidatesTags: ['Badges'],
    }),
  }),
});

export const {
  useLazyGetScribeReactionsQuery,
  useLazyGetScribeReactionsCountQuery,
  useAddScribeReactionToCommentMutation,
  useAddScribeReactionToReviewMutation,
} = scribeReactionsApi;
