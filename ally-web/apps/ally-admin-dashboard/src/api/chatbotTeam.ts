import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type { ChatbotMemberRole } from "@types";

import { baseAPI } from "./baseApi";

/**
 * An assistant's team beyond the home's lists (Stage 1b, D9): members with their role sets, who
 * created it, leaving, handing it over, invites by email, the invite link's page and the
 * responder agreement. Refusals carry an `errorCode` (`last_owner`, `creator_must_transfer`,
 * `only_creator_can_transfer`, `invite_wrong_email`, `responder_agreement_required`, ...).
 */
export interface TeamMember {
  userId: number;
  name: string | null;
  email: string | null;
  /** The OLD single role (the highest of `roles`). */
  role: ChatbotMemberRole;
  roles: ChatbotMemberRole[];
  /** Made the assistant: can't be removed or leave until they hand it over. */
  isCreator: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  roles: ChatbotMemberRole[];
  invitedBy: number | null;
  expiresAt: string;
  createdAt: string;
}

export interface InvitePreview {
  chatbotName: string;
  /** `a***@example.com` */
  email: string;
  roles: ChatbotMemberRole[];
  expiresAt: string;
}

export interface AcceptedInvite {
  chatbotId: string;
  chatbotName: string;
  roles: ChatbotMemberRole[];
  accountCreated: boolean;
  email: string;
}

export interface ResponderAgreementStatus {
  currentVersion: string;
  text: string;
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** The server's kill switch: false means nothing is refused for lack of it. */
  enforced: boolean;
}

const membersTag = (id: string) => ({ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:members` });
const invitesTag = (id: string) => ({ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:invites` });
const teamChanged = (id: string) => [
  membersTag(id),
  { type: TAG_TYPES.CHATBOT_DETAIL, id },
  { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:list:team` },
  TAG_TYPES.CHATBOTS,
];

export const chatbotTeamApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getChatbotMembers: builder.query<TeamMember[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.MEMBERS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [membersTag(id), { type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    /** Replace the team. Each member gives their whole role set. */
    setChatbotMembers: builder.mutation<
      unknown,
      { id: string; members: { userId: number; roles: ChatbotMemberRole[] }[] }
    >({
      query: ({ id, members }) => ({
        url: ApiEndpoints.CHATBOTS.MEMBERS(id),
        method: HttpMethod.PUT,
        body: { members },
      }),
      invalidatesTags: (_r, _e, { id }) => teamChanged(id),
    }),

    removeChatbotMember: builder.mutation<unknown, { id: string; userId: number }>({
      query: ({ id, userId }) => ({
        url: ApiEndpoints.CHATBOTS.MEMBER(id, userId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => teamChanged(id),
    }),

    leaveChatbot: builder.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: ApiEndpoints.CHATBOTS.LEAVE(id), method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, { id }) => teamChanged(id),
    }),

    transferChatbot: builder.mutation<unknown, { id: string; userId: number }>({
      query: ({ id, userId }) => ({
        url: ApiEndpoints.CHATBOTS.TRANSFER(id),
        method: HttpMethod.POST,
        body: { userId },
      }),
      invalidatesTags: (_r, _e, { id }) => teamChanged(id),
    }),

    getChatbotInvites: builder.query<PendingInvite[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.INVITES(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [invitesTag(id)],
    }),

    createChatbotInvite: builder.mutation<
      PendingInvite & { emailSent: boolean },
      { id: string; email: string; roles: ChatbotMemberRole[] }
    >({
      query: ({ id, email, roles }) => ({
        url: ApiEndpoints.CHATBOTS.INVITES(id),
        method: HttpMethod.POST,
        body: { email, roles },
      }),
      invalidatesTags: (_r, _e, { id }) => [invitesTag(id)],
    }),

    revokeChatbotInvite: builder.mutation<unknown, { id: string; inviteId: string }>({
      query: ({ id, inviteId }) => ({
        url: ApiEndpoints.CHATBOTS.INVITE(id, inviteId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => [invitesTag(id)],
    }),

    /** The invite link's page (no sign-in): what the invite is for. */
    previewAssistantInvite: builder.mutation<InvitePreview, { token: string }>({
      query: ({ token }) => ({
        url: ApiEndpoints.PUBLIC_ASSISTANT_INVITES.PREVIEW,
        method: HttpMethod.POST,
        body: { token },
      }),
    }),

    /** Signed out: the token and the invited email. Then they sign in with that email. */
    acceptAssistantInvitePublic: builder.mutation<AcceptedInvite, { token: string; email: string }>(
      {
        query: ({ token, email }) => ({
          url: ApiEndpoints.PUBLIC_ASSISTANT_INVITES.ACCEPT,
          method: HttpMethod.POST,
          body: { token, email },
        }),
      },
    ),

    /** Signed in: their own account's email must be the invite's. */
    acceptAssistantInvite: builder.mutation<AcceptedInvite, { token: string }>({
      query: ({ token }) => ({
        url: ApiEndpoints.ASSISTANT_MEMBERS.ACCEPT_INVITE,
        method: HttpMethod.POST,
        body: { token },
      }),
      invalidatesTags: [TAG_TYPES.CHATBOTS],
    }),

    getResponderAgreement: builder.query<ResponderAgreementStatus, void>({
      query: () => ({
        url: ApiEndpoints.ASSISTANT_MEMBERS.RESPONDER_AGREEMENT,
        method: HttpMethod.GET,
      }),
      providesTags: [{ type: TAG_TYPES.CHATBOT_DETAIL, id: "responder-agreement" }],
    }),

    acceptResponderAgreement: builder.mutation<ResponderAgreementStatus, { version: string }>({
      query: ({ version }) => ({
        url: ApiEndpoints.ASSISTANT_MEMBERS.RESPONDER_AGREEMENT,
        method: HttpMethod.POST,
        body: { version },
      }),
      invalidatesTags: [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: "responder-agreement" },
        TAG_TYPES.INBOX,
      ],
    }),
  }),
});

export const {
  useGetChatbotMembersQuery,
  useSetChatbotMembersMutation,
  useRemoveChatbotMemberMutation,
  useLeaveChatbotMutation,
  useTransferChatbotMutation,
  useGetChatbotInvitesQuery,
  useCreateChatbotInviteMutation,
  useRevokeChatbotInviteMutation,
  usePreviewAssistantInviteMutation,
  useAcceptAssistantInvitePublicMutation,
  useAcceptAssistantInviteMutation,
  useGetResponderAgreementQuery,
  useAcceptResponderAgreementMutation,
} = chatbotTeamApi;
