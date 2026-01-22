import {
  BaseQueryFn,
  createApi,
  FetchArgs,
  fetchBaseQuery,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

import {env} from '@/config/env';
import {
  API_METHODS,
  API_ROUTES,
  APIVersion,
  AsyncStorageKeys,
} from '@/constants';
import {handleLogout, storeTokens} from '@/store/slices/userSlice';
import {store} from '@/store/store';
import {getItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

import {AuthResponse} from './authApi';

const V2_ENDPOINTS = [
  API_ROUTES.AUTH.GENERATE_OTP,
  API_ROUTES.AUTH.VERIFY_OTP,
  API_ROUTES.LEARN.SCENARIOS,
];

const baseQuery: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let url: string;
  let version = APIVersion.V1;

  if (typeof args === 'string') {
    url = args;
  } else {
    url = args.url;
    // Check if this endpoint should use v2
    if (V2_ENDPOINTS.some(v2Endpoint => url === v2Endpoint)) {
      version = APIVersion.V2;
    }
  }

  const versionedArgs =
    typeof args === 'string'
      ? `${version}${args}`
      : {...args, url: `${version}${url}`};

  const originalBaseQuery = fetchBaseQuery({
    baseUrl: env.API_BASE_URL + '/api/',
    prepareHeaders: async (headers, {endpoint: _endpoint}) => {
      const token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  });

  return originalBaseQuery(versionedArgs, api, extraOptions);
};

const handleUserLogout = async () => {
  await store.dispatch(handleLogout());
  store.dispatch({type: 'api/resetApiState'});
};

const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, _store, extraOptions) => {
  try {
    let result = await baseQuery(args, _store, extraOptions);
    if (result.error && result.error.status === 401) {
      // Try to get a new token
      const accessToken = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
      const refreshToken = await getItem<string>(
        AsyncStorageKeys.REFRESH_TOKEN,
      );

      // If there is no access token or refresh token, logout user
      if (!accessToken || !refreshToken) {
        handleUserLogout();
        return result;
      }

      try {
        const refreshResult = await baseQuery(
          {
            url: API_ROUTES.AUTH.REFRESH,
            method: API_METHODS.POST,
            body: {refreshToken},
          },
          _store,
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
          result = await baseQuery(args, _store, extraOptions);
        } else {
          handleUserLogout();
        }
      } catch (error) {
        logger.error(`Error refreshing token: ${error}`);
        handleUserLogout();
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
  tagTypes: [
    'SimulationCredits',
    'SimulationPaths',
    'SimulationPathDetails',
    'User',
    'Badges',
    'UserPreferences',
  ],
  endpoints: () => ({}),
});
