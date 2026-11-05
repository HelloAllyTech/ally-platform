import {API_METHODS, API_ROUTES, ViewedStatus} from '@/constants';
import {BadgesResponse, GetBadgesResponse} from '@/types';

import {api} from './api';

export const badgesApi = api.injectEndpoints({
  endpoints: builder => ({
    getAvailableBadges: builder.query<BadgesResponse, void>({
      query: () => ({
        url: API_ROUTES.BADGES.AVAILABLE,
        method: API_METHODS.GET,
      }),
      providesTags: ['Badges'],
    }),
    getBadges: builder.query<GetBadgesResponse, {viewedStatus: ViewedStatus}>({
      query: ({viewedStatus}) => ({
        url: API_ROUTES.BADGES.GET_BADGES,
        method: API_METHODS.GET,
        params: {
          viewedStatus,
        },
      }),
      providesTags: (result, error, {viewedStatus}) => [
        {type: 'Badges', id: `LIST-${viewedStatus}`},
      ],
    }),
    getBadgeCount: builder.query<{count: number}, {viewedStatus: ViewedStatus}>(
      {
        query: ({viewedStatus}) => ({
          url: API_ROUTES.BADGES.GET_BADGE_COUNT,
          method: API_METHODS.GET,
          params: {
            viewedStatus,
          },
        }),
        providesTags: ['Badges'],
      },
    ),
    markBadgeAsViewed: builder.mutation<void, string>({
      query: badgeId => ({
        url: API_ROUTES.BADGES.MARK_BADGE_AS_VIEWED(badgeId),
        method: API_METHODS.PATCH,
      }),
      invalidatesTags: [
        {type: 'Badges', id: `LIST-${ViewedStatus.UNVIEWED}`},
        {type: 'Badges', id: `LIST-${ViewedStatus.VIEWED}`},
        'Badges',
      ],
    }),
  }),
});

export const {
  useGetAvailableBadgesQuery,
  useGetBadgesQuery,
  useGetBadgeCountQuery,
  useMarkBadgeAsViewedMutation,
} = badgesApi;
