import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { AppNotification } from "@types";

import { baseAPI } from "./baseApi";

/** The caller's in-app notification feed (`/v1/notifications`): ally-be already filters by role. */
export const notificationsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getNotifications: builder.query<{ count: number; data: AppNotification[] }, { limit?: number }>(
      {
        query: ({ limit }) => ({
          url: ApiEndpoints.NOTIFICATIONS.LIST,
          method: HttpMethod.GET,
          params: { limit: limit ?? 25 },
        }),
        providesTags: [TAG_TYPES.NOTIFICATIONS],
      },
    ),
    getUnreadNotificationCount: builder.query<{ count: number }, void>({
      query: () => ({ url: ApiEndpoints.NOTIFICATIONS.UNREAD_COUNT, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.NOTIFICATIONS],
    }),
    markNotificationRead: builder.mutation<{ success: boolean }, string>({
      query: id => ({ url: ApiEndpoints.NOTIFICATIONS.READ(id), method: HttpMethod.PATCH }),
      invalidatesTags: [TAG_TYPES.NOTIFICATIONS],
    }),
    markAllNotificationsRead: builder.mutation<{ success: boolean }, void>({
      query: () => ({ url: ApiEndpoints.NOTIFICATIONS.READ_ALL, method: HttpMethod.PATCH }),
      invalidatesTags: [TAG_TYPES.NOTIFICATIONS],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsAPI;
