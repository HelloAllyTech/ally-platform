import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  Chatbot,
  ChatbotAudienceEntry,
  ChatbotAudienceKind,
  ChatbotDocumentRow,
  ChatbotMember,
  ChatbotMemberRole,
  ChatbotSettingsOverride,
  ChatbotSettingsView,
  ChatbotStatus,
  Connector,
  ConnectorType,
  CreateChatbotRequest,
  GetChatbotsResponse,
  TestChatbotRequest,
  TestChatbotResponse,
  UpdateChatbotRequest,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Chatbots and connectors.
 *
 * Every change to one bot invalidates its detail and the list, because the list cards carry
 * counts (documents, people, connectors) the detail tabs change. Connector moves invalidate both
 * bots' views and the WhatsApp numbers, whose cards show which bot they serve.
 */
const botTags = (id: string) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }, TAG_TYPES.CHATBOTS];

export const chatbotsApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getChatbots: builder.query<GetChatbotsResponse, void>({
      query: () => ({ url: ApiEndpoints.CHATBOTS.LIST, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CHATBOTS],
    }),

    getChatbot: builder.query<Chatbot, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.BY_ID(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    createChatbot: builder.mutation<Chatbot, CreateChatbotRequest>({
      query: body => ({ url: ApiEndpoints.CHATBOTS.LIST, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.CHATBOTS],
    }),

    updateChatbot: builder.mutation<Chatbot, UpdateChatbotRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    setChatbotStatus: builder.mutation<Chatbot, { id: string; status: ChatbotStatus }>({
      query: ({ id, status }) => ({
        url: ApiEndpoints.CHATBOTS.STATUS(id),
        method: HttpMethod.PATCH,
        body: { status },
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    archiveChatbot: builder.mutation<void, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.ARCHIVE(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.CHATBOTS, TAG_TYPES.CONNECTORS, TAG_TYPES.WHATSAPP_BOT_NUMBERS],
    }),

    getChatbotSettings: builder.query<ChatbotSettingsView, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.SETTINGS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    updateChatbotSettings: builder.mutation<
      ChatbotSettingsView,
      { id: string; settings: ChatbotSettingsOverride }
    >({
      query: ({ id, settings }) => ({
        url: ApiEndpoints.CHATBOTS.SETTINGS(id),
        method: HttpMethod.PUT,
        body: { settings },
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    getChatbotDocuments: builder.query<ChatbotDocumentRow[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.DOCUMENTS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    setChatbotDocuments: builder.mutation<
      ChatbotDocumentRow[],
      { id: string; documentIds: string[] }
    >({
      query: ({ id, documentIds }) => ({
        url: ApiEndpoints.CHATBOTS.DOCUMENTS(id),
        method: HttpMethod.PUT,
        body: { documentIds },
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    getChatbotMembers: builder.query<ChatbotMember[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.MEMBERS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    setChatbotMembers: builder.mutation<
      ChatbotMember[],
      { id: string; members: { userId: number; role: ChatbotMemberRole }[] }
    >({
      query: ({ id, members }) => ({
        url: ApiEndpoints.CHATBOTS.MEMBERS(id),
        method: HttpMethod.PUT,
        body: { members },
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    getChatbotAudience: builder.query<ChatbotAudienceEntry[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.AUDIENCE(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id }],
    }),

    addChatbotAudience: builder.mutation<
      { added: number; skipped: number },
      {
        id: string;
        entries: { kind: ChatbotAudienceKind; value: string; label?: string }[];
      }
    >({
      query: ({ id, entries }) => ({
        url: ApiEndpoints.CHATBOTS.AUDIENCE(id),
        method: HttpMethod.POST,
        body: { entries },
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    removeChatbotAudience: builder.mutation<void, { id: string; entryId: string }>({
      query: ({ id, entryId }) => ({
        url: ApiEndpoints.CHATBOTS.AUDIENCE_ENTRY(id, entryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    testChatbot: builder.mutation<TestChatbotResponse, TestChatbotRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.TEST(id),
        method: HttpMethod.POST,
        body,
      }),
      // The checklist's "Try it in Preview" step reads when the bot was last previewed.
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    getConnectorTypes: builder.query<ConnectorType[], void>({
      query: () => ({ url: ApiEndpoints.CHATBOTS.CONNECTOR_TYPES, method: HttpMethod.GET }),
    }),

    /** One bot's connectors, or (platform admins) every connector including free ones. */
    getConnectors: builder.query<Connector[], { chatbotId?: string } | void>({
      query: params => ({
        url: ApiEndpoints.CHATBOTS.CONNECTORS,
        method: HttpMethod.GET,
        params: params && params.chatbotId ? { chatbotId: params.chatbotId } : undefined,
      }),
      providesTags: [TAG_TYPES.CONNECTORS],
    }),

    bindConnector: builder.mutation<Connector, { id: string; chatbotId: string | null }>({
      query: ({ id, chatbotId }) => ({
        url: ApiEndpoints.CHATBOTS.CONNECTOR_BIND(id),
        method: HttpMethod.PATCH,
        body: { chatbotId },
      }),
      invalidatesTags: [
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
      ],
    }),

    disconnectConnector: builder.mutation<void, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.CONNECTOR_BY_ID(id), method: HttpMethod.DELETE }),
      invalidatesTags: [
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
      ],
    }),
  }),
});

export const {
  useGetChatbotsQuery,
  useGetChatbotQuery,
  useCreateChatbotMutation,
  useUpdateChatbotMutation,
  useSetChatbotStatusMutation,
  useArchiveChatbotMutation,
  useGetChatbotSettingsQuery,
  useUpdateChatbotSettingsMutation,
  useGetChatbotDocumentsQuery,
  useSetChatbotDocumentsMutation,
  useGetChatbotMembersQuery,
  useSetChatbotMembersMutation,
  useGetChatbotAudienceQuery,
  useAddChatbotAudienceMutation,
  useRemoveChatbotAudienceMutation,
  useTestChatbotMutation,
  useGetConnectorTypesQuery,
  useGetConnectorsQuery,
  useBindConnectorMutation,
  useDisconnectConnectorMutation,
} = chatbotsApi;
