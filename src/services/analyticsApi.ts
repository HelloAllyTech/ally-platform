import {api} from './api';

interface Dashboard {
  externalId: string;
  name: string;
  description?: string;
}

interface DashboardUrlResponse {
  url: string;
}

export const analyticsApi = api.injectEndpoints({
  endpoints: builder => ({
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

export const {useGetDashboardsQuery, useLazyGetDashboardUrlQuery} =
  analyticsApi;
