import { HttpMethod } from "@constants";

import { baseAPI } from "../../api/baseApi";

/**
 * Assistants stage 8: Ally staff's read-only view of any chatbot (ally-be
 * `chatbot/staff/chatbot-staff-access.controller.ts`). The staff search, and the owner's grant
 * for conversations plus "who looked". No cache tags: each screen refetches after a change.
 */

export interface StaffChatbotHit {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  createdAt: string;
  owners: { name: string; email: string; tenantId: string | null }[];
  /** The owner has a live grant: conversations can be read too. */
  conversationsAllowed: boolean;
}

export interface StaffGrant {
  id: string;
  grantedBy: number;
  grantedByName: string | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "live" | "expired" | "revoked";
}

export interface StaffView {
  id: string;
  at: string;
  staffUserId: number;
  staffName: string | null;
  what: string;
  conversations: boolean;
  conversationId: string | null;
  route: string;
}

export const STAFF_SUPPORT_URLS = {
  SEARCH: "/v1/staff/chatbots",
  GRANTS: (id: string) => `/v1/chatbots/${id}/staff-access`,
  GRANT: (id: string, grantId: string) => `/v1/chatbots/${id}/staff-access/${grantId}`,
  VIEWS: (id: string) => `/v1/chatbots/${id}/staff-views`,
  CONVERSATION_ACCESS: (id: string) => `/v1/staff/chatbots/${id}/conversation-access`,
};

/** Staff only: whether the owner's grant to read conversations is live (logged server side). */
export interface StaffConversationAccess {
  granted: boolean;
  expiresAt?: string;
}

export const staffAccessAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    searchStaffChatbots: builder.query<StaffChatbotHit[], string>({
      query: q => ({
        url: STAFF_SUPPORT_URLS.SEARCH,
        method: HttpMethod.GET,
        params: q ? { q } : undefined,
      }),
      keepUnusedDataFor: 0,
    }),
    getStaffGrants: builder.query<{ grants: StaffGrant[] }, string>({
      query: id => ({ url: STAFF_SUPPORT_URLS.GRANTS(id), method: HttpMethod.GET }),
      keepUnusedDataFor: 0,
    }),
    grantStaffAccess: builder.mutation<StaffGrant, { id: string; hours: number; reason?: string }>({
      query: ({ id, ...body }) => ({
        url: STAFF_SUPPORT_URLS.GRANTS(id),
        method: HttpMethod.POST,
        body,
      }),
    }),
    revokeStaffAccess: builder.mutation<void, { id: string; grantId: string }>({
      query: ({ id, grantId }) => ({
        url: STAFF_SUPPORT_URLS.GRANT(id, grantId),
        method: HttpMethod.DELETE,
      }),
    }),
    getStaffConversationAccess: builder.query<StaffConversationAccess, string>({
      query: id => ({ url: STAFF_SUPPORT_URLS.CONVERSATION_ACCESS(id), method: HttpMethod.GET }),
      keepUnusedDataFor: 0,
    }),
    getStaffViews: builder.query<{ views: StaffView[] }, string>({
      query: id => ({ url: STAFF_SUPPORT_URLS.VIEWS(id), method: HttpMethod.GET }),
      keepUnusedDataFor: 0,
    }),
  }),
});

export const {
  useSearchStaffChatbotsQuery,
  useGetStaffGrantsQuery,
  useGrantStaffAccessMutation,
  useRevokeStaffAccessMutation,
  useGetStaffViewsQuery,
  useGetStaffConversationAccessQuery,
} = staffAccessAPI;
