import {Platform} from 'react-native';

import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeedResponse {
  data: NotificationItem[];
  count: number;
}

export const notificationsApi = api.injectEndpoints({
  overrideExisting: true,
  endpoints: builder => ({
    getNotifications: builder.query<
      NotificationFeedResponse,
      {limit?: number; offset?: number}
    >({
      query: ({limit = 25, offset = 0}) => ({
        url: API_ROUTES.NOTIFICATIONS.LIST,
        method: API_METHODS.GET,
        params: {limit, offset},
      }),
      providesTags: ['Notifications'],
    }),
    getUnreadNotificationCount: builder.query<{count: number}, void>({
      query: () => ({
        url: API_ROUTES.NOTIFICATIONS.UNREAD_COUNT,
        method: API_METHODS.GET,
      }),
      providesTags: ['UnreadNotificationCount'],
    }),
    markNotificationRead: builder.mutation<{success: boolean}, string>({
      query: id => ({
        url: API_ROUTES.NOTIFICATIONS.MARK_READ(id),
        method: API_METHODS.PATCH,
      }),
      invalidatesTags: ['Notifications', 'UnreadNotificationCount'],
    }),
    markAllNotificationsRead: builder.mutation<{success: boolean}, void>({
      query: () => ({
        url: API_ROUTES.NOTIFICATIONS.MARK_ALL_READ,
        method: API_METHODS.PATCH,
      }),
      invalidatesTags: ['Notifications', 'UnreadNotificationCount'],
    }),
    registerDeviceToken: builder.mutation<{success: boolean}, {token: string}>({
      query: ({token}) => ({
        url: API_ROUTES.NOTIFICATIONS.DEVICE_TOKENS,
        method: API_METHODS.PUT,
        body: {
          token,
          platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        },
      }),
    }),
    deleteDeviceToken: builder.mutation<{success: boolean}, {token: string}>({
      query: ({token}) => ({
        url: API_ROUTES.NOTIFICATIONS.DEVICE_TOKEN_BY_VALUE(token),
        method: API_METHODS.DELETE,
      }),
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useRegisterDeviceTokenMutation,
  useDeleteDeviceTokenMutation,
} = notificationsApi;
