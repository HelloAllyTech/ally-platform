import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AssistantHomeView,
  BotImageKind,
  BotImageView,
  BotPageAccessEntry,
  BotPageAccessKind,
  BotPageBrand,
  BotPageView,
  Chatbot,
  ChatbotAudienceEntry,
  ChatbotAudienceKind,
  ChatbotDocumentDetail,
  ChatbotDocumentRow,
  ChatbotMember,
  ChatbotMemberRole,
  ChatbotSettingsOverride,
  ChatbotSettingsView,
  ChatbotStatus,
  Connector,
  CreateChatbotRequest,
  CreateChatbotUploadUrlRequest,
  CreateKbUploadUrlResponse,
  CreatePrivateChatbotDocumentRequest,
  GetChatbotsResponse,
  HomeFact,
  HomeFieldName,
  HomeFieldState,
  HomeList,
  HomeListChange,
  HowItWorks,
  HomeListName,
  HomeSafety,
  RuleChange,
  TestChatbotRequest,
  TestChatbotResponse,
  UpdateChatbotDocumentRequest,
  UpdateBotPageRequest,
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
const documentTag = (id: string, documentId: string) => `${id}:document:${documentId}`;
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

    /** Presign a file for one of the chatbot's own documents; the browser PUTs it there. */
    createChatbotDocumentUploadUrl: builder.mutation<
      CreateKbUploadUrlResponse,
      CreateChatbotUploadUrlRequest
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.DOCUMENT_UPLOAD_URL(id),
        method: HttpMethod.POST,
        body,
      }),
    }),

    /** A document only this chatbot sees: attached and queued for indexing. Returns its list. */
    createPrivateChatbotDocument: builder.mutation<
      ChatbotDocumentRow[],
      CreatePrivateChatbotDocumentRequest
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.PRIVATE_DOCUMENTS(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    /** Archives a private document; takes a shared one off this chatbot only. Returns its list. */
    removeChatbotDocument: builder.mutation<
      ChatbotDocumentRow[],
      { id: string; documentId: string }
    >({
      query: ({ id, documentId }) => ({
        url: ApiEndpoints.CHATBOTS.DOCUMENT_BY_ID(id, documentId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => botTags(id),
    }),

    /** One document on this chatbot, with its text. */
    getChatbotDocument: builder.query<ChatbotDocumentDetail, { id: string; documentId: string }>({
      query: ({ id, documentId }) => ({
        url: ApiEndpoints.CHATBOTS.DOCUMENT_BY_ID(id, documentId),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, { id, documentId }) => [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: documentTag(id, documentId) },
      ],
    }),

    /** Edits one of the chatbot's own documents; a changed text queues it for training again. */
    updateChatbotDocument: builder.mutation<ChatbotDocumentDetail, UpdateChatbotDocumentRequest>({
      query: ({ id, documentId, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.DOCUMENT_BY_ID(id, documentId),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (_r, _e, { id, documentId }) => [
        ...botTags(id),
        { type: TAG_TYPES.CHATBOT_DETAIL, id: documentTag(id, documentId) },
      ],
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

    // ── assistant home (chunk 20d) ───────────────────────────────────────

    getAssistantHome: builder.query<AssistantHomeView, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.HOME(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:home` }],
    }),

    /**
     * Save one field. A save based on a value that changed since is refused (409, with what it
     * says now). A saved value goes straight into the cached home, so other fields being edited
     * keep their versions; the bot and its page are refetched for the screens that show them.
     */
    saveHomeField: builder.mutation<
      { field: HomeFieldName } & HomeFieldState<unknown>,
      { id: string; field: HomeFieldName; value: unknown; version: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.HOME(id),
        method: HttpMethod.PATCH,
        body,
      }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            chatbotsApi.util.updateQueryData("getAssistantHome", id, home => {
              (home.fields as Record<string, HomeFieldState<unknown>>)[data.field] = {
                value: data.value,
                version: data.version,
              };
            }),
          );
        } catch {
          // The caller shows the refusal.
        }
      },
      invalidatesTags: (r, _e, { id }) =>
        r
          ? [
              ...botTags(id),
              { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page` },
              // The History and How it works show the change (chunk 20d-2).
              { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:history` },
              { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:how` },
            ]
          : [],
    }),

    /** "How it works": everything the assistant follows, from the runtime (chunk 20d-2). */
    getHowItWorks: builder.query<HowItWorks, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.HOW_IT_WORKS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:how` }],
    }),

    /** One of the home's lists with its version (chunk 20d-2). */
    getHomeList: builder.query<HomeList<HomeListName>, { id: string; list: HomeListName }>({
      query: ({ id, list }) => ({
        url: ApiEndpoints.CHATBOTS.HOME_LIST(id, list),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, { id, list }) => [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:list:${list}` },
      ],
    }),

    /**
     * One add, edit or remove on a home list, with the version it was based on. A change based on
     * a list that changed since is refused (409, with the list as it is now). The new list goes
     * straight into the cache.
     */
    changeHomeList: builder.mutation<
      HomeList<HomeListName>,
      { id: string; list: HomeListName; version: string; change: HomeListChange }
    >({
      query: ({ id, list, version, change }) => ({
        url: ApiEndpoints.CHATBOTS.HOME_LIST(id, list),
        method: HttpMethod.PATCH,
        body: { ...change, version },
      }),
      async onQueryStarted({ id, list }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            chatbotsApi.util.updateQueryData("getHomeList", { id, list }, current => {
              current.items = data.items;
              current.version = data.version;
            }),
          );
        } catch {
          // The caller shows the refusal.
        }
      },
      // The bot (its team, documents) shows elsewhere too.
      invalidatesTags: (r, _e, { id }) => (r ? botTags(id) : []),
    }),

    changeOwnRule: builder.mutation<HomeSafety, { id: string; version: string } & RuleChange>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.RULES(id),
        method: HttpMethod.PATCH,
        body,
      }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            chatbotsApi.util.updateQueryData("getAssistantHome", id, home => {
              home.safety = data;
            }),
          );
        } catch {
          // The caller shows the refusal.
        }
      },
    }),

    correctFact: builder.mutation<
      { fact: HomeFact; appliedTo: "page" | "notes" },
      { id: string; factId: string; text: string; version: string }
    >({
      query: ({ id, factId, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.FACT_CORRECTION(id, factId),
        method: HttpMethod.POST,
        body,
      }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            chatbotsApi.util.updateQueryData("getAssistantHome", id, home => {
              home.facts = home.facts.map(f => (f.id === data.fact.id ? data.fact : f));
            }),
          );
        } catch {
          // The caller shows the refusal.
        }
      },
      // The page document changed, and the notes may be new.
      invalidatesTags: (r, _e, { id }) => (r ? botTags(id) : []),
    }),

    // ── bot page (chunk 12b) ─────────────────────────────────────────────

    getBotPage: builder.query<BotPageView, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.PAGE(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page` }],
    }),

    updateBotPage: builder.mutation<BotPageView, UpdateBotPageRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE(id),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page` }],
    }),

    checkBotPageSlug: builder.query<
      { slug: string; available: boolean; reason?: string },
      { id: string; slug: string }
    >({
      query: ({ id, slug }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE_SLUG_AVAILABLE(id),
        method: HttpMethod.GET,
        params: { slug },
      }),
    }),

    createBotPageLogoUrl: builder.mutation<
      { presignedUrl: string; imageUrl: string },
      { id: string; fileName: string; fileSize: number; contentType: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE_LOGO_URL(id),
        method: HttpMethod.POST,
        body,
      }),
    }),

    // ── bot page look and images (chunk 20d) ─────────────────────────────

    updateBotPageBrand: builder.mutation<
      BotPageView,
      { id: string } & Partial<Omit<BotPageBrand, "accentContrast">>
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE_BRAND(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page` }],
    }),

    getChatbotTeamNames: builder.query<{ names: string[] }, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.TEAM_NAMES(id), method: HttpMethod.GET }),
    }),

    getBotImages: builder.query<BotImageView[], string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.IMAGES(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:images` }],
    }),

    uploadBotImage: builder.mutation<
      BotImageView,
      { id: string; kind: BotImageKind; file: File; alt?: string }
    >({
      query: ({ id, kind, file, alt }) => {
        const body = new FormData();
        body.append("file", file);
        body.append("kind", kind);
        if (alt) body.append("alt", alt);
        return { url: ApiEndpoints.CHATBOTS.IMAGES(id), method: HttpMethod.POST, body };
      },
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:images` }],
    }),

    updateBotImage: builder.mutation<BotImageView, { id: string; imageId: string; alt: string }>({
      query: ({ id, imageId, alt }) => ({
        url: ApiEndpoints.CHATBOTS.IMAGE(id, imageId),
        method: HttpMethod.PATCH,
        body: { alt },
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:images` }],
    }),

    removeBotImage: builder.mutation<void, { id: string; imageId: string }>({
      query: ({ id, imageId }) => ({
        url: ApiEndpoints.CHATBOTS.IMAGE(id, imageId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:images` }],
    }),

    restoreBotImage: builder.mutation<BotImageView, { id: string; imageId: string }>({
      query: ({ id, imageId }) => ({
        url: ApiEndpoints.CHATBOTS.IMAGE_RESTORE(id, imageId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:images` }],
    }),

    getBotPageAccess: builder.query<{ entries: BotPageAccessEntry[] }, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.PAGE_ACCESS(id), method: HttpMethod.GET }),
      providesTags: (_r, _e, id) => [{ type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page-access` }],
    }),

    addBotPageAccess: builder.mutation<
      { added: number; skipped: number },
      { id: string; entries: { kind: BotPageAccessKind; value: string; label?: string }[] }
    >({
      query: ({ id, entries }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE_ACCESS(id),
        method: HttpMethod.POST,
        body: { entries },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page-access` },
      ],
    }),

    removeBotPageAccess: builder.mutation<void, { id: string; entryId: string }>({
      query: ({ id, entryId }) => ({
        url: ApiEndpoints.CHATBOTS.PAGE_ACCESS_ENTRY(id, entryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: TAG_TYPES.CHATBOT_DETAIL, id: `${id}:page-access` },
      ],
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
  }),
});

export const {
  useGetAssistantHomeQuery,
  useSaveHomeFieldMutation,
  useChangeOwnRuleMutation,
  useGetHomeListQuery,
  useGetHowItWorksQuery,
  useChangeHomeListMutation,
  useCorrectFactMutation,
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
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
  useRemoveChatbotDocumentMutation,
  useGetChatbotDocumentQuery,
  useUpdateChatbotDocumentMutation,
  useGetChatbotMembersQuery,
  useSetChatbotMembersMutation,
  useGetChatbotAudienceQuery,
  useAddChatbotAudienceMutation,
  useRemoveChatbotAudienceMutation,
  useTestChatbotMutation,
  useBindConnectorMutation,
  useGetBotPageQuery,
  useUpdateBotPageMutation,
  useLazyCheckBotPageSlugQuery,
  useCreateBotPageLogoUrlMutation,
  useUpdateBotPageBrandMutation,
  useGetBotImagesQuery,
  useGetChatbotTeamNamesQuery,
  useUploadBotImageMutation,
  useUpdateBotImageMutation,
  useRemoveBotImageMutation,
  useRestoreBotImageMutation,
  useGetBotPageAccessQuery,
  useAddBotPageAccessMutation,
  useRemoveBotPageAccessMutation,
} = chatbotsApi;
