import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface ChatMessage {
  messageId: number;
  chatId: number;
  content: string;
  context: string | null;
  createdAt: string;
  feedback: string | null;
  senderId: number;
  startSeconds: number | null;
}

type ChatMessagesResponse = {
  data: ChatMessage[];
  count: number;
};

interface ChatMessagesParams {
  id: number;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: string;
  type?: string;
}

export const callTranscriptApi = api.injectEndpoints({
  endpoints: builder => ({
    getChatMessages: builder.query<ChatMessagesResponse, ChatMessagesParams>({
      query: ({id, limit, offset, sortBy, sortOrder, type}) => ({
        url: API_ROUTES.CHATS.MESSAGES(id),
        method: API_METHODS.GET,
        params: {
          limit,
          offset,
          sortBy,
          sortOrder,
          type,
        },
      }),
    }),
  }),
});

export const {useLazyGetChatMessagesQuery} = callTranscriptApi;
