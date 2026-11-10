import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseApi";

/** One page the assistant read (What it knows → Sources). */
export interface SourcePage {
  url: string;
  title: string | null;
  details: number;
  removed: boolean;
  eventId: string | null;
}

export interface FoundPage {
  url: string;
  path: string;
  title: string | null;
  read: boolean;
}

export interface PageChoice {
  include: string[];
  exclude: string[];
}

export interface FoundPages {
  choice: PageChoice;
  groups: { section: string; pages: FoundPage[] }[];
}

const SOURCES = "Sources" as const;

/** Which pages it learns from (chunk 20a-2): Choose pages, and Sources on the home. */
export const sourcesApi = baseAPI.enhanceEndpoints({ addTagTypes: [SOURCES] }).injectEndpoints({
  endpoints: builder => ({
    getSources: builder.query<SourcePage[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.SOURCES(id), method: HttpMethod.GET }),
      providesTags: [SOURCES],
    }),
    previewSource: builder.mutation<
      { url: string; title: string | null; details: number },
      { id: string; url: string }
    >({
      query: ({ id, url }) => ({
        url: ApiEndpoints.CHATBOTS.SOURCE_PREVIEW(id),
        method: HttpMethod.POST,
        body: { url },
      }),
    }),
    removeSource: builder.mutation<{ eventId: string }, { id: string; url: string }>({
      query: ({ id, url }) => ({
        url: ApiEndpoints.CHATBOTS.SOURCE_REMOVE(id),
        method: HttpMethod.POST,
        body: { url },
      }),
      invalidatesTags: [SOURCES],
    }),
    restoreSource: builder.mutation<{ restored: number }, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.CHATBOTS.SOURCE_RESTORE(id, eventId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [SOURCES],
    }),
    getFoundPages: builder.query<FoundPages, string>({
      query: id => ({ url: ApiEndpoints.BOT_DRAFTS.PAGES_FOUND(id), method: HttpMethod.GET }),
    }),
    choosePages: builder.mutation<
      { choice: PageChoice; removed: number; eventId: string | null },
      { id: string } & PageChoice
    >({
      query: ({ id, include, exclude }) => ({
        url: ApiEndpoints.BOT_DRAFTS.PAGES(id),
        method: HttpMethod.POST,
        body: { include, exclude },
      }),
    }),
    undoPages: builder.mutation<{ restored: number }, { id: string; eventId: string }>({
      query: ({ id, eventId }) => ({
        url: ApiEndpoints.BOT_DRAFTS.PAGES_UNDO(id, eventId),
        method: HttpMethod.POST,
      }),
    }),
  }),
});

export const {
  useGetSourcesQuery,
  usePreviewSourceMutation,
  useRemoveSourceMutation,
  useRestoreSourceMutation,
  useGetFoundPagesQuery,
  useChoosePagesMutation,
  useUndoPagesMutation,
} = sourcesApi;
