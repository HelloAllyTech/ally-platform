import {SummaryFieldKey} from '@/constants/summary';

import {api} from './api';

export const settingsApi = api.injectEndpoints({
  endpoints: builder => ({
    getSummaryFields: builder.query<SummaryFieldKey[], void>({
      query: () => '/settings/summary-fields',
    }),
  }),
});

export const {useGetSummaryFieldsQuery} = settingsApi;
