import {API_ROUTES, CHAT_TYPES, SummaryFieldKey} from '@/constants';
import {setSummaryVisibleFields} from '@/store/slices/summarySlice';

import {api} from './api';

export const settingsApi = api.injectEndpoints({
  endpoints: builder => {
    return {
      getSummaryFields: builder.query<SummaryFieldKey[], void>({
        query: () => API_ROUTES.SETTINGS.SUMMARY_FIELDS,
        async onQueryStarted(_, {dispatch, queryFulfilled}) {
          const {data} = await queryFulfilled;
          if (data && Array.isArray(data)) {
            dispatch(setSummaryVisibleFields(data));
          }
        },
      }),
      getNudgeStatus: builder.query<boolean, void>({
        query: () => API_ROUTES.SETTINGS.NUDGE_STATUS,
      }),
      getVisibleChatTypes: builder.query<CHAT_TYPES[], void>({
        query: () => API_ROUTES.SETTINGS.CHAT_TYPES,
      }),
    };
  },
});

export const {
  useLazyGetSummaryFieldsQuery,
  useGetNudgeStatusQuery,
  useLazyGetVisibleChatTypesQuery,
} = settingsApi;
