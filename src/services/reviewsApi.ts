import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';

import {api} from './api';

export enum ReviewFilter {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

export interface ReviewScenario {
  title: string;
  createdAt: string;
  duration: string;
  description: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
}

export interface User {
  id: string;
  name: string;
  profileImage: string;
}

export interface ReviewItem {
  id: string;
  createdAt: string;
  scenario: ReviewScenario;
  reactions: {
    [reaction_code: string]: number;
  };
  createdBy: User;
  commentsCount: number;
}

export interface ReviewResponse {
  data: ReviewItem[];
  count: number;
}

export const reviewsApi = api.injectEndpoints({
  endpoints: builder => ({
    getReviews: builder.query<
      ReviewResponse | null,
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

export const {useLazyGetReviewsQuery, useGetReviewsQuery} = reviewsApi;
