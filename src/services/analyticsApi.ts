import {API_METHODS} from '@/constants';
import {AnalyticsType} from '@/constants/analytics';

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

export interface Dashboard {
  externalId: string;
  name: string;
  description?: string;
  analyticsType?: AnalyticsType;
}

interface DashboardUrlResponse {
  url: string;
}

export const analyticsApi = api.injectEndpoints({
  endpoints: builder => ({
    getCounselorStats: builder.query<CounselorStats, AnalyticsRequestParams>({
      query: params => ({
        url: 'analytics/counselor-stats',
        method: API_METHODS.GET,
        params,
      }),
    }),
    getDashboards: builder.query<Dashboard[], void>({
      query: () => 'analytics/dashboard',
    }),
    getDashboardUrl: builder.query<DashboardUrlResponse, {dashboardId: string}>(
      {
        query: ({dashboardId}) => `/analytics/dashboard/${dashboardId}`,
      },
    ),
  }),
});

export const {
  useGetCounselorStatsQuery,
  useGetDashboardsQuery,
  useLazyGetDashboardUrlQuery,
} = analyticsApi;
