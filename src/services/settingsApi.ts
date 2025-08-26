import {CHAT_TYPES, SummaryFieldKey} from '@/constants';

import {api} from './api';

export const settingsApi = api.injectEndpoints({
  endpoints: builder => ({
    getSummaryFields: builder.query<SummaryFieldKey[], void>({
      query: () => '/settings/summary-fields',
    }),
    getNudgeStatus: builder.query<boolean, void>({
      query: () => '/settings/nudge-status',
    }),
    getVisibleChatTypes: builder.query<CHAT_TYPES[], void>({
      query: () => '/settings/chat-types',
    }),
  }),
});

export const {
  useGetSummaryFieldsQuery,
  useGetNudgeStatusQuery,
  useGetVisibleChatTypesQuery,
} = settingsApi;
