import {API_METHODS, API_ROUTES} from '@/constants';
import {CallLog} from '@/screens/CallLog/types';

import {api} from './api';

export interface CallLogsResponse {
  data: CallLog[];
  count: number;
}

interface ArchiveCallLogsRequest {
  callLogId: number;
  archive: boolean;
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
    getArchivedCallLogs: builder.query<
      CallLogsResponse,
      {limit: number; offset: number}
    >({
      query: ({limit, offset}) => ({
        url: API_ROUTES.CHATS.GET_ARCHIVED_CALL_LOGS,
        params: {limit, offset},
      }),
    }),
    archiveCallLog: builder.mutation<void, ArchiveCallLogsRequest>({
      query: ({callLogId, archive}) => ({
        url: API_ROUTES.CHATS.ARCHIVE_CALL_LOG(callLogId),
        method: API_METHODS.PATCH,
        body: {archive},
      }),
    }),
  }),
});

export const {
  useGetCallLogsQuery,
  useLazyGetCallLogsQuery,
  useArchiveCallLogMutation,
  useLazyGetArchivedCallLogsQuery,
  useGetArchivedCallLogsQuery,
} = callsAPI;
