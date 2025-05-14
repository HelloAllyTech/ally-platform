import {Chat} from '@/types/message';

import {api} from './api';

export const chatApi = api.injectEndpoints({
  endpoints: builder => ({
    getCounsellorChat: builder.query<Chat, void>({
      query: () => '/chats/counsellor-chat',
    }),
  }),
});

export const {useLazyGetCounsellorChatQuery} = chatApi;
