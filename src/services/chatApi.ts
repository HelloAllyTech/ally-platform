import {API_METHODS, API_ROUTES} from '@/constants';
import {Chat, ChatStatus, FeedbackResponse} from '@/types';

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
      query: () => API_ROUTES.CHATS.COUNSELLOR_CHAT,
    }),
    endCall: builder.mutation<EndCallResponse, {chatId: number}>({
      query: ({chatId}) => ({
        url: API_ROUTES.CHATS.END(chatId),
        method: API_METHODS.POST,
      }),
    }),
    addFeedback: builder.mutation<
      FeedbackResponse,
      {id: number; feedback: FeedbackInput}
    >({
      query: ({id, feedback}) => ({
        url: API_ROUTES.CHATS.MESSAGES_FEEDBACK(id),
        method: API_METHODS.POST,
        body: feedback,
      }),
    }),
    updateFeedback: builder.mutation<
      FeedbackResponse,
      {feedbackId: number; feedback: FeedbackInput}
    >({
      query: ({feedbackId, feedback}) => ({
        url: API_ROUTES.CHATS.MESSAGES_FEEDBACK_BY_ID(feedbackId),
        method: API_METHODS.PATCH,
        body: feedback,
      }),
    }),
    updateNotes: builder.mutation<
      void,
      {chatId: number; notes: UpdateNotesInput}
    >({
      query: ({chatId, notes}) => ({
        url: API_ROUTES.CHATS.NOTES(chatId),
        method: API_METHODS.POST,
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
