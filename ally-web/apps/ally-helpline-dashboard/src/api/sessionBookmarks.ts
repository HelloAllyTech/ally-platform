import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { SaveSessionBookmarkRequest, SessionBookmark } from "@types";

import { baseAPI } from "./baseAPI";

const sessionBookmarksAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getSessionBookmarks: builder.query<SessionBookmark[], void>({
      query: () => ({
        url: ApiEndpoints.SESSION_BOOKMARKS.BASE,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.SESSION_BOOKMARKS],
    }),

    saveSessionBookmark: builder.mutation<SessionBookmark, SaveSessionBookmarkRequest>({
      query: body => ({
        url: ApiEndpoints.SESSION_BOOKMARKS.BASE,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.SESSION_BOOKMARKS],
    }),

    removeSessionBookmark: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.SESSION_BOOKMARKS.BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.SESSION_BOOKMARKS],
    }),
  }),
});

export const {
  useGetSessionBookmarksQuery,
  useSaveSessionBookmarkMutation,
  useRemoveSessionBookmarkMutation,
} = sessionBookmarksAPI;
