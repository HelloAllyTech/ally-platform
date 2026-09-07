import {createSlice, PayloadAction} from '@reduxjs/toolkit';

import {Chat} from '@/types';

interface ChatState {
  currentChat: Chat | null;
}

const initialState: ChatState = {
  currentChat: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setCurrentChat: (state, action: PayloadAction<Chat>) => {
      state.currentChat = action.payload;
    },
    /**
     * Records the chat id on its own, ahead of the full chat.
     *
     * The server tells us the id directly in the USER_JOINED payload the moment
     * it creates the chat. Everything else — participants, messages, startedAt —
     * only arrives via GET /chats/counsellor-chat, and the recording screen does
     * not need any of it to stop saying "Connecting…"; it needs the id. Taking
     * the id from the event means a slow, raced or empty refetch can no longer
     * strand a session that the server has already started.
     *
     * Merges rather than replaces, so a full chat that arrives later wins and an
     * id that arrives first is not thrown away.
     */
    setCurrentChatId: (state, action: PayloadAction<number>) => {
      if (state.currentChat) {
        state.currentChat.chatId = action.payload;
        return;
      }
      state.currentChat = {chatId: action.payload} as Chat;
    },
    clearCurrentChat: state => {
      state.currentChat = null;
    },
  },
});

export const {setCurrentChat, setCurrentChatId, clearCurrentChat} =
  chatSlice.actions;
export default chatSlice.reducer;
