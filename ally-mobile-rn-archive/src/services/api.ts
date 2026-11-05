import {
  BaseQueryFn,
  createApi,
  FetchArgs,
  fetchBaseQuery,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

// Import the imperative bridge module directly (not `ToastProvider`, and
// not the `@/components` barrel): those pull in `@/hooks`/`@/utils/error`,
// which transitively import components that call RTK Query hooks from
// `@/services`, creating a circular import back to this very file. See
// `toastBridge.ts` for the full rationale.
import {showToast} from '@/components/Toast/toastBridge';
import {env} from '@/config/env';
import {
  API_METHODS,
  API_ROUTES,
  APIVersion,
  AsyncStorageKeys,
} from '@/constants';
import i18n from '@/localization/i18n';
import {handleLogout, storeTokens} from '@/store/slices/userSlice';
import {store} from '@/store/store';
import {getItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

import {AuthResponse} from './authApi';
import {LANGUAGE_CODE_ENDPOINTS} from './languageCodeEndpoints';

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

  // Inject the active UI language into content endpoints so the backend returns
  // localized text. Gated by an allowlist (see `languageCodeEndpoints.ts`).
  // Spreading the caller's params/body last lets a call site override it.
  // Backend expects a bare ISO code (e.g. `hi`) → `resolvedLanguage`.
  let injectedArgs = versionedArgs;
  if (
    typeof injectedArgs !== 'string' &&
    LANGUAGE_CODE_ENDPOINTS.has(api.endpoint)
  ) {
    const languageCode = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const isGet = (injectedArgs.method ?? 'GET').toUpperCase() === 'GET';
    if (isGet) {
      injectedArgs = {
        ...injectedArgs,
        params: {languageCode, ...injectedArgs.params},
      };
    } else {
      injectedArgs = {
        ...injectedArgs,
        body: {languageCode, ...(injectedArgs.body as object)},
      };
    }
  }

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

  return originalBaseQuery(injectedArgs, api, extraOptions);
};

const handleUserLogout = async () => {
  await store.dispatch(handleLogout());
  store.dispatch({type: 'api/resetApiState'});
  // The navigator swaps to the auth stack the moment `isAuthenticated` flips
  // (see RootNavigator), which silently drops whatever screen-local state
  // the learner/counsellor had. Without this, landing back on the login
  // screen looks like the app just lost their place — say why, honestly,
  // rather than leaving it unexplained. `ToastProvider` is mounted above
  // the navigator in App.tsx, so the toast survives the stack swap.
  showToast(i18n.t('auth.sessionExpired'), 'error');
};

const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, _store, extraOptions) => {
  try {
    let result = await baseQuery(args, _store, extraOptions);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        ':rocket: ~ baseQueryWithReauth ~ result:',
        (args as FetchArgs)?.url,
        args,
        result,
      );
    }
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
    'LearnerDebrief',
    'SimulationCredits',
    'SimulationPaths',
    'SimulationPathDetails',
    'Cases',
    'CaseDetails',
    'User',
    'Badges',
    'UserPreferences',
    'ReviewMessages',
    'ReviewDetails',
    'ReviewThreads',
    'GeneralComments',
    'UnreadReviewCount',
    'LearnTracks',
    'LearnTrackDetail',
    'LearnTrackNext',
    'LearnTrackLanguages',
    'Progress',
    'Notifications',
    'UnreadNotificationCount',
    'CourseDiscussion',
  ],
  endpoints: () => ({}),
});
