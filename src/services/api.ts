import {
  BaseQueryFn,
  createApi,
  FetchArgs,
  fetchBaseQuery,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

import {env} from '@/config/env';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {clearTokens, storeTokens} from '@/store/slices/userSlice';
import {getItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

import {AuthResponse} from './authApi';

const baseQuery = fetchBaseQuery({
  baseUrl: env.API_BASE_URL + '/api/' + env.API_VERSION,
  prepareHeaders: async headers => {
    // Get token directly from AsyncStorage
    const token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, store, extraOptions) => {
  try {
    let result = await baseQuery(args, store, extraOptions);
    if (result.error && result.error.status === 401) {
      // Try to get a new token
      const accessToken = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
      const refreshToken = await getItem<string>(
        AsyncStorageKeys.REFRESH_TOKEN,
      );

      // If there is no access token or refresh token, return the error
      if (!accessToken || !refreshToken) {
        store.dispatch(clearTokens());
        return result;
      }

      try {
        const refreshResult = await baseQuery(
          {
            url: '/auth/refresh',
            method: 'POST',
            body: {refreshToken},
          },
          store,
          extraOptions,
        );

        if (!refreshResult.data) {
          throw new Error('No refresh data received');
        }

        const tokens = refreshResult.data as AuthResponse;

        if (tokens) {
          // Store the new tokens
          store.dispatch(
            storeTokens({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            }),
          );

          // Retry the original query with new access token
          result = await baseQuery(args, store, extraOptions);
        } else {
          store.dispatch(clearTokens());
        }
      } catch (error) {
        logger.error(`Error refreshing token: ${error}`);
        store.dispatch(clearTokens());
        return result;
      }
    }

    return result;
  } catch (err) {
    logger.error(`Error in baseQueryWithReauth: ${err}`);
    return {error: {status: 401, data: {message: 'Unauthorized'}}};
  }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  endpoints: () => ({}),
});
