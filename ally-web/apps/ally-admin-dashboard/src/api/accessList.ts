import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * A chatbot's "who may chat" list (stage 6): ally-be `ChatbotAudienceService`. Entries are a phone
 * number (stored as E.164), an email (lower case), an Ally user or an organisation. The mode
 * (anyone, recognised, listed) is the chatbot's `accessMode`.
 */
export type AccessEntryKind = "phone" | "email" | "user" | "organisation";

export interface AccessEntry {
  id: string;
  chatbotId: string;
  kind: AccessEntryKind;
  value: string;
  label?: string | null;
  createdAt?: string;
  /**
   * TODO(stage 6, ally-be): the list route does not return whether an entry has ever matched a
   * sender yet. When it does (`everMatched`), the screen shows "Matched" / "Never matched".
   */
  everMatched?: boolean;
}

export interface AccessEntryInput {
  kind: AccessEntryKind;
  value: string;
  label?: string;
}

const tag = (id: string) => ({ type: TAG_TYPES.CREDITS, id: `access:${id}` });

export const accessListApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getAccessList: builder.query<AccessEntry[], string>({
      query: id => ({ url: ApiEndpoints.ACCESS_LIST.ENTRIES(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [tag(id)],
    }),
    addAccessEntries: builder.mutation<
      { added: number; skipped: number },
      { id: string; entries: AccessEntryInput[] }
    >({
      query: ({ id, entries }) => ({
        url: ApiEndpoints.ACCESS_LIST.ENTRIES(id),
        method: HttpMethod.POST,
        body: { entries },
      }),
      invalidatesTags: (_r, _e, { id }) => [tag(id)],
    }),
    removeAccessEntry: builder.mutation<void, { id: string; entryId: string }>({
      query: ({ id, entryId }) => ({
        url: ApiEndpoints.ACCESS_LIST.ENTRY(id, entryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => [tag(id)],
    }),
  }),
});

export const { useGetAccessListQuery, useAddAccessEntriesMutation, useRemoveAccessEntryMutation } =
  accessListApi;
