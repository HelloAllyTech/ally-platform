import {Platform} from 'react-native';

import {API_METHODS, API_ROUTES} from '@/constants';
import {ForceUpdateResponse} from '@/types';

import {api} from './api';

const APP_VERSION_URL =
  Platform.OS === 'ios'
    ? API_ROUTES.APP_VERSION.IOS
    : API_ROUTES.APP_VERSION.ANDROID;

export const appConfigApi = api.injectEndpoints({
  endpoints: builder => ({
    getForceUpdateConfig: builder.query<ForceUpdateResponse, void>({
      query: () => ({
        url: APP_VERSION_URL,
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {useGetForceUpdateConfigQuery} = appConfigApi;
