import {API_ROUTES, CHAT_TYPES, SummaryFieldKey} from '@/constants';

import {api} from './api';

export const settingsApi = api.injectEndpoints({
  endpoints: builder => ({
    getSummaryFields: builder.query<SummaryFieldKey[], void>({
      query: () => API_ROUTES.SETTINGS.SUMMARY_FIELDS,
    }),
    getNudgeStatus: builder.query<boolean, void>({
      query: () => API_ROUTES.SETTINGS.NUDGE_STATUS,
    }),
    getVisibleChatTypes: builder.query<CHAT_TYPES[], void>({
      query: () => API_ROUTES.SETTINGS.CHAT_TYPES,
    }),
  }),
});

export const {
  useLazyGetSummaryFieldsQuery,
  useGetNudgeStatusQuery,
  useLazyGetVisibleChatTypesQuery,
} = settingsApi;
