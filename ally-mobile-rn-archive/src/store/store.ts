import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {setupListeners} from '@reduxjs/toolkit/query';

import {api} from '@/services/api';

import chatReducer from './slices/chatSlice';
import creditsReducer from './slices/creditsSlice';
import summaryReducer from './slices/summarySlice';
import userReducer from './slices/userSlice';

const rootReducer = combineReducers({
  user: userReducer,
  chat: chatReducer,
  summary: summaryReducer,
  credits: creditsReducer,
  [api.reducerPath]: api.reducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware().concat(api.middleware),
});

setupListeners(store.dispatch);

export type AppRootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
