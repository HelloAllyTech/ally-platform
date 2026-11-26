import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/** One person on the team's shared contact list. */
export interface CrmContact {
  id: string;
  fullName: string;
  organization: string | null;
  jobTitle: string | null;
  notes: string | null;
  relationshipManagerId: number | null;
  relationshipManagerName: string | null;
  createdAt: string;
  updatedAt: string;
  /** YYYY-MM-DD of the newest log entry. */
  lastLoggedOn: string | null;
  logCount: number;
}

/** A key event or conversation with a contact. */
export interface CrmContactLog {
  id: string;
  contactId: string;
  /** YYYY-MM-DD */
  occurredOn: string;
  summary: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
}

export interface CrmContactDetail extends CrmContact {
  /** Newest first. */
  logs: CrmContactLog[];
}

export interface CrmManager {
  userId: number;
  name: string;
}

export interface CrmContactBody {
  fullName?: string;
  organization?: string;
  jobTitle?: string;
  notes?: string;
  /** null clears it. */
  relationshipManagerId?: number | null;
}

export interface CrmLogBody {
  summary?: string;
  /** YYYY-MM-DD */
  occurredOn?: string;
}

export const crmAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getCrmContacts: builder.query<{ contacts: CrmContact[] }, { search?: string }>({
      query: params => ({
        url: ApiEndpoints.CRM.CONTACTS,
        method: HttpMethod.GET,
        params,
      }),
      providesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    /** Existing contacts with a similar name, for the duplicate check while typing. */
    getCrmContactMatches: builder.query<{ contacts: CrmContact[] }, string>({
      query: name => ({
        url: ApiEndpoints.CRM.MATCH,
        method: HttpMethod.GET,
        params: { name },
      }),
      providesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    getCrmContact: builder.query<CrmContactDetail, string>({
      query: id => ({ url: ApiEndpoints.CRM.CONTACT(id), method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.CRM_CONTACTS, id }],
    }),
    getCrmManagers: builder.query<{ managers: CrmManager[] }, void>({
      query: () => ({ url: ApiEndpoints.CRM.MANAGERS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    createCrmContact: builder.mutation<CrmContactDetail, CrmContactBody>({
      query: body => ({ url: ApiEndpoints.CRM.CONTACTS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    updateCrmContact: builder.mutation<CrmContactDetail, { id: string; data: CrmContactBody }>({
      query: ({ id, data }) => ({
        url: ApiEndpoints.CRM.CONTACT(id),
        method: HttpMethod.PATCH,
        body: data,
      }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    deleteCrmContact: builder.mutation<void, string>({
      query: id => ({ url: ApiEndpoints.CRM.CONTACT(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    addCrmLog: builder.mutation<CrmContactLog[], { contactId: string; data: CrmLogBody }>({
      query: ({ contactId, data }) => ({
        url: ApiEndpoints.CRM.LOGS(contactId),
        method: HttpMethod.POST,
        body: data,
      }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    updateCrmLog: builder.mutation<
      CrmContactLog[],
      { contactId: string; logId: string; data: CrmLogBody }
    >({
      query: ({ contactId, logId, data }) => ({
        url: ApiEndpoints.CRM.LOG(contactId, logId),
        method: HttpMethod.PATCH,
        body: data,
      }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
    deleteCrmLog: builder.mutation<CrmContactLog[], { contactId: string; logId: string }>({
      query: ({ contactId, logId }) => ({
        url: ApiEndpoints.CRM.LOG(contactId, logId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.CRM_CONTACTS],
    }),
  }),
});

export const {
  useGetCrmContactsQuery,
  useGetCrmContactMatchesQuery,
  useGetCrmContactQuery,
  useGetCrmManagersQuery,
  useCreateCrmContactMutation,
  useUpdateCrmContactMutation,
  useDeleteCrmContactMutation,
  useAddCrmLogMutation,
  useUpdateCrmLogMutation,
  useDeleteCrmLogMutation,
} = crmAPI;
