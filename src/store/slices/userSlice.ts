import {createAsyncThunk, createSlice, PayloadAction} from '@reduxjs/toolkit';

import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {User} from '@/types/user';
import {removeItem, setItem} from '@/utils/asyncStorage';
import {Maybe} from '@/utils/common';

interface UserState {
  isAuthenticated: boolean;
  user: Maybe<User>;
  loading: boolean;
}

const initialState: UserState = {
  isAuthenticated: false,
  user: null,
  loading: true, // Start with loading to check for existing tokens
};

export const storeTokens = createAsyncThunk(
  'user/storeTokens',
  async ({
    accessToken,
    refreshToken,
  }: {
    accessToken: string;
    refreshToken: string;
  }) => {
    await setItem(AsyncStorageKeys.ACCESS_TOKEN, accessToken);
    await setItem(AsyncStorageKeys.REFRESH_TOKEN, refreshToken);
  },
);

export const clearTokens = createAsyncThunk(
  'user/clearTokens',
  async (_, {dispatch}) => {
    await removeItem(AsyncStorageKeys.ACCESS_TOKEN);
    await removeItem(AsyncStorageKeys.REFRESH_TOKEN);
    dispatch(setAuthenticated(false));
  },
);

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.isAuthenticated = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setUser: (state, action: PayloadAction<Maybe<User>>) => {
      state.user = action.payload;
    },
  },
});

export const {setAuthenticated, setLoading, setUser} = userSlice.actions;

export default userSlice.reducer;
