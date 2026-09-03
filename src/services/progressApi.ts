import {API_METHODS, API_ROUTES} from '@/constants';
import {ProgressResponse, ProgressSummary} from '@/types';

import {api} from './api';

export const progressApi = api.injectEndpoints({
  endpoints: builder => ({
    /**
     * Level state without the dashboard payload.
     *
     * Takes no argument (`void`) on purpose: RTK Query keys the cache by
     * (endpoint, serialized args), so the header widget and the Progress screen share one
     * cache entry and one in-flight request. A widget rendered on every screen would
     * otherwise fire its own query per screen.
     */
    getProgressSummary: builder.query<ProgressSummary, void>({
      query: () => ({
        url: API_ROUTES.PROGRESS.GET_PROGRESS_SUMMARY,
        method: API_METHODS.GET,
      }),
      providesTags: ['Progress'],
    }),

    getProgress: builder.query<ProgressResponse, void>({
      query: () => ({
        url: API_ROUTES.PROGRESS.GET_PROGRESS,
        method: API_METHODS.GET,
      }),
      providesTags: ['Progress'],
    }),

    /** Own-org toggle. Any authenticated user may read it; no permission required. */
    getProgressEnabled: builder.query<boolean, void>({
      query: () => ({
        url: API_ROUTES.PROGRESS.GET_PROGRESS_ENABLED,
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {
  useGetProgressQuery,
  useGetProgressSummaryQuery,
  useGetProgressEnabledQuery,
} = progressApi;
