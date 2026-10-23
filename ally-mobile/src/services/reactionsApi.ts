import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export enum ReactionAction {
  ADD = 'ADD',
  REMOVE = 'REMOVE',
  UPDATE = 'UPDATE',
}

export interface ReactionUser {
  id: string | number;
  name: string;
  profileImage?: string | null;
}

export interface Reaction {
  reaction: string;
  createdBy: ReactionUser;
}

export interface ReactionsResponse {
  data: Reaction[];
  count: number;
}

export interface ReactionsParams {
  reviewId: string | number;
  reaction?: string;
  offset: number;
  limit: number;
}

export interface ReactionsCountResponse {
  reactions: {
    [reactionCode: string]: number;
  };
}

export interface AddReactionRequest {
  id: string;
  reaction: string;
  action: ReactionAction;
}

export const reactionsApi = api.injectEndpoints({
  endpoints: builder => ({
    getReactions: builder.query<ReactionsResponse, ReactionsParams>({
      query: ({reviewId, reaction, offset, limit}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.REACTIONS(reviewId),
        method: API_METHODS.GET,
        params: {
          ...(reaction && {reaction}),
          offset,
          limit,
        },
      }),
    }),
    getReactionsCount: builder.query<ReactionsCountResponse, string | number>({
      query: reviewId => ({
        url: API_ROUTES.SIMULATION_REVIEWS.REACTIONS_COUNT(reviewId),
        method: API_METHODS.GET,
      }),
    }),
    addReactionToComment: builder.mutation<void, AddReactionRequest>({
      query: ({id, reaction, action}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.ADD_REACTION_TO_COMMENT(id),
        method: API_METHODS.POST,
        body: {reaction, action},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    addReactionToReview: builder.mutation<void, AddReactionRequest>({
      query: ({id, reaction, action}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.ADD_REACTION_TO_REVIEW(id),
        method: API_METHODS.POST,
        body: {reaction, action},
      }),
      invalidatesTags: ['Badges'],
    }),
  }),
});

export const {
  useLazyGetReactionsQuery,
  useLazyGetReactionsCountQuery,
  useAddReactionToCommentMutation,
  useAddReactionToReviewMutation,
} = reactionsApi;
