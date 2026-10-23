import {createAsyncThunk, createSlice, PayloadAction} from '@reduxjs/toolkit';

import {AsyncStorageKeys} from '@/constants';
import {User} from '@/types';
import {removeItem, setItem} from '@/utils/asyncStorage';
import {Maybe} from '@/utils/common';

interface UserState {
  isAuthenticated: boolean;
  user: Maybe<User>;
  loading: boolean;
  permissions: string[];
}

const initialState: UserState = {
  isAuthenticated: false,
  user: null,
  loading: true, // Start with loading to check for existing tokens
  permissions: [],
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

export const handleLogout = createAsyncThunk(
  'user/handleLogout',
  async (_, {dispatch}) => {
    await removeItem(AsyncStorageKeys.ACCESS_TOKEN);
    await removeItem(AsyncStorageKeys.REFRESH_TOKEN);
    dispatch(setAuthenticated(false));
    dispatch(clearUser());
    dispatch(setPermissions([]));
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
    setPermissions: (state, action: PayloadAction<string[]>) => {
      state.permissions = action.payload ?? [];
    },
    clearUser: state => {
      state.user = null;
    },
  },
});

export const {
  setUser,
  setAuthenticated,
  clearUser,
  setLoading,
  setPermissions,
} = userSlice.actions;

export default userSlice.reducer;
