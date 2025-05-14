import {createSlice, PayloadAction} from '@reduxjs/toolkit';

import {Chat} from '@/types/message';

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
    clearCurrentChat: state => {
      state.currentChat = null;
    },
  },
});

export const {setCurrentChat, clearCurrentChat} = chatSlice.actions;
export default chatSlice.reducer;
