import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface UserPreferences {
  default_language_id?: number;
  [key: string]: unknown;
}

export const userApi = api.injectEndpoints({
  endpoints: builder => ({
    /**
     * Get user's preferences
     * @returns {Promise<{ data: UserPreferences }>} User preferences object
     */
    getUserPreferences: builder.query<{data: UserPreferences}, void>({
      query: () => ({
        url: API_ROUTES.USERS.GET_USER_PREFERENCES,
        method: API_METHODS.GET,
      }),
    }),

    /**
     * Update user's preferences
     * @param {object} preferences - Any user preferences object (e.g., { default_language_id: 12 })
     * @returns {Promise<{ success: boolean }>} Success status
     */
    updateUserPreferences: builder.mutation<
      {success: boolean},
      Record<string, unknown>
    >({
      query: preferences => ({
        url: API_ROUTES.USERS.UPDATE_USER_PREFERENCES,
        method: API_METHODS.POST,
        body: preferences,
      }),
      async onQueryStarted(_, {dispatch, queryFulfilled}) {
        try {
          await queryFulfilled;
          // Invalidate user preferences cache so it refetches on next screen visit
          dispatch(userApi.util.invalidateTags(['UserPreferences']));
        } catch (error) {
          console.error('Error updating preferences:', error);
        }
      },
    }),
  }),
});

export const {
  useGetUserPreferencesQuery,
  useLazyGetUserPreferencesQuery,
  useUpdateUserPreferencesMutation,
} = userApi;
