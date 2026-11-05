import {API_ROUTES} from '@/constants';
import {AnalyticsType} from '@/constants/analytics';

import {api} from './api';

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
    getDashboards: builder.query<Dashboard[], void>({
      query: () => API_ROUTES.ANALYTICS.DASHBOARD,
    }),
    getDashboardUrl: builder.query<DashboardUrlResponse, {dashboardId: string}>(
      {
        query: ({dashboardId}) =>
          API_ROUTES.ANALYTICS.DASHBOARD_BY_ID(dashboardId),
      },
    ),
  }),
});

export const {useGetDashboardsQuery, useLazyGetDashboardUrlQuery} =
  analyticsApi;
