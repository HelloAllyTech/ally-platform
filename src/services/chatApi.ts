import {Chat, ChatStatus, FeedbackResponse} from '@/types/message';

import {api} from './api';

interface EndCallResponse {
  id: number;
  clientId: number;
  counselorId: number;
  roomId: number;
  status: ChatStatus;
  tenantId: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackInput {
  rating?: number;
}

interface UpdateNotesInput {
  content: string;
}

export const chatApi = api.injectEndpoints({
  endpoints: builder => ({
    getCounsellorChat: builder.query<[] | Chat, void>({
      query: () => '/chats/counsellor-chat',
    }),
    endCall: builder.mutation<EndCallResponse, {chatId: number}>({
      query: ({chatId}) => ({
        url: `/chats/${chatId}/end`,
        method: 'POST',
      }),
    }),
    addFeedback: builder.mutation<
      FeedbackResponse,
      {id: number; feedback: FeedbackInput}
    >({
      query: ({id, feedback}) => ({
        url: `chats/messages/${id}/feedback`,
        method: 'POST',
        body: feedback,
      }),
    }),
    updateFeedback: builder.mutation<
      FeedbackResponse,
      {feedbackId: number; feedback: FeedbackInput}
    >({
      query: ({feedbackId, feedback}) => ({
        url: `chats/messages/feedback/${feedbackId}`,
        method: 'PATCH',
        body: feedback,
      }),
    }),
    updateNotes: builder.mutation<
      void,
      {chatId: number; notes: UpdateNotesInput}
    >({
      query: ({chatId, notes}) => ({
        url: `/chats/${chatId}/notes`,
        method: 'POST',
        body: notes,
      }),
    }),
  }),
});

export const {
  useLazyGetCounsellorChatQuery,
  useEndCallMutation,
  useAddFeedbackMutation,
  useUpdateFeedbackMutation,
  useUpdateNotesMutation,
} = chatApi;
