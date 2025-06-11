import {api} from './api';

export interface CounselorStats {
  counselorListeningDuration?: number;
  counselorName: string;
  counselorSharingDuration?: number;
  counselorSharingPercentage?: number;
}

export interface AnalyticsRequestParams {
  startDate?: string;
  endDate?: string;
}

export const analyticsApi = api.injectEndpoints({
  endpoints: builder => ({
    getCounselorStats: builder.query<CounselorStats, AnalyticsRequestParams>({
      query: params => ({
        url: 'analytics/counselor-stats',
        method: 'GET',
        params,
      }),
    }),
  }),
});

export const {useGetCounselorStatsQuery} = analyticsApi;
