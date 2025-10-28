import {API_ROUTES} from '@/constants';
import {CallLog} from '@/screens/CallLog/types';

import {api} from './api';

export interface CallLogsResponse {
  data: CallLog[];
  count: number;
}

export const callsAPI = api.injectEndpoints({
  endpoints: builder => ({
    getCallLogs: builder.query<
      CallLogsResponse,
      {limit: number; offset: number}
    >({
      query: ({limit, offset}) => ({
        url: API_ROUTES.CHATS.CALL_LOGS,
        params: {limit, offset},
      }),
    }),
  }),
});

export const {useGetCallLogsQuery, useLazyGetCallLogsQuery} = callsAPI;
