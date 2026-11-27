import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  ManualAdminSettings,
  ManualAgentKey,
  ManualChangeRow,
  ManualConversation,
  ManualConversationSummary,
  ManualImportPage,
  ManualImportResult,
  ManualGraph,
  ManualPageDetail,
  ManualPageRow,
  ManualProposal,
  ManualRun,
  ManualSaveDraftRequest,
  ManualSearchHit,
  ManualState,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Roadmap → Product Manual (ally-be `docs/product-manual.md`). The chat streams over SSE in
 * `useManualChatStream`; everything else is here.
 *
 * The manual changes underneath the reader (the chat edits it live, a weekly agent applies
 * proposals), so a revert or a live edit invalidates the tree, the page and the change log.
 */
export const productManualAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getManualTree: builder.query<ManualPageRow[], void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.TREE, method: HttpMethod.GET }),
      transformResponse: (response: { pages?: ManualPageRow[] }) => response?.pages ?? [],
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "ALL" }],
    }),

    getManualPage: builder.query<ManualPageDetail, string>({
      query: slug => ({ url: ApiEndpoints.PRODUCT_MANUAL.PAGE(slug), method: HttpMethod.GET }),
      providesTags: (_result, _error, slug) => [{ type: TAG_TYPES.PRODUCT_MANUAL_PAGE, id: slug }],
    }),

    searchManual: builder.query<ManualSearchHit[], { q: string; limit?: number }>({
      query: ({ q, limit = 12 }) => ({
        url: ApiEndpoints.PRODUCT_MANUAL.SEARCH,
        method: HttpMethod.GET,
        params: { q, limit },
      }),
      transformResponse: (response: { results?: ManualSearchHit[] }) => response?.results ?? [],
      // A search reads text that the chat can change; keep it short-lived.
      keepUnusedDataFor: 30,
    }),

    getManualGraph: builder.query<ManualGraph, void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.GRAPH, method: HttpMethod.GET }),
      transformResponse: (response: Partial<ManualGraph>) => ({
        nodes: response?.nodes ?? [],
        edges: response?.edges ?? [],
      }),
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "GRAPH" }],
    }),

    getManualChanges: builder.query<ManualChangeRow[], { slug?: string; limit?: number }>({
      query: ({ slug, limit = 30 }) => ({
        url: ApiEndpoints.PRODUCT_MANUAL.CHANGES,
        method: HttpMethod.GET,
        params: slug ? { slug, limit } : { limit },
      }),
      transformResponse: (response: { changes?: ManualChangeRow[] }) => response?.changes ?? [],
      providesTags: (_result, _error, { slug }) => [
        { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: slug ?? "ALL" },
      ],
    }),

    revertManualPage: builder.mutation<ManualPageDetail, { slug: string; revisionId: string }>({
      query: ({ slug, revisionId }) => ({
        url: ApiEndpoints.PRODUCT_MANUAL.REVERT(slug),
        method: HttpMethod.POST,
        body: { revisionId },
      }),
      invalidatesTags: (_result, _error, { slug }) => [
        { type: TAG_TYPES.PRODUCT_MANUAL_PAGE, id: slug },
        { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "ALL" },
        { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "GRAPH" },
        { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: slug },
        { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: "ALL" },
      ],
    }),

    getManualState: builder.query<ManualState, void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.STATE, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_STATE, id: "ONE" }],
    }),

    // ── chat ──────────────────────────────────────────────────────────────────────────────────
    getManualConversations: builder.query<ManualConversationSummary[], void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.CONVERSATIONS, method: HttpMethod.GET }),
      transformResponse: (response: { conversations?: ManualConversationSummary[] }) =>
        response?.conversations ?? [],
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_CONVERSATIONS, id: "LIST" }],
    }),

    // Read fresh through the lazy trigger: a conversation grows as it is used.
    getManualConversation: builder.query<ManualConversation, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_MANUAL.CONVERSATION(id),
        method: HttpMethod.GET,
      }),
      keepUnusedDataFor: 0,
    }),

    deleteManualConversation: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_MANUAL.CONVERSATION(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_CONVERSATIONS, id: "LIST" }],
    }),

    saveManualDraft: builder.mutation<{ code: string }, ManualSaveDraftRequest>({
      query: body => ({ url: ApiEndpoints.PRODUCT_MANUAL.DRAFTS, method: HttpMethod.POST, body }),
    }),

    dismissManualDraft: builder.mutation<void, { conversationId: string; draftId: string }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_MANUAL.DRAFTS_DISMISS,
        method: HttpMethod.POST,
        body,
      }),
    }),

    // ── admin (product_roadmap_manage) ─────────────────────────────────────────────────────────
    getManualAdminSettings: builder.query<ManualAdminSettings, void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_SETTINGS, method: HttpMethod.GET }),
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "SETTINGS" }],
    }),

    updateManualAdminSettings: builder.mutation<
      ManualAdminSettings,
      Partial<Pick<ManualAdminSettings, "enabled" | "monthlyBudgetUsd">>
    >({
      query: body => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_SETTINGS,
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [
        { type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "SETTINGS" },
        { type: TAG_TYPES.PRODUCT_MANUAL_STATE, id: "ONE" },
      ],
    }),

    runManualAgentNow: builder.mutation<{ runId: string }, void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_RUN, method: HttpMethod.POST }),
      invalidatesTags: [
        { type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "RUNS" },
        { type: TAG_TYPES.PRODUCT_MANUAL_STATE, id: "ONE" },
      ],
    }),

    importManualPages: builder.mutation<ManualImportResult, ManualImportPage[]>({
      query: pages => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_IMPORT,
        method: HttpMethod.POST,
        body: { pages },
      }),
      invalidatesTags: [
        { type: TAG_TYPES.PRODUCT_MANUAL_PAGE },
        { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "ALL" },
        { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "GRAPH" },
        { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: "ALL" },
        { type: TAG_TYPES.PRODUCT_MANUAL_STATE, id: "ONE" },
      ],
    }),

    getManualRuns: builder.query<ManualRun[], void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_RUNS,
        method: HttpMethod.GET,
        params: { limit: 10 },
      }),
      transformResponse: (response: { runs?: ManualRun[] }) => response?.runs ?? [],
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "RUNS" }],
    }),

    getManualProposals: builder.query<ManualProposal[], void>({
      query: () => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_PROPOSALS,
        method: HttpMethod.GET,
        params: { status: "open" },
      }),
      transformResponse: (response: { proposals?: ManualProposal[] }) => response?.proposals ?? [],
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "PROPOSALS" }],
    }),

    dismissManualProposal: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_PROPOSAL_DISMISS(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [
        { type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "PROPOSALS" },
        { type: TAG_TYPES.PRODUCT_MANUAL_STATE, id: "ONE" },
      ],
    }),

    getManualAgentKeys: builder.query<ManualAgentKey[], void>({
      query: () => ({ url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_AGENT_KEYS, method: HttpMethod.GET }),
      transformResponse: (response: { keys?: ManualAgentKey[] }) => response?.keys ?? [],
      providesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "KEYS" }],
    }),

    createManualAgentKey: builder.mutation<{ id: string; key: string }, { label: string }>({
      query: body => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_AGENT_KEYS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "KEYS" }],
    }),

    revokeManualAgentKey: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.PRODUCT_MANUAL.ADMIN_AGENT_KEY(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [{ type: TAG_TYPES.PRODUCT_MANUAL_ADMIN, id: "KEYS" }],
    }),
  }),
});

export const {
  useGetManualTreeQuery,
  useGetManualPageQuery,
  useSearchManualQuery,
  useGetManualGraphQuery,
  useGetManualChangesQuery,
  useLazyGetManualChangesQuery,
  useRevertManualPageMutation,
  useGetManualStateQuery,
  useGetManualConversationsQuery,
  useLazyGetManualConversationQuery,
  useDeleteManualConversationMutation,
  useSaveManualDraftMutation,
  useDismissManualDraftMutation,
  useGetManualAdminSettingsQuery,
  useUpdateManualAdminSettingsMutation,
  useRunManualAgentNowMutation,
  useImportManualPagesMutation,
  useGetManualRunsQuery,
  useGetManualProposalsQuery,
  useDismissManualProposalMutation,
  useGetManualAgentKeysQuery,
  useCreateManualAgentKeyMutation,
  useRevokeManualAgentKeyMutation,
} = productManualAPI;
