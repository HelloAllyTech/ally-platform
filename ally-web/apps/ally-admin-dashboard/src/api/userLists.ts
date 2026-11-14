import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type {
  ListAbility,
  ListEntriesPage,
  ListEntriesQuery,
  ListEntry,
  ListField,
  ListRefusal,
  ListRule,
  ListSettings,
  ReadyMadeCatalogue,
  RepeatWeeklyRequest,
  RepeatWeeklyResult,
  UserList,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * An assistant's lists (chunk 5b): definitions, entries, ready-made lists, Repeat weekly and
 * what the assistant may do. A refusal comes back as the error's `details` (`listRefusalOf`).
 *
 * Tags: `<bot>:lists` for the definitions, `<bot>:lists:<key>` for one list's entries. A
 * definition change refetches both, since entries are shown through the definition.
 */
const listsTag = (id: string) => ({ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:lists` });
const entriesTag = (id: string, key: string) => ({
  type: TAG_TYPES.CHATBOT_DETAIL,
  id: `${id}:lists:${key}`,
});

type FieldInput = Partial<Omit<ListField, "position" | "archived_at">> & {
  key?: string;
  label: string;
  type: ListField["type"];
};

export const userListsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getUserLists: builder.query<UserList[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.LISTS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [listsTag(id)],
    }),

    /** The assistant's contacts, for a detail linked to a person. Masked, never raw numbers. */
    searchListContacts: builder.query<
      { contacts: { id: string; name: string; hint?: string }[] },
      { id: string; search: string }
    >({
      query: ({ id, search }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_CONTACTS(id),
        method: HttpMethod.GET,
        params: { search, limit: 20 },
      }),
    }),

    getReadyMadeLists: builder.query<ReadyMadeCatalogue, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.READY_MADE_LISTS(id), method: HttpMethod.GET }),
    }),

    /** Installs a ready-made list (and the list it books into) with no entries. */
    installReadyMadeList: builder.mutation<
      { lists: UserList[] },
      { id: string; name: string; options?: Record<string, Record<string, string[]>> }
    >({
      query: ({ id, name, options }) => ({
        url: ApiEndpoints.CHATBOTS.READY_MADE_LIST(id, name),
        method: HttpMethod.POST,
        body: options ? { options } : {},
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    createUserList: builder.mutation<
      UserList,
      { id: string; key: string; name: string; fields?: FieldInput[]; settings?: ListSettings }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.LISTS(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    updateUserList: builder.mutation<
      UserList,
      { id: string; key: string; name?: string; settings?: ListSettings }
    >({
      query: ({ id, key, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.USER_LIST(id, key),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    deleteUserList: builder.mutation<void, { id: string; key: string }>({
      query: ({ id, key }) => ({
        url: ApiEndpoints.CHATBOTS.USER_LIST(id, key),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, e, { id }) => (e ? [] : [listsTag(id)]),
    }),

    restoreUserList: builder.mutation<UserList, { id: string; listId: string }>({
      query: ({ id, listId }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RESTORE(id, listId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    addListField: builder.mutation<UserList, { id: string; key: string; field: FieldInput }>({
      query: ({ id, key, field }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_FIELDS(id, key),
        method: HttpMethod.POST,
        body: field,
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [listsTag(id), entriesTag(id, key)] : []),
    }),

    updateListField: builder.mutation<
      UserList,
      {
        id: string;
        key: string;
        field: string;
        change: Partial<FieldInput> & { position?: number };
      }
    >({
      query: ({ id, key, field, change }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_FIELD(id, key, field),
        method: HttpMethod.PATCH,
        body: change,
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [listsTag(id), entriesTag(id, key)] : []),
    }),

    /** Archives a detail: its values stay, and it can't be reused. */
    archiveListField: builder.mutation<UserList, { id: string; key: string; field: string }>({
      query: ({ id, key, field }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_FIELD(id, key, field),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [listsTag(id), entriesTag(id, key)] : []),
    }),

    addListRule: builder.mutation<
      UserList,
      { id: string; key: string; rule: Omit<ListRule, "id"> }
    >({
      query: ({ id, key, rule }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RULES(id, key),
        method: HttpMethod.POST,
        body: rule,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    deleteListRule: builder.mutation<UserList, { id: string; key: string; ruleId: string }>({
      query: ({ id, key, ruleId }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RULE(id, key, ruleId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (r, _e, { id }) => (r ? [listsTag(id)] : []),
    }),

    /** Look up, Add and Change: the assistant's list tools, owner-editable (chunk 5b). */
    setListAbilities: builder.mutation<
      UserList,
      { id: string; key: string; find?: ListAbility; create?: ListAbility; update?: ListAbility }
    >({
      query: ({ id, key, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_ABILITIES(id, key),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: (r, _e, { id }) =>
        r ? [listsTag(id), { type: TAG_TYPES.CHATBOT_DETAIL, id }] : [],
    }),

    getListEntries: builder.query<
      ListEntriesPage,
      { id: string; key: string; query: ListEntriesQuery }
    >({
      query: ({ id, key, query }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORDS_QUERY(id, key),
        method: HttpMethod.POST,
        body: query,
      }),
      providesTags: (_r, _e, { id, key }) => [entriesTag(id, key)],
    }),

    getListEntry: builder.query<ListEntry, { id: string; key: string; recordId: string }>({
      query: ({ id, key, recordId }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORD(id, key, recordId),
        method: HttpMethod.GET,
      }),
    }),

    createListEntry: builder.mutation<
      { record: ListEntry },
      { id: string; key: string; data: Record<string, unknown> }
    >({
      query: ({ id, key, data }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORDS(id, key),
        method: HttpMethod.POST,
        body: { data },
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [entriesTag(id, key), listsTag(id)] : []),
    }),

    updateListEntry: builder.mutation<
      { record: ListEntry },
      { id: string; key: string; recordId: string; version: number; data: Record<string, unknown> }
    >({
      query: ({ id, key, recordId, version, data }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORD(id, key, recordId),
        method: HttpMethod.PATCH,
        body: { data, version },
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [entriesTag(id, key)] : []),
    }),

    deleteListEntry: builder.mutation<void, { id: string; key: string; recordId: string }>({
      query: ({ id, key, recordId }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORD(id, key, recordId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, e, { id, key }) => (e ? [] : [entriesTag(id, key), listsTag(id)]),
    }),

    restoreListEntry: builder.mutation<
      { record: ListEntry },
      { id: string; key: string; recordId: string }
    >({
      query: ({ id, key, recordId }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORD_RESTORE(id, key, recordId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (r, _e, { id, key }) => (r ? [entriesTag(id, key), listsTag(id)] : []),
    }),

    /** Repeat weekly until: a dry run counts, then the same call without it adds them. */
    repeatWeekly: builder.mutation<
      RepeatWeeklyResult,
      { id: string; key: string } & RepeatWeeklyRequest
    >({
      query: ({ id, key, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.LIST_RECORDS_REPEAT(id, key),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (r, _e, { id, key }) =>
        r && !r.dry_run ? [entriesTag(id, key), listsTag(id)] : [],
    }),
  }),
});

export const {
  useGetUserListsQuery,
  useGetReadyMadeListsQuery,
  useLazySearchListContactsQuery,
  useInstallReadyMadeListMutation,
  useCreateUserListMutation,
  useUpdateUserListMutation,
  useDeleteUserListMutation,
  useRestoreUserListMutation,
  useAddListFieldMutation,
  useUpdateListFieldMutation,
  useArchiveListFieldMutation,
  useAddListRuleMutation,
  useDeleteListRuleMutation,
  useSetListAbilitiesMutation,
  useGetListEntriesQuery,
  useLazyGetListEntriesQuery,
  useGetListEntryQuery,
  useLazyGetListEntryQuery,
  useCreateListEntryMutation,
  useUpdateListEntryMutation,
  useDeleteListEntryMutation,
  useRestoreListEntryMutation,
  useRepeatWeeklyMutation,
} = userListsApi;

/** The engine's refusal inside an RTK Query error, if that's what it is. */
export const listRefusalOf = (error: unknown): ListRefusal | null => {
  const data = (error as { data?: { details?: unknown } } | null)?.data;
  const details = data?.details as ListRefusal | undefined;
  return details && typeof details === "object" && typeof details.code === "string"
    ? details
    : null;
};
