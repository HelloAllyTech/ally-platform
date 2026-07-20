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

/** Built-in column filters + the custom/default-field filter param. */
export interface GetCallLogsArgs {
  limit: number;
  offset: number;
  archive: boolean;
  /** JSON-encoded array of custom/default-field filters. */
  fieldFilters?: string;
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  maxDuration?: number;
  tags?: string;
  mode?: string;
  status?: string;
  source?: string;
}

interface TagsResponse {
  data: string[];
  count: number;
}

export const callsAPI = api.injectEndpoints({
  endpoints: builder => ({
    getCallLogs: builder.query<CallLogsResponse, GetCallLogsArgs>({
      query: ({limit, offset, archive, ...filters}) => ({
        url: API_ROUTES.CHATS.CALL_LOGS,
        params: {
          limit,
          offset,
          archive,
          // Drop undefined filter values so requests stay identical to the
          // pre-filter behaviour when nothing is selected.
          ...Object.fromEntries(
            Object.entries(filters).filter(
              ([, v]) => v !== undefined && v !== '',
            ),
          ),
        },
      }),
    }),
    getCallTags: builder.query<TagsResponse, void>({
      query: () => ({url: API_ROUTES.CHATS.TAGS, params: {offset: 0}}),
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
  useGetCallTagsQuery,
  useArchiveCallLogMutation,
} = callsAPI;
