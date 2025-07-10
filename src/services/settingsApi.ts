import {SummaryFieldKey} from '@/constants/summary';

import {api} from './api';

export const settingsApi = api.injectEndpoints({
  endpoints: builder => ({
    getSummaryFields: builder.query<SummaryFieldKey[], void>({
      query: () => '/settings/summary-fields',
    }),
    getNudgeStatus: builder.query<boolean, void>({
      query: () => '/settings/nudge-status',
    }),
  }),
});

export const {useGetSummaryFieldsQuery, useGetNudgeStatusQuery} = settingsApi;
