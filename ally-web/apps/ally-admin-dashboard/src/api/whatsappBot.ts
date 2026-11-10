import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  CreateKbDocumentRequest,
  CreateKbUploadUrlRequest,
  CreateKbUploadUrlResponse,
  KbCorpus,
  KbChunk,
  GetKbDocumentsParams,
  GetKbDocumentsResponse,
  KbDocument,
  KbSearchRequest,
  KbSearchResponse,
  KbStats,
  ReplaceKbDocumentContentRequest,
  BulkWaPhoneMappingsRequest,
  BulkWaPhoneMappingsResponse,
  CreateWaPhoneMappingRequest,
  GetWaPhoneMappingsParams,
  GetWaPhoneMappingsResponse,
  UpdateKbDocumentAudienceRequest,
  UpdateKbDocumentRequest,
  UpdateWaPhoneMappingRequest,
  WaPhoneMapping,
  CreateWaTemplateRequest,
  GetWaTemplatesResponse,
  TestWaTemplateRequest,
  TestWaTemplateResponse,
  UpdateWaTemplateRequest,
  WaBotSettings,
  WaConnectionCheck,
  WaBusinessNumber,
  ConnectWaNumberRequest,
  WaTemplate,
  WaTemplateKind,
  GetWaConversationsParams,
  GetWaConversationsResponse,
  GetWaUnansweredResponse,
  WaAnalyticsBucket,
  WaAnalyticsOverview,
  WaConversationDetail,
  WaCorpusCoverageResponse,
  WaLanguageRow,
  WaUnansweredQuestion,
  WaUnansweredReason,
  WaUnansweredStatus,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The organisation a WhatsApp call acts for, as the `tenantId` query parameter.
 *
 * Always in the QUERY: for an org-restricted admin the backend's guard reads it there to confirm
 * they may act for that organisation at all. Absent = the platform-wide view.
 */
type WithOrg = { tenantId?: string };
const org = (tenantId?: string) => (tenantId ? { tenantId } : {});

/** Row calls accept a bare id (platform view) or the id with its organisation. */
type RowArg = string | ({ id: string } & WithOrg);
const row = (arg: RowArg) => (typeof arg === "string" ? { id: arg } : arg);

/**
 * The chatbot a WhatsApp activity call is about (replies, conversations, unanswered, usage), as the
 * `chatbotId` query parameter. Absent = every bot (platform admins only).
 */
type WithBot = { chatbotId?: string };
const bot = (chatbotId?: string) => (chatbotId ? { chatbotId } : {});
type BotRowArg = string | ({ id: string } & WithBot);
const botRow = (arg: BotRowArg) => (typeof arg === "string" ? { id: arg } : arg);

/**
 * WhatsApp Q&A bot admin endpoints, plus the shared knowledge-corpus ones.
 *
 * The corpus endpoints are NOT WhatsApp-specific — they take a `corpus` and serve the character
 * library too. They live here because the WhatsApp bot was their first consumer and moving them
 * would churn every import for no behavioural gain. The DATA layer is shared deliberately; the
 * SCREENS are not, and should not be: one is a bot's reference library and the other is
 * character-grounding material, and a single UI trying to be both would serve neither.
 *
 * Injected onto `baseAPI` rather than creating a new api, so no store change is needed. Every tag
 * used here is also registered in baseApi.ts's `tagTypes` — an unregistered tag is silently ignored
 * by RTK Query and the invalidation never fires, which is the documented scar in that file.
 *
 * The document tag is shared across corpora, so a character-library write also refetches the
 * WhatsApp list. Deliberate: one wasted request beats registering a second tag and discovering
 * months later that a typo made its invalidation a no-op.
 */
const whatsappBotAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    // ---- Corpus documents ----

    getKbDocuments: builder.query<GetKbDocumentsResponse, GetKbDocumentsParams | void>({
      query: (params?: GetKbDocumentsParams) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENTS,
        method: HttpMethod.GET,
        params: {
          corpus: params?.corpus ?? KbCorpus.WHATSAPP_QA,
          limit: params?.limit ?? 25,
          offset: params?.offset ?? 0,
          ...(params?.search ? { search: params.search } : {}),
          ...(params?.status ? { status: params.status } : {}),
          ...(params?.sourceType ? { sourceType: params.sourceType } : {}),
          includeArchived: params?.includeArchived ?? false,
          ...(params?.sortBy ? { sortBy: params.sortBy } : {}),
          ...(params?.sortDir ? { sortDir: params.sortDir } : {}),
          ...org(params?.tenantId),
          ...(params?.tenantId && params.excludeGlobal ? { excludeGlobal: true } : {}),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_DOCUMENTS],
    }),

    getKbDocument: builder.query<KbDocument, RowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_BY_ID(row(arg).id),
        params: org(row(arg).tenantId),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_DOCUMENTS],
    }),

    getKbStats: builder.query<KbStats, KbCorpus | void>({
      query: (corpus?: KbCorpus) => ({
        url: ApiEndpoints.WHATSAPP_BOT.STATS,
        method: HttpMethod.GET,
        params: { corpus: corpus ?? KbCorpus.WHATSAPP_QA },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_STATS],
    }),

    /** Presigned S3 PUT for a pdf/docx/epub. The browser uploads directly; see DocumentUploadField. */
    createKbUploadUrl: builder.mutation<
      CreateKbUploadUrlResponse,
      CreateKbUploadUrlRequest & WithOrg
    >({
      query: ({ tenantId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_UPLOAD_URL,
        params: org(tenantId),
        method: HttpMethod.POST,
        body,
      }),
    }),

    /**
     * Create a document. Returns immediately at status=pending — extraction, chunking and indexing
     * run on a queue, so the corpus list polls until the row reaches a terminal status.
     */
    createKbDocument: builder.mutation<KbDocument, CreateKbDocumentRequest & WithOrg>({
      query: ({ tenantId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENTS,
        params: org(tenantId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.WHATSAPP_BOT_STATS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    // ── Phone → organisation mappings ───────────────────────────────────────
    // The admin's answer to "the bot does not recognise this number". Resolution prefers these
    // over a `users.phone` match, so this is the surface that actually fixes a refusal.

    getWaPhoneMappings: builder.query<GetWaPhoneMappingsResponse, GetWaPhoneMappingsParams | void>({
      query: params => ({
        url: ApiEndpoints.WHATSAPP_BOT.PHONE_MAPPINGS,
        params: params ? { ...params } : undefined,
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_PHONE_MAPPINGS],
    }),

    createWaPhoneMapping: builder.mutation<WaPhoneMapping, CreateWaPhoneMappingRequest>({
      query: body => ({
        url: ApiEndpoints.WHATSAPP_BOT.PHONE_MAPPINGS,
        // The organisation the number goes to is also the one the request acts for.
        params: org(body.tenantId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_PHONE_MAPPINGS],
    }),

    /**
     * Upload many.
     *
     * The response is per-row, so the caller must render it rather than showing a count: a
     * 200-line roster with three conflicts and one typo is four lines to fix, and a success
     * toast would hide all four.
     */
    bulkCreateWaPhoneMappings: builder.mutation<
      BulkWaPhoneMappingsResponse,
      BulkWaPhoneMappingsRequest
    >({
      query: body => ({
        url: ApiEndpoints.WHATSAPP_BOT.PHONE_MAPPINGS_BULK,
        params: org(body.defaultTenantId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_PHONE_MAPPINGS],
    }),

    updateWaPhoneMapping: builder.mutation<WaPhoneMapping, UpdateWaPhoneMappingRequest>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.PHONE_MAPPING_BY_ID(id),
        params: org(body.tenantId),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_PHONE_MAPPINGS],
    }),

    deleteWaPhoneMapping: builder.mutation<{ id: string; removed: boolean }, RowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.PHONE_MAPPING_BY_ID(row(arg).id),
        params: org(row(arg).tenantId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_PHONE_MAPPINGS],
    }),

    /** Metadata only (title, tags, language). Never triggers a re-index. */
    updateKbDocument: builder.mutation<KbDocument, UpdateKbDocumentRequest & WithOrg>({
      query: ({ id, tenantId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_BY_ID(id),
        params: org(tenantId),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_DOCUMENTS, TAG_TYPES.CHATBOT_DETAIL],
    }),

    /**
     * Target a document at one, some or all organisations.
     *
     * Separate from updateKbDocument because it is not metadata: it rewrites the audience on
     * every indexed chunk, so it can fail where a title edit cannot — a 500 here means the
     * assignment saved but retrieval may still use the old audience, and the panel has to say so
     * rather than closing as if nothing happened.
     */
    setKbDocumentAudience: builder.mutation<
      KbDocument,
      UpdateKbDocumentAudienceRequest & { scopeTenantId?: string }
    >({
      // `scopeTenantId`, not `tenantId`: the body's `tenantIds` is the audience being SET, and the
      // organisation acting is a separate thing.
      query: ({ id, scopeTenantId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_TENANTS(id),
        params: org(scopeTenantId),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_DOCUMENTS, TAG_TYPES.CHATBOT_DETAIL],
    }),

    /** Replace a pasted document's body. A no-op server-side when the text is unchanged. */
    replaceKbDocumentContent: builder.mutation<
      KbDocument,
      ReplaceKbDocumentContentRequest & WithOrg
    >({
      query: ({ id, text, tenantId }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_CONTENT(id),
        params: org(tenantId),
        method: HttpMethod.PUT,
        body: { text },
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.WHATSAPP_BOT_STATS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    /** Re-chunk and re-index. Also the Retry action for a failed document. */
    reindexKbDocument: builder.mutation<KbDocument, RowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_REINDEX(row(arg).id),
        params: org(row(arg).tenantId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.WHATSAPP_BOT_STATS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    /**
     * Archive: the bot stops retrieving it, but its chunks stay so citations already recorded in
     * the conversation log still resolve. There is no delete — ally-be answers 409 and points here.
     */
    archiveKbDocument: builder.mutation<KbDocument, RowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_ARCHIVE(row(arg).id),
        params: org(row(arg).tenantId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.WHATSAPP_BOT_STATS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    unarchiveKbDocument: builder.mutation<KbDocument, RowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.DOCUMENT_UNARCHIVE(row(arg).id),
        params: org(row(arg).tenantId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.WHATSAPP_BOT_STATS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    /** Retrieval preview — no LLM call, so thresholds can be tuned without generation cost. */
    searchKbCorpus: builder.mutation<KbSearchResponse, KbSearchRequest>({
      query: body => ({
        url: ApiEndpoints.WHATSAPP_BOT.SEARCH,
        method: HttpMethod.POST,
        body,
      }),
    }),

    // ---- Keyword templates ----

    getWaTemplates: builder.query<
      GetWaTemplatesResponse,
      ({ kind?: WaTemplateKind; includeArchived?: boolean } & WithBot) | void
    >({
      query: (params?: { kind?: WaTemplateKind; includeArchived?: boolean } & WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATES,
        method: HttpMethod.GET,
        params: {
          ...(params?.kind ? { kind: params.kind } : {}),
          includeArchived: params?.includeArchived ?? false,
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    createWaTemplate: builder.mutation<WaTemplate, CreateWaTemplateRequest & WithBot>({
      query: ({ chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATES,
        method: HttpMethod.POST,
        params: bot(chatbotId),
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    updateWaTemplate: builder.mutation<WaTemplate, UpdateWaTemplateRequest & WithBot>({
      query: ({ id, chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATE_BY_ID(id),
        method: HttpMethod.PATCH,
        params: bot(chatbotId),
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    /** Archive a template. 403 for a mandatory safety template. */
    archiveWaTemplate: builder.mutation<WaTemplate, BotRowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATE_ARCHIVE(botRow(arg).id),
        method: HttpMethod.POST,
        params: bot(botRow(arg).chatbotId),
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    /** Rewrite priorities from an ordered id list; renumbers within each kind band. */
    reorderWaTemplates: builder.mutation<
      GetWaTemplatesResponse,
      string[] | ({ ids: string[] } & WithBot)
    >({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATES_REORDER,
        method: HttpMethod.POST,
        params: Array.isArray(arg) ? {} : org(arg.chatbotId),
        body: { ids: Array.isArray(arg) ? arg : arg.ids },
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    /** Which rule a message would match. Sends nothing. */
    testWaTemplate: builder.mutation<TestWaTemplateResponse, TestWaTemplateRequest & WithBot>({
      query: ({ chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATES_TEST,
        method: HttpMethod.POST,
        params: bot(chatbotId),
        body,
      }),
    }),

    /**
     * A bot's own version of a default reply: reworded, re-keyed, or switched off (optional
     * replies only — the backend refuses switching a required safety reply off). Creates the version
     * the first time and edits it after.
     */
    customiseWaTemplate: builder.mutation<
      WaTemplate,
      { id: string; chatbotId: string } & Partial<
        Pick<WaTemplate, "responseText" | "patterns" | "matchType" | "active">
      >
    >({
      query: ({ id, chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.TEMPLATE_CUSTOMISE(id),
        method: HttpMethod.POST,
        params: { chatbotId },
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_TEMPLATES],
    }),

    // ---- Organisations ----

    getWaSettings: builder.query<WaBotSettings, void>({
      query: () => ({
        url: ApiEndpoints.WHATSAPP_BOT.SETTINGS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_SETTINGS],
    }),

    updateWaSettings: builder.mutation<WaBotSettings, Partial<WaBotSettings>>({
      query: body => ({
        url: ApiEndpoints.WHATSAPP_BOT.SETTINGS,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_SETTINGS],
    }),

    // ---- Organisations' own numbers ----
    //
    // WhatsApp numbers are the WhatsApp connector's store. Access follows the bot each number
    // serves; the list takes `chatbotId`, or nothing for every number (platform admins).

    getWaNumbers: builder.query<WaBusinessNumber[], { chatbotId?: string } | void>({
      query: params => ({
        url: ApiEndpoints.WHATSAPP_BOT.NUMBERS,
        method: HttpMethod.GET,
        params: params && params.chatbotId ? { chatbotId: params.chatbotId } : undefined,
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_NUMBERS],
    }),

    connectWaNumber: builder.mutation<WaBusinessNumber, ConnectWaNumberRequest>({
      query: body => ({
        url: ApiEndpoints.WHATSAPP_BOT.NUMBERS_MANUAL,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    /** A mutation so it calls Meta only when pressed, never on mount or after a save. */
    checkWaNumber: builder.mutation<
      { number: WaBusinessNumber; check: WaConnectionCheck },
      { id: string }
    >({
      query: ({ id }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.NUMBER_CHECK(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    subscribeWaNumber: builder.mutation<WaBusinessNumber, { id: string }>({
      query: ({ id }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.NUMBER_SUBSCRIBE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    disconnectWaNumber: builder.mutation<void, { id: string }>({
      query: ({ id }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.NUMBER_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_NUMBERS,
        TAG_TYPES.CONNECTORS,
        TAG_TYPES.CHATBOTS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    // ---- Conversation log ----

    getWaConversations: builder.query<GetWaConversationsResponse, GetWaConversationsParams | void>({
      query: (params?: GetWaConversationsParams) => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONVERSATIONS,
        method: HttpMethod.GET,
        params: {
          limit: params?.limit ?? 25,
          offset: params?.offset ?? 0,
          ...(params?.from ? { from: params.from } : {}),
          ...(params?.to ? { to: params.to } : {}),
          ...(params?.handledBy ? { handledBy: params.handledBy } : {}),
          ...(params?.language ? { language: params.language } : {}),
          ...(params?.declinedOnly ? { declinedOnly: true } : {}),
          ...(params?.search ? { search: params.search } : {}),
          ...(params?.sortBy ? { sortBy: params.sortBy } : {}),
          ...(params?.sortDir ? { sortDir: params.sortDir } : {}),
          ...(params?.channel ? { channel: params.channel } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    /**
     * The languages present in the log, for its filter.
     *
     * Not the analytics language breakdown: that one is windowed and sits behind a different
     * permission, so it would hand an empty filter to a conversations-only admin and would drop a
     * language nobody used this month while its threads were still listed.
     */
    getWaConversationLanguages: builder.query<string[], WithBot | void>({
      query: (params?: WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONVERSATION_LANGUAGES,
        method: HttpMethod.GET,
        params: bot(params?.chatbotId),
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    getWaConversation: builder.query<WaConversationDetail, BotRowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONVERSATION_BY_ID(botRow(arg).id),
        method: HttpMethod.GET,
        params: bot(botRow(arg).chatbotId),
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    /**
     * Resolve a citation to the exact passage that was quoted.
     *
     * Reads the chunk row rather than the vector index, so a document re-chunked since the answer
     * was sent still resolves: the row holding the quoted text survives even though its vector
     * object was replaced.
     */
    getWaCitation: builder.query<KbChunk, string>({
      query: chunkId => ({
        url: ApiEndpoints.WHATSAPP_BOT.CITATION_BY_CHUNK(chunkId),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    /**
     * Reveal one contact's full phone number.
     *
     * A mutation despite being a read: it must fire only on an explicit click, and every call is
     * logged server-side. As a query, RTK Query would refetch it on mount and on cache
     * invalidation — quietly re-emitting identifiable data nobody asked for again.
     */
    revealWaContactPhone: builder.mutation<{ id: string; phoneE164: string }, BotRowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONTACT_REVEAL(botRow(arg).id),
        method: HttpMethod.POST,
        params: bot(botRow(arg).chatbotId),
      }),
    }),

    blockWaContact: builder.mutation<
      { id: string; blocked: boolean },
      { id: string; reason?: string } & WithBot
    >({
      query: ({ id, reason, chatbotId }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONTACT_BLOCK(id),
        method: HttpMethod.POST,
        params: bot(chatbotId),
        body: { reason },
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    unblockWaContact: builder.mutation<{ id: string; blocked: boolean }, BotRowArg>({
      query: arg => ({
        url: ApiEndpoints.WHATSAPP_BOT.CONTACT_UNBLOCK(botRow(arg).id),
        method: HttpMethod.POST,
        params: bot(botRow(arg).chatbotId),
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS],
    }),

    /** Chunk 12b: erase a bot page visitor (the shared store contact id from the thread). */
    eraseWebContact: builder.mutation<{ id: string; erased: boolean }, string>({
      query: id => ({
        url: ApiEndpoints.WHATSAPP_BOT.WEB_CONTACT_ERASE(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_CONVERSATIONS, TAG_TYPES.WHATSAPP_BOT_UNANSWERED],
    }),

    // ---- Unanswered queue ----

    getWaUnanswered: builder.query<
      GetWaUnansweredResponse,
      {
        limit?: number;
        offset?: number;
        status?: WaUnansweredStatus;
        reason?: WaUnansweredReason;
        sortBy?: string;
        sortDir?: "asc" | "desc";
        chatbotId?: string;
      } | void
    >({
      query: (params?: {
        limit?: number;
        offset?: number;
        status?: WaUnansweredStatus;
        reason?: WaUnansweredReason;
        sortBy?: string;
        sortDir?: "asc" | "desc";
        chatbotId?: string;
      }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.UNANSWERED,
        method: HttpMethod.GET,
        params: {
          limit: params?.limit ?? 25,
          offset: params?.offset ?? 0,
          ...(params?.status ? { status: params.status } : {}),
          ...(params?.reason ? { reason: params.reason } : {}),
          ...(params?.sortBy ? { sortBy: params.sortBy } : {}),
          ...(params?.sortDir ? { sortDir: params.sortDir } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_UNANSWERED],
    }),

    updateWaUnanswered: builder.mutation<
      WaUnansweredQuestion,
      {
        id: string;
        status?: WaUnansweredStatus;
        assignedTo?: number | null;
        resolutionNote?: string;
        linkedDocumentId?: string;
      } & WithBot
    >({
      query: ({ id, chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.UNANSWERED_BY_ID(id),
        method: HttpMethod.PATCH,
        params: bot(chatbotId),
        body,
      }),
      invalidatesTags: [TAG_TYPES.WHATSAPP_BOT_UNANSWERED, TAG_TYPES.CHATBOT_DETAIL],
    }),

    /**
     * Write the answer as a corpus document and resolve the gap in one action.
     *
     * Invalidates the corpus tag too: the new document must appear in the corpus list, which is
     * where its ingest status is watched.
     */
    createDocumentFromWaUnanswered: builder.mutation<
      { question: WaUnansweredQuestion; document: KbDocument },
      { id: string; title: string; text: string; tags?: string[] } & WithBot
    >({
      query: ({ id, chatbotId, ...body }) => ({
        url: ApiEndpoints.WHATSAPP_BOT.UNANSWERED_CREATE_DOCUMENT(id),
        method: HttpMethod.POST,
        params: bot(chatbotId),
        body,
      }),
      invalidatesTags: [
        TAG_TYPES.WHATSAPP_BOT_UNANSWERED,
        TAG_TYPES.WHATSAPP_BOT_DOCUMENTS,
        TAG_TYPES.CHATBOT_DETAIL,
      ],
    }),

    // ---- Usage dashboard ----

    getWaAnalyticsOverview: builder.query<
      WaAnalyticsOverview,
      ({ from?: string; to?: string } & WithBot) | void
    >({
      query: (params?: { from?: string; to?: string } & WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.ANALYTICS_OVERVIEW,
        method: HttpMethod.GET,
        params: {
          ...(params?.from ? { from: params.from } : {}),
          ...(params?.to ? { to: params.to } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_ANALYTICS],
    }),

    getWaAnalyticsTimeseries: builder.query<
      WaAnalyticsBucket[],
      ({ from?: string; to?: string } & WithBot) | void
    >({
      query: (params?: { from?: string; to?: string } & WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.ANALYTICS_TIMESERIES,
        method: HttpMethod.GET,
        params: {
          ...(params?.from ? { from: params.from } : {}),
          ...(params?.to ? { to: params.to } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_ANALYTICS],
    }),

    getWaAnalyticsLanguages: builder.query<
      WaLanguageRow[],
      ({ from?: string; to?: string } & WithBot) | void
    >({
      query: (params?: { from?: string; to?: string } & WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.ANALYTICS_LANGUAGES,
        method: HttpMethod.GET,
        params: {
          ...(params?.from ? { from: params.from } : {}),
          ...(params?.to ? { to: params.to } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_ANALYTICS],
    }),

    getWaCorpusCoverage: builder.query<
      WaCorpusCoverageResponse,
      ({ from?: string; to?: string } & WithBot) | void
    >({
      query: (params?: { from?: string; to?: string } & WithBot) => ({
        url: ApiEndpoints.WHATSAPP_BOT.ANALYTICS_CORPUS_COVERAGE,
        method: HttpMethod.GET,
        params: {
          ...(params?.from ? { from: params.from } : {}),
          ...(params?.to ? { to: params.to } : {}),
          ...bot(params?.chatbotId),
        },
      }),
      providesTags: [TAG_TYPES.WHATSAPP_BOT_ANALYTICS],
    }),
  }),
});

export const {
  useGetKbDocumentsQuery,
  useGetKbDocumentQuery,
  useGetKbStatsQuery,
  useCreateKbUploadUrlMutation,
  useCreateKbDocumentMutation,
  useUpdateKbDocumentMutation,
  useSetKbDocumentAudienceMutation,
  useGetWaPhoneMappingsQuery,
  useCreateWaPhoneMappingMutation,
  useBulkCreateWaPhoneMappingsMutation,
  useUpdateWaPhoneMappingMutation,
  useDeleteWaPhoneMappingMutation,
  useReplaceKbDocumentContentMutation,
  useReindexKbDocumentMutation,
  useArchiveKbDocumentMutation,
  useUnarchiveKbDocumentMutation,
  useSearchKbCorpusMutation,
  useGetWaTemplatesQuery,
  useCreateWaTemplateMutation,
  useUpdateWaTemplateMutation,
  useArchiveWaTemplateMutation,
  useReorderWaTemplatesMutation,
  useTestWaTemplateMutation,
  useGetWaSettingsQuery,
  useUpdateWaSettingsMutation,
  useGetWaNumbersQuery,
  useConnectWaNumberMutation,
  useCheckWaNumberMutation,
  useSubscribeWaNumberMutation,
  useDisconnectWaNumberMutation,
  useCustomiseWaTemplateMutation,
  useGetWaConversationsQuery,
  useGetWaConversationQuery,
  useGetWaConversationLanguagesQuery,
  useGetWaCitationQuery,
  useRevealWaContactPhoneMutation,
  useBlockWaContactMutation,
  useEraseWebContactMutation,
  useUnblockWaContactMutation,
  useGetWaUnansweredQuery,
  useUpdateWaUnansweredMutation,
  useCreateDocumentFromWaUnansweredMutation,
  useGetWaAnalyticsOverviewQuery,
  useGetWaAnalyticsTimeseriesQuery,
  useGetWaAnalyticsLanguagesQuery,
  useGetWaCorpusCoverageQuery,
} = whatsappBotAPI;
