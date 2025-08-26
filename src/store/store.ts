import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {setupListeners} from '@reduxjs/toolkit/query';

import {api, learnApi} from '@/services/api';

import chatReducer from './slices/chatSlice';
import summaryReducer from './slices/summarySlice';
import userReducer from './slices/userSlice';

const rootReducer = combineReducers({
  user: userReducer,
  chat: chatReducer,
  summary: summaryReducer,
  [api.reducerPath]: api.reducer,
  // TODO [Simulations]: Remove this once backend changes to merge both APIs are done
  [learnApi.reducerPath]: learnApi.reducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    // TODO [Simulations]: Remove this once backend changes to merge both APIs are done
    getDefaultMiddleware().concat(api.middleware, learnApi.middleware),
});

setupListeners(store.dispatch);

export type AppRootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
