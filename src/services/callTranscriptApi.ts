import {api} from './api';

export interface ChatMessage {
  id: number;
  chatId: number;
  content: string;
  context: string | null;
  createdAt: string;
  feedback: string | null;
  metadata: string | null;
  parentMessageId: number | null;
  senderId: number;
  tenantId: string;
  type: string;
  updatedAt: string;
}

type ChatMessagesResponse = ChatMessage[];

interface ChatMessagesParams {
  id: string;
  limit?: number;
  offset?: number;
}

export const callTranscriptApi = api.injectEndpoints({
  endpoints: builder => ({
    getChatMessages: builder.query<ChatMessagesResponse, ChatMessagesParams>({
      query: ({id, limit = 50, offset = 0}) => ({
        url: `/chats/${id}/messages`,
        method: 'GET',
        params: {
          limit,
          offset,
        },
      }),
    }),
  }),
});

export const {useLazyGetChatMessagesQuery} = callTranscriptApi;
