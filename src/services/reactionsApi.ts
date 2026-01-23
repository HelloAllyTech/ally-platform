import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

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

export const reactionsApi = api.injectEndpoints({
  endpoints: builder => ({
    getReactions: builder.query<ReactionsResponse, ReactionsParams>({
      query: ({reviewId, reaction, offset, limit}) => ({
        url: API_ROUTES.REVIEWS.REACTIONS(reviewId),
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
        url: API_ROUTES.REVIEWS.REACTIONS_COUNT(reviewId),
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {useLazyGetReactionsQuery, useLazyGetReactionsCountQuery} =
  reactionsApi;
