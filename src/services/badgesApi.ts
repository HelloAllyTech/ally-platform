import {API_METHODS, API_ROUTES} from '@/constants';
import {BadgesResponse} from '@/types';

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
  }),
});

export const {useGetAvailableBadgesQuery} = badgesApi;
