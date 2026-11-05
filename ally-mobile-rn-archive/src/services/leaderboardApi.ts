import {API_METHODS, API_ROUTES, SortOrder} from '@/constants';
import {
  LeaderboardQueryParams,
  LeaderboardResponse,
  MyRankResponse,
} from '@/types/leaderboard';

import {api} from './api';

export const leaderboardApi = api.injectEndpoints({
  overrideExisting: true,
  endpoints: builder => ({
    getLeaderboard: builder.query<LeaderboardResponse, LeaderboardQueryParams>({
      query: ({
        window,
        limit = 50,
        offset = 0,
        sortBy = 'score',
        order = SortOrder.DESC,
      }) => ({
        url: API_ROUTES.COMMUNITY.LEADERBOARD,
        method: API_METHODS.GET,
        params: {
          window,
          limit,
          offset,
          sortBy,
          order,
        },
      }),
    }),
    getMyRank: builder.query<MyRankResponse, {window: string}>({
      query: ({window}) => ({
        url: API_ROUTES.COMMUNITY.MY_RANK,
        method: API_METHODS.GET,
        params: {
          window,
        },
      }),
    }),
  }),
});

export const {useGetLeaderboardQuery, useGetMyRankQuery} = leaderboardApi;
