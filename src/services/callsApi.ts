import {api} from './api';

export const callsAPI = api.injectEndpoints({
  endpoints: builder => ({
    getCallLogs: builder.query({
      query: ({limit, offset}) => ({
        url: '/chats/call-logs',
        params: {limit, offset},
      }),
    }),
  }),
});

export const {useGetCallLogsQuery, useLazyGetCallLogsQuery} = callsAPI;
